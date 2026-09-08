// Crash-window recovery for the update transaction (Issue #16, spec §10
// "reconcile on next load"). The actual backup-swap uses the shared SkillRoot
// primitives added by #14 (`moveSkillToBackup` / `publishStaged` /
// `restoreBackup` / `removeBackup`), whose backup slot is
// `.system/skill-manager/.staging/.backup-<slug>`.
//
// A hard crash between `moveSkillToBackup` and `publishStaged` leaves that
// backup present while the skill directory is missing; a crash after publish
// but before cleanup leaves a stale backup while the skill directory exists.
// This recovery repairs both on the next update check/transaction, going
// through the same SkillRoot primitives as every other mutation.

import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSkillName, type SkillRoot } from '../path-safety';

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
 * Repair an interrupted replacement. For each `.backup-<slug>` directory under
 * `.staging/`: restore it when the skill directory is missing, and remove it
 * when the skill directory is already present (stale backup). Best-effort —
 * recovery never masks the operation that triggered it.
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
    if (!entry.isDirectory() || !entry.name.startsWith('.backup-')) continue;
    const slug = entry.name.slice('.backup-'.length);
    if (!isValidSkillName(slug)) continue;

    if (await pathExists(root.skillDir(slug))) {
      await root.removeBackup(slug).catch(() => {});
    } else {
      await root.restoreBackup(slug).catch(() => {});
    }
  }
}
