import { mkdir, readdir, readFile, rename as fsRename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillRoot } from '../../src/path-safety';
import { recoverInterruptedSwap } from '../../src/update';
import { cleanupRoots, tempSkillsRoot } from './helpers';

afterEach(async () => {
  await cleanupRoots();
});

const stagingParent = (root: SkillRoot) => join(root.path, '.system', 'skill-manager', '.staging');

async function writeOld(root: SkillRoot, slug: string): Promise<void> {
  const dir = root.skillDir(slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'OLD.txt'), 'old content', 'utf8');
}

describe('recoverInterruptedSwap', () => {
  it('restores an orphaned backup when the skill directory is missing', async () => {
    const root = new SkillRoot(await tempSkillsRoot());
    await writeOld(root, 'x');
    await mkdir(stagingParent(root), { recursive: true });
    await fsRename(join(root.path, 'x'), join(stagingParent(root), '.backup-x'));

    await recoverInterruptedSwap(root);

    expect(await readFile(join(root.path, 'x', 'OLD.txt'), 'utf8')).toBe('old content');
    expect(await readdir(stagingParent(root))).toEqual([]);
  });

  it('removes a stale backup when the skill directory is already present', async () => {
    const root = new SkillRoot(await tempSkillsRoot());
    await writeOld(root, 'x');
    await mkdir(join(stagingParent(root), '.backup-x'), { recursive: true });
    await writeFile(join(stagingParent(root), '.backup-x', 'STALE.txt'), 'stale', 'utf8');

    await recoverInterruptedSwap(root);

    expect(await readFile(join(root.path, 'x', 'OLD.txt'), 'utf8')).toBe('old content');
    expect(await readdir(stagingParent(root))).toEqual([]);
  });

  it('ignores a regular in-progress staging directory (only .backup-* entries are recovered)', async () => {
    const root = new SkillRoot(await tempSkillsRoot());
    await mkdir(join(stagingParent(root), 'x'), { recursive: true });
    await writeFile(join(stagingParent(root), 'x', 'SKILL.md'), 'staged', 'utf8');

    await recoverInterruptedSwap(root);

    // The in-progress staged directory is left alone.
    expect(await readFile(join(stagingParent(root), 'x', 'SKILL.md'), 'utf8')).toBe('staged');
  });
});
