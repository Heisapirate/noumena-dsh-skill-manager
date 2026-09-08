// Minimal, non-throwing extraction of `SKILL.md` YAML frontmatter fields. The
// plugin only consumes `name` and `description`, so a hand-rolled extractor
// avoids pulling in a YAML dependency for these two top-level scalars.

import type { SkillMetadata } from './types';

/**
 * Extract top-level `name` and `description` scalars from a `SKILL.md`
 * frontmatter block (`---\n…\n---`). Never throws; returns `{}` when the
 * frontmatter is absent or malformed. Only top-level (unindented) keys are
 * read, so nested `metadata:` entries are ignored.
 */
export function extractFrontmatterMetadata(skillMd: string): SkillMetadata {
  const lines = skillMd.split(/\r?\n/);
  // Frontmatter must open on the first line with a standalone `---`.
  if (lines[0]?.trim() !== '---') return {};
  const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (closeIndex === -1) return {};

  const metadata: SkillMetadata = {};
  for (let index = 1; index < closeIndex; index++) {
    const match = /^(name|description)\s*:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const [, key, raw] = match;
    const value = unquoteScalar(raw.trim());
    if (key === 'name') metadata.name = value;
    else metadata.description = value;
  }
  return metadata;
}

/** Strip YAML double/single quotes and unescape the most common escapes. */
function unquoteScalar(raw: string): string {
  if (raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"') {
    return raw
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (raw.length >= 2 && raw[0] === "'" && raw[raw.length - 1] === "'") {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}
