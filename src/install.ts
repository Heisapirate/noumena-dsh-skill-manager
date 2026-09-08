// The production install transaction (Issue #14, production spec §9). It
// composes — never re-implements — the three boundaries built earlier:
//
//   - SkillsShClient (#12) for snapshot retrieval and its typed network errors;
//   - SkillRoot (#11) for every filesystem mutation (staging, materialization,
//     atomic publish, backup-swap, rollback);
//   - ManifestStore (#10) for provenance, written only after publish succeeds.
//
// Order (spec §9): validate id/source → fetch snapshot → validate snapshot →
// duplicate/foreign gate → stage → publish (atomic; backup-swap on overwrite) →
// manifest update → cleanup. On any failure before publish the prior state is
// untouched; after publish, a manifest-save failure rolls the publish back.

import { isPermissionErrno } from './errors';
import {
  computeLocalContentHash,
  MANIFEST_SCHEMA_VERSION,
  type RemoteSourceHash,
  type SkillManifest,
  type SkillManifestEntry,
} from './manifest';
import type { ManifestLoadResult, ManifestStore } from './manifest/store';
import { isValidSkillName, PathSafetyError, type SafePath, type SkillRoot } from './path-safety';
import {
  classifySource,
  extractFrontmatterMetadata,
  isSkillsShError,
  splitDownloadId,
  type SkillsShClient,
  type SkillSnapshot,
} from './skills-sh';
import type { InstallRequest, InstallResult } from './types';

/** Typed install failures; normalized to the RPC error shape by the RPC layer. */
export type InstallErrorCode =
  | 'source-unavailable'
  | 'invalid-skill-name'
  | 'malformed-snapshot'
  | 'unsafe-path'
  | 'duplicate-install'
  | 'foreign-target'
  | 'filesystem-permission'
  | 'install-partial-failure';

export interface InstallErrorOptions {
  path?: string;
  cause?: unknown;
}

export class InstallError extends Error {
  readonly code: InstallErrorCode;
  readonly path?: string;

  constructor(code: InstallErrorCode, message: string, options: InstallErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'InstallError';
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
  }

  /** Normalize to the RPC error shape; the UI maps `code` to localized copy. */
  toRpcError(): { code: InstallErrorCode; message: string; details: { path?: string } } {
    return {
      code: this.code,
      message: this.message,
      details: this.path !== undefined ? { path: this.path } : {},
    };
  }
}

