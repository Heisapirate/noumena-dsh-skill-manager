// The single reusable safe-path boundary that every filesystem mutation must
// pass through (Issue #11, production spec §8, ADR-0001).
//
// Design goals:
// - Fail closed: every escape form (`..`, absolute, drive-letter, UNC,
//   backslash, prefix trap, case trick, symlink/junction escape) is refused.
// - Validated paths, not raw strings: downstream transactions receive
//   `SkillName`/`SafePath` branded results instead of repeatedly accepting
//   arbitrary paths.
// - TOCTOU minimized: containment is checked at the string level, then again
//   against `realpath` immediately before each mutation, and staging paths are
//   created one component at a time (never `mkdir -p` through an unverified
//   symlink). A local attacker racing the user's own home directory is outside
//   this threat model (see notes).
//
// The pure checks are filesystem-free and deterministic across platforms; the
// `caseInsensitive` option defaults to `process.platform === 'win32'`.

import { lstat, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import type { Stats } from 'node:fs';

// ---------------------------------------------------------------------------
// Branded types (nominal, so validated values are not interchangeable with
// arbitrary strings in downstream code).
// ---------------------------------------------------------------------------

declare const skillNameBrand: unique symbol;
/** A skill name already validated against DSH's kebab-case grammar. */
export type SkillName = string & { readonly [skillNameBrand]: 'skill-name' };

declare const safePathBrand: unique symbol;
/** An absolute path validated to be strictly inside the managed skills root. */
export type SafePath = string & { readonly [safePathBrand]: 'safe-path' };

/** The kind of on-disk entry at a skill directory path (never follows links). */
export type SkillDirKind = 'missing' | 'directory' | 'symlink' | 'file';

/** A single file to materialize into a validated directory (path + UTF-8 contents). */
export interface SnapshotFile {
  /** `/`-separated path relative to the target directory. */
  path: string;
  /** UTF-8 file contents. */
  contents: string;
}

// ---------------------------------------------------------------------------
// Typed failures for later RPC/UI normalization.
// ---------------------------------------------------------------------------

export type PathSafetyErrorCode =
  | 'invalid-skill-name'
  | 'invalid-relative-path'
  | 'absolute-path'
  | 'drive-letter-path'
  | 'traversal'
  | 'unsafe-path'
  | 'symlink-escape'
  | 'not-found'
  | 'not-a-directory'
  | 'filesystem-permission'
  | 'filesystem-error';

/** `{code,message,details}` shape compatible with the `/skill-manager` RPC error. */
export interface RpcErrorShape {
  code: string;
  message: string;
  details: { path?: string };
}

export class PathSafetyError extends Error {
  readonly code: PathSafetyErrorCode;
  readonly path?: string;

  constructor(code: PathSafetyErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'PathSafetyError';
    this.code = code;
    if (path !== undefined) this.path = path;
  }

  /** Normalize to the RPC error shape; later layers map `code` to user-facing copy. */
  toRpcError(): RpcErrorShape {
    return {
      code: this.code,
      message: this.message,
      details: this.path !== undefined ? { path: this.path } : {},
    };
  }
}

// ---------------------------------------------------------------------------
// Skill-name grammar (DSH kebab-case).
// ---------------------------------------------------------------------------

/** DSH's skill-name grammar: lowercase ASCII letters/digits, hyphen-separated. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSkillName(name: string): name is SkillName {
  return SKILL_NAME_RE.test(name);
}

export function assertSkillName(name: string): asserts name is SkillName {
  if (!isValidSkillName(name)) {
    throw new PathSafetyError(
      'invalid-skill-name',
      `invalid skill name ${JSON.stringify(name)}: expected kebab-case [a-z0-9]+(?:-[a-z0-9]+)*`,
    );
  }
}

// ---------------------------------------------------------------------------
// Relative (snapshot file) path validation.
// ---------------------------------------------------------------------------

/**
 * Validate one `files[].path` from a skills.sh snapshot. Such a path must be a
 * non-empty, forward-slash relative path. This refuses `..`, `.`/empty segments,
 * absolute/rooted forms (POSIX and UNC), Windows drive-letter paths, backslash
 * separators, and NUL bytes — failing closed against every escape form.
 */
export function assertRelativePath(relPath: string): void {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new PathSafetyError('invalid-relative-path', 'relative path must be a non-empty string');
  }
  if (relPath.includes('\0')) {
    throw new PathSafetyError('invalid-relative-path', 'relative path must not contain NUL bytes');
  }
  if (relPath.startsWith('/') || relPath.startsWith('\\')) {
    throw new PathSafetyError('absolute-path', `relative path must not be absolute: ${JSON.stringify(relPath)}`);
  }
  if (/^[A-Za-z]:/.test(relPath)) {
    throw new PathSafetyError('drive-letter-path', `relative path must not contain a drive letter: ${JSON.stringify(relPath)}`);
  }

  // Analyze traversal on a separator-normalized form so `..\..` and mixed
  // separator spellings of `..` are caught as traversal, not just as backslash.
  for (const segment of relPath.replace(/\\/g, '/').split('/')) {
    if (segment === '..') {
      throw new PathSafetyError('traversal', `relative path must not contain "..": ${JSON.stringify(relPath)}`);
    }
    if (segment === '.') {
      throw new PathSafetyError('invalid-relative-path', `relative path must not contain ".": ${JSON.stringify(relPath)}`);
    }
    if (segment === '') {
      throw new PathSafetyError('invalid-relative-path', `relative path must not contain empty segments: ${JSON.stringify(relPath)}`);
    }
  }

  // skills.sh snapshots use forward slashes; a backslash is always a separator
  // (and therefore an escape surface), so any backslash is refused.
  if (relPath.includes('\\')) {
    throw new PathSafetyError('invalid-relative-path', `relative path must use forward slashes: ${JSON.stringify(relPath)}`);
  }
}

