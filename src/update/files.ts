// Read a validated directory back into the snapshot-file shape so a local
// content hash can be recomputed and compared to a recorded value (spec §7).
// Symlinks/junctions are never followed: a link is fingerprinted by its target
// string, keeping the recompute deterministic and contained.

import { readFile, readdir, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillFile } from '../manifest';
import type { SafePath, SkillRoot } from '../path-safety';

/**
 * Read every regular file under a validated directory (already branded as a
 * `SafePath`) into `{path, contents}` entries, with `/`-separated relative
 * paths. Symlinks are recorded by target string, never followed.
 */
export async function readDirFiles(root: SkillRoot, dir: SafePath): Promise<SkillFile[]> {
  root.assertInside(dir);
  const files: SkillFile[] = [];
  const pending: Array<{ abs: string; rel: string }> = [{ abs: dir, rel: '' }];

  while (pending.length > 0) {
    const { abs, rel } = pending.pop()!;
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch (err) {
      // The directory disappeared between reconcile and read; treat as empty.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const absPath = join(abs, entry.name);
      if (entry.isSymbolicLink()) {
        files.push({ path: relPath, contents: await readlink(absPath) });
      } else if (entry.isDirectory()) {
        pending.push({ abs: absPath, rel: relPath });
      } else if (entry.isFile()) {
        files.push({ path: relPath, contents: await readFile(absPath, 'utf8') });
      }
      // Sockets/FIFOs and other special files are ignored.
    }
  }
  return files;
}

/** Read a plugin-managed skill's files (the directory is resolved + validated first). */
export function readSkillFiles(root: SkillRoot, slug: string): Promise<SkillFile[]> {
  return readDirFiles(root, root.skillDir(slug));
}