/** Dependencies the transaction composes; all are injectable for tests. */
export interface InstallDeps {
  client: SkillsShClient;
  root: SkillRoot;
  store: ManifestStore;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Run the install transaction. On success the skill directory is complete at
 * `$DSH_HOME/skills/<slug>` and the manifest entry is recorded; on any failure
 * the prior state is left untouched and no partial directory/entry survives.
 */
export async function installSkill(deps: InstallDeps, request: InstallRequest, signal?: AbortSignal): Promise<InstallResult> {
  const now = deps.now ?? Date.now;

  // 1. Validate the id shape and that the source is GitHub `owner/repo`.
  const parts = typeof request.id === 'string' && request.id.trim() !== '' ? splitDownloadId(request.id) : null;
  if (!parts) {
    throw new InstallError(
      'source-unavailable',
      `cannot install ${JSON.stringify(request.id)}: expected a skills.sh id "owner/repo/slug"`,
    );
  }
  const { owner, repo, slug } = parts;
  const source = `${owner}/${repo}`;
  if (classifySource(source) !== 'github') {
    throw new InstallError(
      'source-unavailable',
      `cannot install ${JSON.stringify(request.id)}: source ${JSON.stringify(source)} is not a GitHub owner/repo`,
    );
  }
  if (!isValidSkillName(slug)) {
    throw new InstallError(
      'invalid-skill-name',
      `invalid skill name ${JSON.stringify(slug)}: expected kebab-case [a-z0-9]+(?:-[a-z0-9]+)*`,
    );
  }

  // 2. Fetch the snapshot (network; nothing is written yet). SkillsShError codes
  //    (network-unavailable, timeout, rate-limited, registry-unavailable,
  //    malformed-response, source-unavailable) propagate typed.
  const snapshot: SkillSnapshot = await deps.client.getSnapshot(request.id, signal ? { signal } : {});

  // 3. Validate the snapshot before any filesystem mutation.
  validateSnapshotForInstall(deps.root, slug, snapshot);

  // 4. Duplicate / foreign gate.
  let loaded: ManifestLoadResult;
  try {
    loaded = await deps.store.load();
  } catch (err) {
    throw toInstallError(err);
  }
  const skillDir = deps.root.skillDir(slug);
  const targetExists = (await deps.root.classifySkill(slug)) !== 'missing';
  const managedEntry = loaded.manifest.skills[slug];
  if (targetExists && !managedEntry) {
    throw new InstallError(
      'foreign-target',
      `refusing to overwrite a foreign skill at ${JSON.stringify(skillDir)}`,
      { path: skillDir },
    );
  }
  if (targetExists && request.overwrite !== true) {
    throw new InstallError(
      'duplicate-install',
      `skill ${JSON.stringify(slug)} is already plugin-managed; confirm overwrite to replace it`,
      { path: skillDir },
    );
  }

  // 5. Stage to `.system/skill-manager/.staging/<slug>/`. Clear any stale
  //    staging directory from a prior interrupted attempt first so the staged
  //    content is exactly this snapshot (the publish never carries debris).
  let staged: SafePath;
  try {
    await deps.root.removeStagingDir(slug);
    staged = await deps.root.createStagingDir(slug);
    await deps.root.materializeFiles(staged, snapshot.files);
  } catch (err) {
    await safeRemoveStaging(deps.root, slug);
    throw toInstallError(err);
  }

  // 6. Fresh local-content hash, recomputed from the bytes actually written to
  //    the staging directory (the directory that becomes the installed skill).
  const contentHash = await computeLocalContentHash(staged);

  // 7. Publish (atomic rename; backup-swap on overwrite).
  try {
    if (targetExists) await deps.root.moveSkillToBackup(slug);
    await deps.root.publishStaged(slug);
  } catch (err) {
    if (targetExists) await safeRestoreBackup(deps.root, slug);
    await safeRemoveStaging(deps.root, slug);
    throw toInstallError(err);
  }

  // 8. Record the manifest entry only after publish succeeds.
  const timestamp = new Date(now()).toISOString();
  const entry: SkillManifestEntry = {
    source,
    slug,
    remoteSourceHash: snapshot.remoteSourceHash as RemoteSourceHash,
    localContentHash: contentHash,
    installedAt: targetExists && managedEntry ? managedEntry.installedAt : timestamp,
    updatedAt: timestamp,
  };
  const nextManifest: SkillManifest = {
    version: MANIFEST_SCHEMA_VERSION,
    skills: { ...loaded.manifest.skills, [slug]: entry },
  };
  try {
    await deps.store.save(nextManifest);
  } catch (err) {
    // Roll the publish back so no unmanaged/partial skill survives.
    await safeRemoveSkillDir(deps.root, slug);
    if (targetExists) await safeRestoreBackup(deps.root, slug);
    await safeRemoveStaging(deps.root, slug);
    throw toInstallError(err);
  }

  // 9. Commit: drop the backup (overwrite) and clear the staging directory.
  // Best-effort: the install is already durable (skill published + manifest
  // saved), and a stale `.system` staging/backup entry is invisible to DSH and
  // cleaned up by the next install, so a cleanup hiccup must not fail a
  // completed install.
  if (targetExists) await safeRemoveBackup(deps.root, slug);
  await safeRemoveStaging(deps.root, slug);

  return {
    slug,
    source,
    remoteSourceHash: entry.remoteSourceHash,
    localContentHash: entry.localContentHash,
    installedAt: entry.installedAt,
    updatedAt: entry.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Snapshot validation (no filesystem mutation).
// ---------------------------------------------------------------------------

function validateSnapshotForInstall(root: SkillRoot, slug: string, snapshot: SkillSnapshot): void {
  const files = snapshot.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new InstallError('malformed-snapshot', 'snapshot contains no files');
  }

  const skillDir = root.skillDir(slug);
  const seen = new Set<string>();
  let hasSkillMd = false;

  for (const file of files) {
    // Re-validate and resolve every path through the safe-path boundary.
    try {
      root.relativeFile(skillDir, file.path);
    } catch (err) {
      if (err instanceof PathSafetyError) throw toInstallError(err);
      throw err;
    }

    // Duplicate detection (case-folded on case-insensitive roots, mirroring the
    // boundary so two paths that would collide on disk are refused).
    const key = root.caseInsensitive ? file.path.toLowerCase() : file.path;
    if (seen.has(key)) {
      throw new InstallError('malformed-snapshot', `snapshot contains a duplicate file path ${JSON.stringify(file.path)}`);
    }
    seen.add(key);

    if (file.path === 'SKILL.md') {
      hasSkillMd = true;
      validateSkillMd(slug, file.contents);
    }
  }

  if (!hasSkillMd) {
    throw new InstallError('malformed-snapshot', 'snapshot is missing SKILL.md');
  }
}

/** `SKILL.md` must declare a valid `name` (matching the slug) and a `description`. */
function validateSkillMd(slug: string, contents: string): void {
  const metadata = extractFrontmatterMetadata(contents);
  if (!metadata.name || !isValidSkillName(metadata.name)) {
    throw new InstallError('malformed-snapshot', 'SKILL.md frontmatter must declare a valid kebab-case name');
  }
  if (metadata.name !== slug) {
    throw new InstallError(
      'malformed-snapshot',
      `SKILL.md name ${JSON.stringify(metadata.name)} does not match the requested slug ${JSON.stringify(slug)}`,
    );
  }
  if (typeof metadata.description !== 'string' || metadata.description.trim() === '') {
    throw new InstallError('malformed-snapshot', 'SKILL.md frontmatter must declare a non-empty description');
  }
}

// ---------------------------------------------------------------------------
// Error normalization + best-effort cleanup helpers.
// ---------------------------------------------------------------------------

/** Map boundary/FS failures to the install error surface; pass typed errors through. */
function toInstallError(err: unknown): Error {
  if (err instanceof InstallError || isSkillsShError(err)) return err;
  if (err instanceof PathSafetyError) {
    if (err.code === 'invalid-skill-name') {
      return new InstallError('invalid-skill-name', err.message, { path: err.path });
    }
    if (err.code === 'filesystem-permission') {
      return new InstallError('filesystem-permission', err.message, { path: err.path });
    }
    if (
      err.code === 'unsafe-path' ||
      err.code === 'traversal' ||
      err.code === 'absolute-path' ||
      err.code === 'drive-letter-path' ||
      err.code === 'invalid-relative-path' ||
      err.code === 'symlink-escape'
    ) {
      return new InstallError('unsafe-path', err.message, { path: err.path });
    }
    // filesystem-error / not-found / not-a-directory: a write-time failure.
    return new InstallError('install-partial-failure', err.message, { path: err.path, cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (isPermissionErrno(err)) {
    return new InstallError('filesystem-permission', message, { cause: err });
  }
  return new InstallError('install-partial-failure', message, { cause: err });
}

// Rollback helpers are best-effort: they never mask the original failure.
async function safeRemoveStaging(root: SkillRoot, slug: string): Promise<void> {
  try {
    await root.removeStagingDir(slug);
  } catch {
    /* the original error is authoritative */
  }
}

async function safeRestoreBackup(root: SkillRoot, slug: string): Promise<void> {
  try {
    await root.restoreBackup(slug);
  } catch {
    /* the original error is authoritative */
  }
}

async function safeRemoveSkillDir(root: SkillRoot, slug: string): Promise<void> {
  try {
    await root.removeSkillDir(slug);
  } catch {
    /* the original error is authoritative */
  }
}

async function safeRemoveBackup(root: SkillRoot, slug: string): Promise<void> {
  try {
    await root.removeBackup(slug);
  } catch {
    /* post-commit cleanup must not fail a completed install */
  }
}