// ---------------------------------------------------------------------------
// Containment (pure; deterministic across platforms).
// ---------------------------------------------------------------------------

/**
 * Normalize an absolute path to a POSIX-separated comparison form, optionally
 * folding case. Comparison uses `path.posix.relative` so case sensitivity is
 * decided solely by `caseInsensitive` (not by the host platform's `path`
 * module), which keeps the rule explicit and unit-testable everywhere.
 *
 * The case-insensitive form uses JS `toLowerCase()`, which is exact for this
 * module's ASCII domain (skill names are kebab-case; snapshot paths are ASCII)
 * but only an approximation of Windows/NTFS case folding in general (it omits
 * short-name and trailing-dot aliasing). That approximation can only fail
 * closed, and the authoritative case canonicalization for real mutations is
 * `realpath` in `assertContainedReal`, not this string comparison.
 */
function toComparable(p: string, caseInsensitive: boolean): string {
  const s = resolve(p).replace(/\\/g, '/');
  return caseInsensitive ? s.toLowerCase() : s;
}

function isStrictlyInside(root: string, candidate: string, caseInsensitive: boolean): boolean {
  const r = toComparable(root, caseInsensitive);
  const c = toComparable(candidate, caseInsensitive);
  const rel = posix.relative(r, c);
  if (rel === '') return false; // candidate === root is not strictly inside
  if (posix.isAbsolute(rel)) return false; // different volume
  if (rel === '..' || rel.startsWith('../')) return false; // escapes or prefix trap
  return true;
}

function isSameOrInside(root: string, candidate: string, caseInsensitive: boolean): boolean {
  return toComparable(root, caseInsensitive) === toComparable(candidate, caseInsensitive)
    || isStrictlyInside(root, candidate, caseInsensitive);
}

/** Throw `symlink-escape` unless `candidate` (a realpath result) stays inside `realRoot`. */
function assertRealInside(realRoot: string, candidate: string, caseInsensitive: boolean, subject: string): void {
  if (!isSameOrInside(realRoot, candidate, caseInsensitive)) {
    throw new PathSafetyError(
      'symlink-escape',
      `${subject} escapes the skills root: ${JSON.stringify(candidate)}`,
      candidate,
    );
  }
}

// ---------------------------------------------------------------------------
// Filesystem helpers.
// ---------------------------------------------------------------------------

async function tryLstat(p: string): Promise<Stats | null> {
  try {
    return await lstat(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw toPathSafetyError(err, p);
  }
}

async function wrapFs<T>(op: Promise<T>, path: string): Promise<T> {
  try {
    return await op;
  } catch (err) {
    throw toPathSafetyError(err, path);
  }
}

function toPathSafetyError(err: unknown, path: string): PathSafetyError {
  const code = (err as NodeJS.ErrnoException)?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === 'ENOENT') return new PathSafetyError('not-found', `not found: ${path} (${message})`, path);
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return new PathSafetyError('filesystem-permission', `permission denied: ${path} (${message})`, path);
  }
  return new PathSafetyError('filesystem-error', `filesystem error on ${path}: ${message}`, path);
}

// ---------------------------------------------------------------------------
// The boundary.
// ---------------------------------------------------------------------------

export interface SkillRootOptions {
  /** Defaults to `process.platform === 'win32'` (case-insensitive containment). */
  caseInsensitive?: boolean;
}

/** Relative segments, under the skills root, reserved for the plugin's own metadata. */
const STAGING_SEGMENTS = ['.system', 'skill-manager', '.staging'];

export class SkillRoot {
  /** Absolute, normalized skills root. */
  readonly path: string;
  readonly caseInsensitive: boolean;

