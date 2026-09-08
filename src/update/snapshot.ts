// Snapshot validation for the update transaction, composed from the existing
// boundaries: the safe-path boundary (#11) resolves every file path, and the
// SKILL.md frontmatter extractor (#12) verifies a usable skill. The rules
// mirror the install transaction (#14) so the two cannot disagree: non-empty
// files, no unsafe/duplicate paths, and a `SKILL.md` whose `name` matches the
// slug and declares a non-empty `description`.

import { isValidSkillName, PathSafetyError, type SkillRoot } from '../path-safety';
import { extractFrontmatterMetadata } from '../skills-sh';
import type { SkillSnapshot } from '../skills-sh';
import { UpdateError } from './errors';

/**
 * Validate a fetched snapshot before any filesystem mutation. Refuses (1) an
 * empty snapshot, (2) any file path that fails safe resolution (mapped to
 * `unsafe-path`), (3) duplicate paths, and (4) a `SKILL.md` that is missing or
 * whose frontmatter name/description are invalid.
 */
export function assertSnapshotSafe(root: SkillRoot, slug: string, snapshot: SkillSnapshot): void {
  const files = snapshot.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new UpdateError('malformed-snapshot', 'snapshot contains no files');
  }

  const skillDir = root.skillDir(slug);
  const seen = new Set<string>();
  let hasSkillMd = false;

  for (const file of files) {
    try {
      root.relativeFile(skillDir, file.path);
    } catch (err) {
      if (err instanceof PathSafetyError) {
        throw new UpdateError('unsafe-path', err.message, { path: err.path });
      }
      throw err;
    }

    const key = root.caseInsensitive ? file.path.toLowerCase() : file.path;
    if (seen.has(key)) {
      throw new UpdateError('malformed-snapshot', `snapshot contains a duplicate file path ${JSON.stringify(file.path)}`);
    }
    seen.add(key);

    if (file.path === 'SKILL.md') {
      hasSkillMd = true;
      validateSkillMd(slug, file.contents);
    }
  }

  if (!hasSkillMd) {
    throw new UpdateError('malformed-snapshot', 'snapshot is missing SKILL.md');
  }
}

/** `SKILL.md` must declare a kebab-case `name` (equal to the slug) and a description. */
function validateSkillMd(slug: string, contents: string): void {
  const metadata = extractFrontmatterMetadata(contents);
  if (!metadata.name || !isValidSkillName(metadata.name)) {
    throw new UpdateError('malformed-snapshot', 'SKILL.md frontmatter must declare a valid kebab-case name');
  }
  if (metadata.name !== slug) {
    throw new UpdateError(
      'malformed-snapshot',
      `SKILL.md name ${JSON.stringify(metadata.name)} does not match the requested slug ${JSON.stringify(slug)}`,
    );
  }
  if (typeof metadata.description !== 'string' || metadata.description.trim() === '') {
    throw new UpdateError('malformed-snapshot', 'SKILL.md frontmatter must declare a non-empty description');
  }
}
