// Install-action decision for search rows (Issue #18): the duplicate/
// already-managed state and the unavailable-source state are derived here in one
// place from the host-reported installability flag plus the managed slug set.

import { describe, expect, it } from 'vitest';
import { searchRowAction } from '../src/client/search/view';
import type { SearchResultRow } from '../src/client/search/types';
import { idleDescription } from '../src/client/search/types';

function row(overrides: Partial<SearchResultRow> = {}): SearchResultRow {
  return {
    id: 'owner/repo/slug',
    skillId: 'slug',
    name: 'slug',
    source: 'owner/repo',
    installs: 1,
    pageUrl: 'https://skills.sh/owner/repo/slug',
    installable: true,
    sourceKind: 'github',
    description: idleDescription,
    ...overrides,
  };
}

describe('searchRowAction', () => {
  it('offers a plain install for an installable, unmanaged row', () => {
    expect(searchRowAction(row(), new Set())).toEqual({ kind: 'install' });
  });

  it('offers an overwrite for a row whose slug is already managed', () => {
    expect(searchRowAction(row(), new Set(['slug']))).toEqual({ kind: 'overwrite' });
  });

  it('marks a non-GitHub source unavailable regardless of the managed set', () => {
    const wellKnown = row({
      id: 'example.com/thing',
      skillId: 'thing',
      source: 'example.com',
      installable: false,
      sourceKind: 'well-known',
    });
    expect(searchRowAction(wellKnown, new Set())).toEqual({ kind: 'unavailable' });
    expect(searchRowAction(wellKnown, new Set(['thing']))).toEqual({ kind: 'unavailable' });
  });

  it('never consults anything but installability and the managed slug set', () => {
    // A well-known row sharing a slug with a managed skill must still be
    // unavailable (ownership is manifest-based, never inferred from the slug).
    const wellKnown = row({
      id: 'example.com/slug',
      skillId: 'slug',
      source: 'example.com',
      installable: false,
      sourceKind: 'well-known',
    });
    expect(searchRowAction(wellKnown, new Set(['slug']))).toEqual({ kind: 'unavailable' });
  });
});
