// Recompute the plugin's local-content hash from the files actually installed
// on disk (spec §7, §11(2)). The recorded `localContentHash` was computed over a
// skills.sh snapshot; this reader reconstructs the same `{path, contents}` list
// from the skill directory, so a mismatch reliably signals local drift.
//
// Safety: the walk is lstat-based and never follows a symlink/junction. A
// symlink/junction (or any non-regular, non-directory entry) is encoded as a
// synthetic entry whose path contains a NUL byte — which a validated snapshot
// path can never contain — so its presence always changes the hash (drift)
// without reading through the link to anything outside the skill directory.

import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { toFilesystemError } from '../errors';
import { localContentHash } from './hash';
import type { LocalContentHash, SkillFile } from './types';

/** Prefix for synthetic entries that can never collide with a real snapshot path. */
const NON_REGULAR_MARKER = '\u0000';

/** Read a skill directory into the same `{path, contents}` list a snapshot would have. */
export async function readSkillFiles(skillDir: string): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  await walk(skillDir, '');
  // Deterministic order regardless of the host's readdir order (the hash
  // re-sorts by byte order anyway, but a stable list is easier to reason about).
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;

  async function walk(dir: string, prefix: string): Promise<void> {
    const names = await readdir(dir).catch((err) => {
      throw toFilesystemError(err, dir);
    });
    for (const name of names) {
      const rel = prefix === '' ? name : `${prefix}/${name}`;
      const abs = join(dir, name);
      const st = await lstat(abs).catch((err) => {
        throw toFilesystemError(err, abs);
      });

      if (st.isDirectory()) {
        await walk(abs, rel);
      } else if (st.isFile()) {
        const contents = await readFile(abs, 'utf8').catch((err) => {
          throw toFilesystemError(err, abs);
        });
        files.push({ path: rel, contents });
      } else if (st.isSymbolicLink()) {
        // Do not follow: read only the link text and mark it as drift.
        const target = await readlink(abs).catch((err) => {
          throw toFilesystemError(err, abs);
        });
        files.push({ path: `${rel}${NON_REGULAR_MARKER}symlink`, contents: target });
      } else {
        // Sockets, devices, etc. — encode as drift rather than silently ignore.
        files.push({ path: `${rel}${NON_REGULAR_MARKER}special`, contents: '' });
      }
    }
  }
}

/** Recompute the local-content hash from the files on disk under a skill directory. */
export async function computeLocalContentHash(skillDir: string): Promise<LocalContentHash> {
  return localContentHash(await readSkillFiles(skillDir));
}
