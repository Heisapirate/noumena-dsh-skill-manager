// Snapshot validation for the update transaction, composed from the existing
// boundaries: path safety (assertRelativePath) and the SKILL.md frontmatter
// extractor. The SkillsShClient already validates the payload *shape*; this
// adds the update-specific semantic checks the transaction must satisfy before
// anything is staged or replaced.

import { assertRelativePath } from '../path-safety';
import { extractFrontmatterMetadata } from '../skills-sh';
import type { SkillSnapshot } from '../skills-sh';
import { UpdateError } from './errors';

/**
 * Validate a fetched snapshot before any filesystem mutation. Refuses (1) an
 * empty snapshot, (2) any file path that fails the safe-relative-path grammar,
 * and (3) a snapshot whose `SKILL.md` frontmatter does not declare both `name`
 * and `description` (the plugin's minimum for a usable skill).
 */
export function assertSnapshotSafe(snapshot: SkillSnapshot): void {
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0) {
    throw new UpdateError('invalid-snapshot', 'snapshot contains no files');
  }
  for (const file of snapshot.files) {
    // Throws PathSafetyError (`traversal`, `unsafe-path`, …) on any escape form.
    assertRelativePath(file.path);
  }
  const skillMd = snapshot.files.find((file) => file.path === 'SKILL.md');
  if (!skillMd) {
    throw new UpdateError('invalid-snapshot', 'snapshot is missing SKILL.md');
  }
  const metadata = extractFrontmatterMetadata(skillMd.contents);
  if (!metadata.name || !metadata.description) {
    throw new UpdateError(
      'invalid-snapshot',
      'SKILL.md frontmatter must declare both a name and a description',
    );
  }
}
