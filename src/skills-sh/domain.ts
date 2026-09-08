// Pure, deterministic helpers that interpret skills.sh identifiers and
// sources. Kept separate from the HTTP client so they are testable with no
// network and reusable by downstream tickets (#13/#14/#16).

import type { SourceKind } from './types';

/** The skills.sh base URL used for page links. */
export const SKILLS_SH_BASE_URL = 'https://skills.sh';

/**
 * Classify a skills.sh `source`. GitHub sources are exactly `owner/repo` (two
 * non-empty `/`-separated segments with no scheme and no dot in the owner,
 * which disambiguates a well-known domain-with-path like `example.com/foo`).
 * Anything else is a well-known (domain) source. (ADR-0004)
 */
export function classifySource(source: unknown): SourceKind {
  if (typeof source !== 'string') return 'well-known';
  const value = source.trim();
  if (value === '' || value.includes('://')) return 'well-known';
  const segments = value.split('/');
  if (segments.length !== 2) return 'well-known';
  const [owner, repo] = segments;
  if (owner === '' || repo === '' || owner.includes('.')) return 'well-known';
  return 'github';
}

/** The kebab-case slug: the final `/`-separated segment of a skills.sh id. */
export function slugFromId(id: string): string {
  const segments = id.split('/');
  return segments[segments.length - 1] ?? id;
}

/** Link to a skill's skills.sh page. */
export function toPageUrl(id: string): string {
  return `${SKILLS_SH_BASE_URL}/${id}`;
}

/** Split a download id `owner/repo/slug`; `null` when the shape is wrong. */
export function splitDownloadId(id: string): { owner: string; repo: string; slug: string } | null {
  const segments = id.split('/');
  if (segments.length !== 3) return null;
  const [owner, repo, slug] = segments;
  if (!owner || !repo || !slug) return null;
  return { owner, repo, slug };
}