  constructor(skillsRoot: string, options: SkillRootOptions = {}) {
    if (typeof skillsRoot !== 'string' || skillsRoot.length === 0) {
      throw new PathSafetyError('unsafe-path', 'skills root must be a non-empty path');
    }
    this.path = resolve(skillsRoot);
    this.caseInsensitive = options.caseInsensitive ?? process.platform === 'win32';
  }

  /** Pure check that `candidate` is strictly inside the root (the root itself is not "inside"). No filesystem access. */
  isInside(candidate: string): boolean {
    return isStrictlyInside(this.path, candidate, this.caseInsensitive);
  }

  /** Throw `unsafe-path` unless `candidate` is strictly inside the root. */
  assertInside(candidate: string): void {
    if (!this.isInside(candidate)) {
      throw new PathSafetyError(
        'unsafe-path',
        `path is not strictly inside the skills root: ${JSON.stringify(candidate)}`,
        candidate,
      );
    }
  }

  /** Validate a skill name and resolve it to a directory strictly inside the root. */
  skillDir(name: string): SafePath {
    assertSkillName(name);
    const target = resolve(this.path, name);
    this.assertInside(target);
    return target as SafePath;
  }

  /** Resolve the plugin's staging directory for a skill (`.system/skill-manager/.staging/<name>`). */
  stagingDir(name: string): SafePath {
    assertSkillName(name);
    const target = resolve(this.path, ...STAGING_SEGMENTS, name);
    this.assertInside(target);
    return target as SafePath;
  }

  /**
   * Validate a snapshot `files[].path` and resolve it strictly inside its skill
   * directory. Re-validates `skillDirPath` even though it is branded, so a
   * forged or stale value cannot be used to escape.
   */
  relativeFile(skillDirPath: SafePath, relPath: string): SafePath {
    this.assertInside(skillDirPath);
    assertRelativePath(relPath);
    const target = resolve(skillDirPath, ...relPath.split('/'));
    // Second layer: keep the file inside its skill directory even if
    // `assertRelativePath` ever regressed. Cheap, and never fires today.
    if (!isStrictlyInside(skillDirPath, target, this.caseInsensitive)) {
      throw new PathSafetyError(
        'unsafe-path',
        `file path escapes its skill directory: ${JSON.stringify(relPath)}`,
        target,
      );
    }
    return target as SafePath;
  }

  /**
   * Resolve-and-contain: verify `target` is strictly inside the root at the
   * string level, then `lstat` the target and every ancestor component and
   * refuse any symlink/junction whose `realpath` resolution leaves the real
   * root (spec §8(4)). A component that does not exist yet stops the walk —
   * nothing deeper can exist either, so a not-yet-created target is permitted.
   */
  async assertContainedReal(target: string): Promise<void> {
    this.assertInside(target);
    const realRoot = await this.realRoot();

    const rel = relative(this.path, target);
    const segments = rel.split(sep).filter(Boolean);
    let current = this.path;
    for (const segment of segments) {
      current = join(current, segment);
      const st = await tryLstat(current);
      if (!st) break;
      if (st.isSymbolicLink()) {
        const resolved = await wrapFs(realpath(current), current);
        assertRealInside(realRoot, resolved, this.caseInsensitive, 'symlink/junction');
      }
    }
  }

  /** Create (idempotently) the staging directory for a skill. */
  async createStagingDir(name: string): Promise<SafePath> {
    const target = this.stagingDir(name);
    await this.mkdirContained(target);
    return target;
  }

  /** Remove a skill's staging directory (idempotent). */
  async removeStagingDir(name: string): Promise<void> {
    await this.removeContained(this.stagingDir(name));
  }

  /**
   * Write a set of snapshot files into a validated directory (a staging or skill
   * dir). Every file path is re-validated and resolved strictly inside `dir`,
   * its parent directory is created one component at a time (never through an
   * unverified symlink), and the file is written only to the validated target.
   */
  async materializeFiles(dir: SafePath, files: readonly SnapshotFile[]): Promise<void> {
    this.assertInside(dir);
    for (const file of files) {
      const target = this.relativeFile(dir, file.path);
      // `dirname(target)` is derived from a validated path and stays inside `dir`;
      // `mkdirContained` re-asserts containment before creating anything.
      await this.mkdirContained(dirname(target) as SafePath);
      await wrapFs(writeFile(target, file.contents, 'utf8'), target);
    }
  }

  /** Atomically rename a staged directory into place as the skill directory. */
  async publishStaged(name: string): Promise<void> {
    const from = this.stagingDir(name);
    const to = this.skillDir(name);
    await this.assertContainedReal(from);
    await this.assertContainedReal(to);
    await wrapFs(rename(from, to), to);
  }

