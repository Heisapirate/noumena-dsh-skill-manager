import { mkdir, readdir, readFile, rename as fsRename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillRoot } from '../../src/path-safety';
import { recoverInterruptedSwap, swapStaged } from '../../src/update';
import { cleanupRoots, tempSkillsRoot } from './helpers';

afterEach(async () => {
  await cleanupRoots();
});

async function writeOld(root: SkillRoot, slug: string): Promise<void> {
  const dir = root.skillDir(slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'OLD.txt'), 'old content', 'utf8');
}

async function writeStaged(root: SkillRoot, slug: string, files: Record<string, string>): Promise<void> {
  const staging = await root.createStagingDir(slug);
  for (const [rel, contents] of Object.entries(files)) {
    const target = root.relativeFile(staging, rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }
}

describe('swapStaged', () => {
  it('replaces an existing skill directory and cleans the backup + staging', async () => {
    const root = new SkillRoot(await tempSkillsRoot());
    await writeOld(root, 'x');
    await writeStaged(root, 'x', { 'SKILL.md': 'new content' });

    await swapStaged(root, 'x');

    expect(await readFile(join(root.path, 'x', 'SKILL.md'), 'utf8')).toBe('new content');
    await expect(readFile(join(root.path, 'x', 'OLD.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readdir(join(root.path, '.system', 'skill-manager', '.staging', 'x'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readdir(join(root.path, '.system', 'skill-manager', '.staging'))).toEqual([]);
  });

  it('promotes the staged directory when the target does not exist yet', async () => {
    const root = new SkillRoot(await tempSkillsRoot());
    await writeStaged(root, 'x', { 'SKILL.md': 'new content' });

    await swapStaged(root, 'x');

    expect(await readFile(join(root.path, 'x', 'SKILL.md'), 'utf8')).toBe('new content');
  });

  it('restores the old directory when the promote rename fails', async () => {
    const root = new SkillRoot(await tempSkillsRoot());
    await writeOld(root, 'x');
    await writeStaged(root, 'x', { 'SKILL.md': 'new content' });

    let calls = 0;
    const rename = async (from: string, to: string) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated promote failure');
      await fsRename(from, to);
    };

    await expect(swapStaged(root, 'x', { rename })).rejects.toThrow('simulated promote failure');

    // Old installation is restored; the staged dir is left for later cleanup.
    expect(await readFile(join(root.path, 'x', 'OLD.txt'), 'utf8')).toBe('old content');
    expect(
      await readFile(join(root.path, '.system', 'skill-manager', '.staging', 'x', 'SKILL.md'), 'utf8'),
    ).toBe('new content');
  });
});

describe('recoverInterruptedSwap', () => {
  const stagingParent = (root: SkillRoot) => join(root.path, '.system', 'skill-manager', '.staging');

  it('restores an orphaned backup when the skill directory is missing', async () => {
    const root = new SkillRoot(await tempSkillsRoot());
    await writeOld(root, 'x');
    await mkdir(stagingParent(root), { recursive: true });
    await fsRename(join(root.path, 'x'), join(stagingParent(root), 'x-old'));

    await recoverInterruptedSwap(root);

    expect(await readFile(join(root.path, 'x', 'OLD.txt'), 'utf8')).toBe('old content');
    expect(await readdir(stagingParent(root))).toEqual([]);
  });

  it('removes a stale backup when the skill directory is already present', async () => {
    const root = new SkillRoot(await tempSkillsRoot());
    await writeOld(root, 'x');
    await mkdir(join(stagingParent(root), 'x-old'), { recursive: true });
    await writeFile(join(stagingParent(root), 'x-old', 'STALE.txt'), 'stale', 'utf8');

    await recoverInterruptedSwap(root);

    expect(await readFile(join(root.path, 'x', 'OLD.txt'), 'utf8')).toBe('old content');
    expect(await readdir(stagingParent(root))).toEqual([]);
  });
});
