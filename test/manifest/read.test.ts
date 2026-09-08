// Unit tests for the disk-based local-content-hash reader (Issue #17, spec §7/§11).
// The recorded localContentHash was computed over a skills.sh snapshot; this
// reader must reconstruct the same `{path, contents}` list from the installed
// files so a mismatch reliably signals local drift — without ever following a
// symlink/junction out of the skill directory.

import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { localContentHash } from '../../src/manifest/hash';
import { computeLocalContentHash, readSkillFiles } from '../../src/manifest/read';

const JUNCTION_SUPPORTED: boolean = (() => {
  try {
    const base = mkdtempSync(join(tmpdir(), 'dsh-read-junction-probe-'));
    const target = join(base, 'target');
    mkdirSync(target);
    symlinkSync(target, join(base, 'link'), 'junction');
    rmSync(base, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

const roots: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sm-read-'));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function writeFiles(dir: string, files: Array<{ path: string; contents: string }>): Promise<void> {
  for (const f of files) {
    const p = join(dir, ...f.path.split('/'));
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, f.contents, 'utf8');
  }
}

describe('readSkillFiles', () => {
  it('reconstructs the exact snapshot file list from disk', async () => {
    const dir = await tempDir();
    const files = [
      { path: 'SKILL.md', contents: '---\nname: x\n---\n# hi\n' },
      { path: 'docs/guide.md', contents: '# guide\n' },
    ];
    await writeFiles(dir, files);

    await expect(readSkillFiles(dir)).resolves.toEqual(files);
  });

  it('uses forward-slash relative paths for nested files', async () => {
    const dir = await tempDir();
    const files = [
      { path: 'z.md', contents: 'z' },
      { path: 'a/b/c.md', contents: 'c' },
      { path: 'a/a.md', contents: 'a' },
    ];
    await writeFiles(dir, files);

    const read = await readSkillFiles(dir);
    const sorted = (list: Array<{ path: string }>) => [...list].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
    expect(sorted(read)).toEqual(sorted(files));
  });

  it('returns an empty list for an empty directory', async () => {
    const dir = await tempDir();
    await expect(readSkillFiles(dir)).resolves.toEqual([]);
  });
});

describe('computeLocalContentHash', () => {
  it('matches the snapshot hash for an unmodified install', async () => {
    const dir = await tempDir();
    const files = [
      { path: 'SKILL.md', contents: '---\nname: x\n---\n# hi\n' },
      { path: 'docs/guide.md', contents: '# guide\n' },
    ];
    await writeFiles(dir, files);

    expect(await computeLocalContentHash(dir)).toBe(localContentHash(files));
  });

  it('returns the empty digest for an empty directory', async () => {
    const dir = await tempDir();
    expect(await computeLocalContentHash(dir)).toBe(localContentHash([]));
  });

  it.skipIf(!JUNCTION_SUPPORTED)('treats an interior symlink/junction as drift and never reads through it', async () => {
    const dir = await tempDir();
    const outside = await mkdtemp(join(tmpdir(), 'sm-read-out-'));
    roots.push(outside);
    await writeFile(join(outside, 'secret.txt'), 'precious');
    await writeFiles(dir, [{ path: 'SKILL.md', contents: 'x' }]);
    await symlink(outside, join(dir, 'link'), 'junction');

    const read = await readSkillFiles(dir);
    // The junction is encoded as a non-regular entry (its path contains NUL).
    expect(read.some((f) => f.path.includes('\u0000'))).toBe(true);
    // Nothing outside the skill dir was ever read into the hash inputs.
    expect(read.every((f) => f.contents !== 'precious')).toBe(true);

    const unmodified = localContentHash([{ path: 'SKILL.md', contents: 'x' }]);
    expect(await computeLocalContentHash(dir)).not.toBe(unmodified);
  });
});