  /**
   * Move an existing skill directory to its backup slot (under the staging area)
   * so a staged replacement can be renamed into place. Returns whether there was
   * a skill directory to move. A stale backup is dropped first only when the
   * current skill dir still exists (the current content is authoritative).
   */
  async moveSkillToBackup(name: string): Promise<boolean> {
    const to = this.skillDir(name);
    const backup = this.backupDir(name);
    await this.assertContainedReal(to);
    const st = await tryLstat(to);
    if (!st) return false;
    await this.removeContained(backup);
    await wrapFs(rename(to, backup), backup);
    return true;
  }

  /** Restore a backed-up skill directory back to the skill dir (rollback). */
  async restoreBackup(name: string): Promise<void> {
    const to = this.skillDir(name);
    const backup = this.backupDir(name);
    await this.assertContainedReal(backup);
    if (!(await tryLstat(backup))) return;
    await wrapFs(rename(backup, to), to);
  }

  /** Delete a skill's backup directory (idempotent). */
  async removeBackup(name: string): Promise<void> {
    await this.removeContained(this.backupDir(name));
  }

  /** Recursively delete a validated skill directory (idempotent; never follows links). */
  async removeSkillDir(name: string): Promise<void> {
    await this.removeContained(this.skillDir(name));
  }

  /**
   * Classify the on-disk entry at a validated skill directory path using
   * `lstat` (never follows links). This is the single seam transactions use to
   * decide ownership/missing-state/drift without reaching into `node:fs` or
   * duplicating errno mapping. Missing only means the path is absent; a
   * symlink/junction is reported as `symlink`, not followed.
   */
  async classifySkill(name: string): Promise<SkillDirKind> {
    const target = this.skillDir(name);
    const st = await tryLstat(target);
    if (!st) return 'missing';
    if (st.isSymbolicLink()) return 'symlink';
    if (st.isDirectory()) return 'directory';
    return 'file';
  }

  /** Backup slot for a skill's prior directory, kept inside the staging area. */
  private backupDir(name: string): SafePath {
    assertSkillName(name);
    const target = resolve(this.path, ...STAGING_SEGMENTS, `.backup-${name}`);
    this.assertInside(target);
    return target as SafePath;
  }

  private async realRoot(): Promise<string> {
    await this.ensureRootExists();
    return wrapFs(realpath(this.path), this.path);
  }

  /**
   * Create the skills root (`$DSH_HOME/skills`) if it is missing. The DSH
   * runtime does not eagerly create it, so on a fresh install the very first
   * mutation must create this fixed root before `realpath` can resolve it.
   * Non-recursive: it creates only the root leaf (its parent `$DSH_HOME`
   * necessarily exists, because the plugin is loaded from inside it), so it
   * never creates ancestors or follows a symlink mid-path like `mkdir -p`.
   */
  private async ensureRootExists(): Promise<void> {
    const st = await tryLstat(this.path);
    if (!st) {
      await wrapFs(mkdir(this.path), this.path);
    }
  }

  /**
   * Create `target` one path component at a time, lstat-checking each existing
   * component is a real directory (not a symlink/junction) before descending.
   * This avoids `mkdir -p`'s habit of following a symlink that appears mid-path
   * between the containment check and the create.
   */
  private async mkdirContained(target: SafePath): Promise<void> {
    this.assertInside(target);
    const realRoot = await this.realRoot();

    const rel = relative(this.path, target);
    if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) {
      throw new PathSafetyError('unsafe-path', 'target is not below the skills root', target);
    }

    let current = this.path;
    for (const segment of rel.split(sep)) {
      if (segment === '') continue;
      current = join(current, segment);
      const st = await tryLstat(current);
      if (st) {
        if (st.isSymbolicLink()) {
          throw new PathSafetyError(
            'symlink-escape',
            `refusing symlink/junction in staging path: ${JSON.stringify(current)}`,
            current,
          );
        }
        if (!st.isDirectory()) {
          throw new PathSafetyError(
            'not-a-directory',
            `staging path component is not a directory: ${JSON.stringify(current)}`,
            current,
          );
        }
      } else {
        await wrapFs(mkdir(current), current);
      }
    }

    const realTarget = await wrapFs(realpath(target), target);
    assertRealInside(realRoot, realTarget, this.caseInsensitive, 'staging path');
  }

  private async removeContained(target: SafePath): Promise<void> {
    this.assertInside(target);
    await this.assertContainedReal(target);

    const st = await tryLstat(target);
    if (!st) return; // idempotent: nothing to delete

    if (st.isSymbolicLink()) {
      // Remove the link itself, never the link target.
      await wrapFs(rm(target), target);
      return;
    }
    if (st.isDirectory()) {
      // Node's recursive rm unlinks symlinks/junctions it encounters rather
      // than traversing them; the dedicated test proves the target survives.
      await wrapFs(rm(target, { recursive: true, force: true }), target);
      return;
    }
    await wrapFs(rm(target), target);
  }
}
