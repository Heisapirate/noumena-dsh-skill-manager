// The client search engine: debounce + minimum-query gating + stale-response
// suppression, feeding a progressive description hydrator. Framework-agnostic
// so it is unit-testable in Node; the React hook (`useSkillSearch`) is a thin
// adapter. Network access stays host-side — this module only orchestrates the
// typed `search`/`describe` functions it is given.

import type { SkillSearchResult } from '../../types';
import { createDescriptionHydrator } from './hydrator';
import type { DescriptionHydrator } from './hydrator';
import {
  idleDescription,
  unavailableDescription,
  type DescriptionState,
  type SearchError,
  type SearchResultRow,
  type SearchSnapshot,
} from './types';

export interface SearchEngineOptions {
  /** Typed search: returns basic results (no descriptions). */
  search: (query: string, signal: AbortSignal) => Promise<SkillSearchResult[]>;
  /** Typed per-row hydration: returns one description or null. */
  describe: (id: string, signal: AbortSignal) => Promise<string | null>;
  /** Minimum query length before a search fires; defaults to 2. */
  minQueryLength?: number;
  /** Debounce delay; defaults to 300ms (spec §16: 250–350ms). */
  debounceMs?: number;
  /** Hydration concurrency; defaults to 4 (spec §16). */
  concurrency?: number;
  /** Injected debounce scheduler; defaults to setTimeout (tests inject a stub). */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export interface SearchEngine {
  /** Submit a new raw query; debounces and gates on minimum length. */
  setQuery(query: string): void;
  /** Re-run the last committed query immediately (e.g. from the error retry). */
  retry(): void;
  getState(): SearchSnapshot;
  subscribe(listener: (state: SearchSnapshot) => void): () => void;
  dispose(): void;
}

const DEFAULT_MIN_QUERY_LENGTH = 2;
const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_CONCURRENCY = 4;

const IDLE_SNAPSHOT: SearchSnapshot = { status: 'idle', query: '', results: [], error: null };

export function createSearchEngine(options: SearchEngineOptions): SearchEngine {
  const minQueryLength = options.minQueryLength ?? DEFAULT_MIN_QUERY_LENGTH;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const schedule = options.schedule ?? defaultSchedule;

  let snapshot: SearchSnapshot = { ...IDLE_SNAPSHOT };
  const listeners = new Set<(state: SearchSnapshot) => void>();

  let debounceCancel: (() => void) | null = null;
  let searchSeq = 0;
  let searchController: AbortController | null = null;
  let disposed = false;

  const hydrator: DescriptionHydrator = createDescriptionHydrator({
    describe: options.describe,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
    onUpdate: applyDescription,
  });

  function setState(next: SearchSnapshot): void {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  }

  function applyDescription(id: string, description: DescriptionState): void {
    if (snapshot.status !== 'results' && snapshot.status !== 'empty') return;
    if (!snapshot.results.some((row) => row.id === id)) return;
    setState({
      ...snapshot,
      results: snapshot.results.map((row) => (row.id === id ? { ...row, description } : row)),
    });
  }

  function abortSearch(): void {
    searchSeq += 1;
    searchController?.abort();
    searchController = null;
  }

  function setQuery(raw: string): void {
    if (disposed) return;
    cancelDebounce();
    const query = raw.trim();
    // Any in-flight work is now stale: abort both the search and its hydration.
    abortSearch();
    hydrator.cancel();
    if (query.length < minQueryLength) {
      setState({ status: 'idle', query: '', results: [], error: null });
      return;
    }
    debounceCancel = schedule(() => runSearch(query), debounceMs);
  }

  function retry(): void {
    if (disposed) return;
    cancelDebounce();
    const query = snapshot.query.trim();
    if (query.length < minQueryLength) return;
    void runSearch(query);
  }

  async function runSearch(query: string): Promise<void> {
    abortSearch();
    const seq = ++searchSeq;
    const controller = new AbortController();
    searchController = controller;
    setState({ status: 'loading', query, results: [], error: null });
    try {
      const results = await options.search(query, controller.signal);
      if (seq !== searchSeq || disposed) return; // superseded: ignore
      const rows: SearchResultRow[] = results.map((result) => ({
        ...result,
        // Non-GitHub sources have no snapshot endpoint (ADR-0004), so their
        // description is unavailable without a network attempt.
        description: result.installable ? idleDescription : unavailableDescription,
      }));
      const nextStatus: SearchSnapshot['status'] = rows.length > 0 ? 'results' : 'empty';
      setState({ status: nextStatus, query, results: rows, error: null });
      hydrator.hydrate(rows.filter((row) => row.installable).map((row) => row.id));
    } catch (err) {
      if (seq !== searchSeq || disposed) return; // stale, ignore
      if (isCancellation(err)) return; // cancelled: not a user-facing failure
      setState({ status: 'error', query, results: [], error: toSearchError(err) });
    }
  }

  function cancelDebounce(): void {
    debounceCancel?.();
    debounceCancel = null;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelDebounce();
    abortSearch();
    hydrator.dispose();
    listeners.clear();
  }

  return {
    setQuery,
    retry,
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose,
  };
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
}

function toSearchError(err: unknown): SearchError {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return { code: typeof code === 'string' ? code : 'unknown', message: err.message };
  }
  return { code: 'unknown', message: String(err) };
}

function isCancellation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || (err as { code?: unknown }).code === 'cancelled')
  );
}
