// Deterministic local-content fingerprint (spec §7, architecture §4.5).

import { createHash } from 'node:crypto';
import type { LocalContentHash, SkillFile } from './types';

/**
 * Compare two relative paths by their UTF-8 byte order. The spec requires files
 * to be sorted "by relative path (byte order)"; JavaScript's default string
 * sort is UTF-16 code-unit order, which differs from byte order for non-BMP
 * characters, so the comparison is explicit rather than relying on `.sort()`.
 */
function compareByteOrder(a: string, b: string): number {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return Buffer.compare(ab, bb);
}

/**
 * The plugin's deterministic local-content hash: SHA-256 over files sorted by
 * relative path (byte order), the digest updated with each file's path followed
 * by its contents. Used only to detect local modification/drift. It is never
 * compared to `remoteSourceHash`, which is an opaque upstream fingerprint.
 */
export function localContentHash(files: readonly SkillFile[]): LocalContentHash {
  const sorted = [...files].sort((a, b) => compareByteOrder(a.path, b.path));
  const digest = createHash('sha256');
  for (const file of sorted) {
    digest.update(file.path, 'utf8');
    digest.update(file.contents, 'utf8');
  }
  return digest.digest('hex') as LocalContentHash;
}
