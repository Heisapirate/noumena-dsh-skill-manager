// Client search state model. Kept framework-agnostic (no React) so the search
// engine and description hydrator are unit-testable in plain Node.

import type { SkillSearchResult } from '../../types';

/** Top-level search lifecycle, mirroring the required #13 states. */
export type SearchStatus = 'idle' | 'loading' | 'results' | 'empty' | 'error';

/** Per-row description slot state. */
export type DescriptionStatus = 'idle' | 'loading' | 'loaded' | 'unavailable';

/** A row's description slot. */
export interface DescriptionState {
  status: DescriptionStatus;
  /** The hydrated description text; only meaningful when status is `loaded`. */
  text: string | null;
}

/** A search result enriched with its (progressive) description slot. */
export interface SearchResultRow extends SkillSearchResult {
  description: DescriptionState;
}

/** A normalized search-level failure the UI can render without raw internals. */
export interface SearchError {
  code: string;
  message: string;
}

/** The full client search snapshot handed to the UI on every change. */
export interface SearchSnapshot {
  status: SearchStatus;
  /** The committed (debounced) query that was searched or is being searched. */
  query: string;
  results: SearchResultRow[];
  error: SearchError | null;
}

export const idleDescription: DescriptionState = { status: 'idle', text: null };
export const unavailableDescription: DescriptionState = { status: 'unavailable', text: null };

/** The initial idle snapshot shared by the engine and the React hook. */
export const idleSnapshot: SearchSnapshot = { status: 'idle', query: '', results: [], error: null };
