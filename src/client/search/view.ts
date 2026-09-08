// Pure derivation of the install action a search row offers (Issue #18). The
// decision depends only on the row's installability (host-reported) and whether
// its slug is already plugin-managed — never on a filesystem path, directory
// presence, or a user-entered slug — so the React row renders the action without
// re-implementing ownership logic.

import type { SearchResultRow } from './types';

/** The install action a search row exposes. */
export type SearchRowAction =
  | { kind: 'unavailable' }
  | { kind: 'overwrite' }
  | { kind: 'install' };

/**
 * Decide what install action a row offers:
 * - a non-GitHub (well-known) source is unavailable (ADR-0004);
 * - a skill whose slug is already plugin-managed offers an overwrite (duplicate);
 * - everything else offers a plain install.
 */
export function searchRowAction(
  row: SearchResultRow,
  managedSlugs: ReadonlySet<string>,
): SearchRowAction {
  if (!row.installable) return { kind: 'unavailable' };
  if (managedSlugs.has(row.skillId)) return { kind: 'overwrite' };
  return { kind: 'install' };
}
