// Safe staged-directory swap for the update transaction (Issue #16, spec §10).
//
// A plain `rename(staged, skillDir)` cannot replace a directory that already
// exists (the installed skill). The swap therefore moves the existing skill to
// a sibling backup path inside `.staging/` first, promotes the staged directory
// into place, and then deletes the backup (best-effort). The old installation
// is preserved on disk until the new directory is fully in place; if the
// promote rename fails, the backup is restored and the error rethrown.
//
// Because a directory swap cannot be a single atomic rename, a hard crash
// between the two renames leaves the backup in `.staging/<slug>-old` and the
// skill directory missing. `recoverInterruptedSwap` repairs that window on the
// next load: it restores an orphaned backup when the skill directory is gone,
// and removes a stale backup when the skill directory is present.

import { lstat, readdir, rename as fsRename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSkillName, type SkillRoot } from '../path-safety';

/** Injectable rename seam (defaults to `fs/promises.rename`). */
export type RenameFn = (from: string, to: string) => Promise<void>;

async function pathExists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/**
 * Replace `<skillsRoot>/<slug>` with the fully-staged `.staging/<slug>`
 * directory. Containment of both paths is asserted through the SkillRoot
 * boundary immediately before each rename.
 */
export async function swapStaged(
  root: SkillRoot,
  slug: string,
  options: { rename?: RenameFn } = {},
): Promise<void> {
  const rename = options.rename ?? fsRename;
  const from = root.stagingDir(slug);
  const to = root.skillDir(slug);
  const backup = `${from}-old`;
  root.assertInside(backup);
  await root.assertContainedReal(from);
  await root.assertContainedReal(to);

  if (!(await pathExists(to))) {
    await rename(from, to);
    return;
  }

  // Preserve the old installation before promoting the new one.
  await rename(to, backup);
  try {
    await rename(from, to);
  } catch (err) {
    // Best-effort restore; if this also fails, the backup still holds the old
    // files and `recoverInterruptedSwap` is the recovery path on next load.
    await rename(backup, to).catch(() => {});
    throw err;
  }
  // The swap has succeeded at this point; a backup-cleanup failure must not
  // fail it. A lingering backup is removed by `recoverInterruptedSwap` later.
  await rm(backup, { recursive: true, force: true }).catch(() => {});
}

/**
 * Repair an interrupted swap (spec §10 "reconcile on next load"). For each
 * `*-old` backup under `.staging/`: restore it when the skill directory is
 * missing (crash between the two renames), and remove it when the skill
 * directory is already present (stale backup after a successful swap whose
 * cleanup failed).
 */
export async function recoverInterruptedSwap(root: SkillRoot): Promise<void> {
  const stagingParent = join(root.path, '.system', 'skill-manager', '.staging');
  let entries;
  try {
    entries = await readdir(stagingParent, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith('-old')) continue;
    const slug = entry.name.slice(0, -'-old'.length);
    if (!isValidSkillName(slug)) continue;

    const backup = join(stagingParent, entry.name);
    const to = root.skillDir(slug);
    root.assertInside(backup);
    await root.assertContainedReal(backup);

    if (await pathExists(to)) {
      await rm(backup, { recursive: true, force: true }).catch(() => {});
    } else {
      await root.assertContainedReal(to);
      await fsRename(backup, to);
    }
  }
}
