// Security-focused unit + filesystem tests for the path-safety boundary
// (Issue #11, production spec §8). These prove both the string-level rules
// (grammar, traversal, absolute/drive/UNC forms, prefix trap, case) and the
// filesystem semantics (realpath/lstat containment, junction escape, and that
// recursive delete never follows a symlink/junction).
//
// The skills root and every mutation target are confined to temp directories
// created per test; nothing here ever touches a real DSH skills root or
// `.proto-dsh-home`.

import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SKILL_NAME_RE,
  PathSafetyError,
  SkillRoot,
  assertRelativePath,
  assertSkillName,
  isValidSkillName,
} from '../src/path-safety';

/** True when this machine can create Windows directory junctions (no Dev Mode needed). */
const JUNCTION_SUPPORTED: boolean = (() => {
  try {
    const base = mkdtempSync(join(tmpdir(), 'dsh-junction-probe-'));
    const target = join(base, 'target');
    mkdirSync(target);
    symlinkSync(target, join(base, 'link'), 'junction');
    rmSync(base, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

describe('skill name grammar (SKILL_NAME_RE / isValidSkillName / assertSkillName)', () => {
  it.each(['a', 'abc', 'a-b', 'a-b-c', '0', '0-9', 'a0-b1', 'my-skill', 'search-skills', '2fa'])(
    'accepts valid kebab-case name %s',
    (name) => {
      expect(SKILL_NAME_RE.test(name)).toBe(true);
      expect(isValidSkillName(name)).toBe(true);
      expect(() => assertSkillName(name)).not.toThrow();
    },
  );

  it.each([
    '', '.', '..', '../escape', '../../escape', 'a/b', 'a\\b', 'a\\..\\b',
    'C:\\skills', 'c:/skills', '/abs', '\\abs', '\\\\unc\\share',
    'Foo', 'foo_', 'foo.bar', '-foo', 'foo-', 'foo--bar', 'foo bar', 'foo\tbar',
  ])('rejects invalid name %j', (name) => {
    expect(SKILL_NAME_RE.test(name)).toBe(false);
    expect(isValidSkillName(name)).toBe(false);
    expect(() => assertSkillName(name)).toThrowError(
      expect.objectContaining({ code: 'invalid-skill-name' }),
    );
  });
});

describe('SkillRoot.skillDir', () => {
  it('resolves a validated name strictly inside the skills root', () => {
    const base = join(tmpdir(), 'dsh-skills');
    const root = new SkillRoot(base);
    expect(root.skillDir('my-skill')).toBe(resolve(base, 'my-skill'));
  });

  it('refuses an invalid name before touching the filesystem', () => {
    const root = new SkillRoot(join(tmpdir(), 'dsh-skills'));
    expect(() => root.skillDir('../escape')).toThrowError(
      expect.objectContaining({ code: 'invalid-skill-name' }),
    );
    expect(() => root.skillDir('C:\\evil')).toThrowError(
      expect.objectContaining({ code: 'invalid-skill-name' }),
    );
  });
});

describe('assertRelativePath (snapshot file path classification)', () => {
  const ok = null;
  const cases: Array<[string, string | null]> = [
    ['SKILL.md', ok],
    ['docs/guide.md', ok],
    ['a/b/c.md', ok],
    ['0/9/x.md', ok],
    ['name with spaces.md', ok],
    // empty / self / parent
    ['', 'invalid-relative-path'],
    ['.', 'invalid-relative-path'],
    ['..', 'traversal'],
    ['../escape', 'traversal'],
    ['../../escape', 'traversal'],
    ['a/../../b', 'traversal'],
    ['a/../b', 'traversal'],
    ['./a', 'invalid-relative-path'],
    ['a/./b', 'invalid-relative-path'],
    ['a//b', 'invalid-relative-path'],
    ['a/', 'invalid-relative-path'],
    // absolute / rooted
    ['/etc/passwd', 'absolute-path'],
    ['\\etc\\passwd', 'absolute-path'],
    ['\\\\server\\share\\x', 'absolute-path'],
    ['//server/share/x', 'absolute-path'],
    // drive letter
    ['C:\\Windows\\x', 'drive-letter-path'],
    ['C:/Windows/x', 'drive-letter-path'],
    ['c:foo', 'drive-letter-path'],
    // backslash separators + traversal
    ['..\\escape', 'traversal'],
    ['..\\..\\escape', 'traversal'],
    ['a\\b', 'invalid-relative-path'],
    ['a\\b/c', 'invalid-relative-path'],
    ['a/..\\b', 'traversal'],
    // NUL byte
    ['\u0000evil', 'invalid-relative-path'],
  ];

  it.each(cases)('classifies %j', (input, expectedCode) => {
    if (expectedCode === null) {
      expect(() => assertRelativePath(input)).not.toThrow();
    } else {
      expect(() => assertRelativePath(input)).toThrowError(
        expect.objectContaining({ code: expectedCode }),
      );
    }
  });
});

describe('SkillRoot.relativeFile', () => {
  const base = join(tmpdir(), 'dsh-skills');
  const root = new SkillRoot(base);

  it('resolves a nested snapshot file inside the skill dir', () => {
    const dir = root.skillDir('my-skill');
    expect(root.relativeFile(dir, 'docs/guide.md')).toBe(join(dir, 'docs', 'guide.md'));
  });

  it('refuses a file that escapes its skill dir', () => {
    const dir = root.skillDir('my-skill');
    expect(() => root.relativeFile(dir, '../other')).toThrowError(
      expect.objectContaining({ code: 'traversal' }),
    );
  });

  it('refuses an absolute snapshot path', () => {
    const dir = root.skillDir('my-skill');
    expect(() => root.relativeFile(dir, '/etc/passwd')).toThrowError(
      expect.objectContaining({ code: 'absolute-path' }),
    );
  });

  it('refuses a drive-letter snapshot path', () => {
    const dir = root.skillDir('my-skill');
    expect(() => root.relativeFile(dir, 'C:\\Windows\\x')).toThrowError(
      expect.objectContaining({ code: 'drive-letter-path' }),
    );
  });

  it('re-validates even a branded skill dir (defense in depth)', () => {
    const foreignDir = join(base, '..', 'foreign') as never;
    expect(() => root.relativeFile(foreignDir, 'x.md')).toThrowError(
      expect.objectContaining({ code: 'unsafe-path' }),
    );
  });
});

describe('containment (pure, no filesystem)', () => {
  it('rejects a sibling sharing a prefix (prefix trap)', () => {
    const parent = tmpdir();
    const root = new SkillRoot(join(parent, 'skills'));
    expect(root.isInside(join(parent, 'skills-evil'))).toBe(false);
    expect(root.isInside(join(parent, 'skills-evil', 'x'))).toBe(false);
    expect(root.isInside(join(parent, 'skills', 'foo'))).toBe(true);
    expect(root.isInside(join(parent, 'skills', 'a', 'b'))).toBe(true);
  });

  it('rejects the skills root itself (strict containment)', () => {
    const base = join(tmpdir(), 'dsh-skills');
    const root = new SkillRoot(base);
    expect(root.isInside(base)).toBe(false);
    expect(() => root.assertInside(base)).toThrowError(
      expect.objectContaining({ code: 'unsafe-path' }),
    );
  });

  it('rejects a nested traversal from a resolved absolute path', () => {
    const parent = tmpdir();
    const root = new SkillRoot(join(parent, 'skills'));
    expect(root.isInside(resolve(join(parent, 'skills'), '..', 'elsewhere'))).toBe(false);
  });

  it('is case-insensitive by default on Windows', () => {
    const base = join(tmpdir(), 'Skills');
    const root = new SkillRoot(base);
    expect(root.isInside(join(tmpdir(), 'skills', 'foo'))).toBe(process.platform === 'win32');
  });

  it('honors an explicit caseInsensitive option cross-platform', () => {
    const base = join(tmpdir(), 'Skills');
    expect(new SkillRoot(base, { caseInsensitive: true }).isInside(join(tmpdir(), 'skills', 'foo'))).toBe(true);
    expect(new SkillRoot(base, { caseInsensitive: false }).isInside(join(tmpdir(), 'skills', 'foo'))).toBe(false);
  });

  it.skipIf(process.platform !== 'win32')('rejects the Windows drive prefix trap C:\\skills vs C:\\skills-evil', () => {
    const root = new SkillRoot('C:\\skills', { caseInsensitive: true });
    expect(root.isInside('C:\\skills-evil')).toBe(false);
    expect(root.isInside('C:\\skills\\foo')).toBe(true);
    expect(root.isInside('C:\\SKILLS\\foo')).toBe(true); // case-insensitive
  });

  it.skipIf(process.platform !== 'win32')('rejects a candidate on a different drive', () => {
    const root = new SkillRoot('C:\\skills', { caseInsensitive: true });
    expect(root.isInside('D:\\skills\\foo')).toBe(false);
  });
});

describe('SkillRoot filesystem behavior', () => {
  let rootPath: string;
  let root: SkillRoot;

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'dsh-path-safety-'));
    root = new SkillRoot(rootPath);
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it('createStagingDir creates a contained, idempotent staging directory', async () => {
    const staged = await root.createStagingDir('my-skill');
    expect(staged).toBe(join(rootPath, '.system', 'skill-manager', '.staging', 'my-skill'));
    expect(root.isInside(staged)).toBe(true);
    expect(await exists(staged)).toBe(true);

    const again = await root.createStagingDir('my-skill');
    expect(again).toBe(staged);
    expect(await exists(staged)).toBe(true);
  });

  it('publishStaged atomically moves a staged directory into the skill dir', async () => {
    await root.createStagingDir('pkg-a');
    const staged = root.stagingDir('pkg-a');
    await writeFile(join(staged, 'SKILL.md'), '---\nname: pkg-a\n---\n# hi\n');

    await root.publishStaged('pkg-a');

    const skillDir = root.skillDir('pkg-a');
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toContain('name: pkg-a');
    expect(await exists(staged)).toBe(false);
  });

  it('removeSkillDir deletes a validated skill dir and is idempotent', async () => {
    const dir = root.skillDir('gone');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), 'x');

    await root.removeSkillDir('gone');
    expect(await exists(dir)).toBe(false);

    await expect(root.removeSkillDir('gone')).resolves.toBeUndefined();
  });

  it('removeStagingDir is idempotent', async () => {
    await root.createStagingDir('tmp');
    await root.removeStagingDir('tmp');
    expect(await exists(root.stagingDir('tmp'))).toBe(false);
    await expect(root.removeStagingDir('tmp')).resolves.toBeUndefined();
  });

  it('assertContainedReal accepts a real contained target and a missing target inside root', async () => {
    const dir = root.skillDir('real');
    await mkdir(dir, { recursive: true });
    await expect(root.assertContainedReal(dir)).resolves.toBeUndefined();
    await expect(root.assertContainedReal(join(dir, 'missing', 'deeper'))).resolves.toBeUndefined();
  });

  it('refuses deletion of a target outside the skills root (foreign target)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-foreign-'));
    await expect(root.assertContainedReal(outside)).rejects.toMatchObject({ code: 'unsafe-path' });
    await rm(outside, { recursive: true, force: true });
  });

  it.skipIf(!JUNCTION_SUPPORTED)('refuses a junction that escapes the skills root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-'));
    const link = join(rootPath, 'esc');
    await symlink(outside, link, 'junction');

    await expect(root.assertContainedReal(link)).rejects.toMatchObject({ code: 'symlink-escape' });

    await rm(outside, { recursive: true, force: true });
  });

  it.skipIf(!JUNCTION_SUPPORTED)('refuses to delete a skill dir that is a junction escaping the root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-'));
    const victim = join(outside, 'victim.txt');
    await writeFile(victim, 'precious');
    await symlink(outside, root.skillDir('evil'), 'junction');

    await expect(root.removeSkillDir('evil')).rejects.toMatchObject({ code: 'symlink-escape' });
    expect(await exists(victim)).toBe(true); // nothing outside was touched

    await rm(outside, { recursive: true, force: true });
  });

  it.skipIf(!JUNCTION_SUPPORTED)('createStagingDir refuses a junction inside the staging path', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-'));
    await mkdir(join(rootPath, '.system', 'skill-manager'), { recursive: true });
    await symlink(outside, join(rootPath, '.system', 'skill-manager', '.staging'), 'junction');

    await expect(root.createStagingDir('x')).rejects.toMatchObject({ code: 'symlink-escape' });
    expect(await exists(join(outside, 'x'))).toBe(false); // never wrote through the junction

    await rm(outside, { recursive: true, force: true });
  });

  it.skipIf(!JUNCTION_SUPPORTED)('recursive delete never follows a symlink/junction inside a skill dir', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-'));
    const victim = join(outside, 'victim.txt');
    await writeFile(victim, 'precious');

    const dir = root.skillDir('with-link');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), 'x');
    await symlink(outside, join(dir, 'link'), 'junction');

    await root.removeSkillDir('with-link');

    expect(await exists(dir)).toBe(false);
    expect(await exists(victim)).toBe(true); // the junction target survived

    await rm(outside, { recursive: true, force: true });
  });
});

describe('PathSafetyError', () => {
  it('exposes a typed RPC-normalizable shape', () => {
    const err = new PathSafetyError('traversal', 'bad path', '/x/y');
    expect(err.code).toBe('traversal');
    expect(err.path).toBe('/x/y');
    expect(err.toRpcError()).toEqual({
      code: 'traversal',
      message: 'bad path',
      details: { path: '/x/y' },
    });
  });

  it('omits details.path when none was provided', () => {
    expect(new PathSafetyError('invalid-skill-name', 'nope').toRpcError()).toEqual({
      code: 'invalid-skill-name',
      message: 'nope',
      details: {},
    });
  });
});
