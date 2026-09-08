// Progressive description hydration (spec §5, §16). Given a batch of result ids
// and a `describe(id, signal)` function, this hydrates descriptions with bounded
// concurrency, an in-memory cache, and cancellation — so a slow snapshot never
// blocks the result list, a superseded batch is discarded, and one bad row
// degrades to "description unavailable" without failing the rest.

import type { DescriptionState } from './types';

/** A settled (cacheable) description outcome. */
export type ResolvedDescription =
  | { status: 'loaded'; text: string | null }
  | { status: 'unavailable'; text: null };

export interface DescriptionHydratorOptions {
  /** Describes one id; rejects with an Error on failure (incl. AbortError). */
  describe: (id: string, signal: AbortSignal) => Promise<string | null>;
  /** Max concurrent describe calls; defaults to 4 (spec §16). */
  concurrency?: number;
  /** Called for each settled id (including cache hits) with its outcome. */
  onUpdate: (id: string, description: ResolvedDescription) => void;
}

export interface DescriptionHydrator {
  /** Start hydrating `ids`, cancelling any prior batch. Cache hits emit synchronously. */
  hydrate(ids: string[]): void;
  /** Abort the current batch; its late resolutions are ignored. */
  cancel(): void;
  /** Cancel everything and stop emitting updates. */
  dispose(): void;
  /** Whether an id already has a cached (settled) description. */
  isCached(id: string): boolean;
}

const DEFAULT_CONCURRENCY = 4;

export function createDescriptionHydrator(options: DescriptionHydratorOptions): DescriptionHydrator {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  // Session-scoped cache keyed by id (the skills.sh identity; subsumes the
  // spec's "slug cache" while staying correct when two skills share a slug).
  const cache = new Map<string, ResolvedDescription>();
  let batch = 0;
  let activeController: AbortController | null = null;
  let disposed = false;

  function cancel(): void {
    batch += 1;
    activeController?.abort();
    activeController = null;
  }

  function hydrate(ids: string[]): void {
    batch += 1;
    const seq = batch;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    const pending: string[] = [];
    for (const id of ids) {
      const cached = cache.get(id);
      if (cached) {
        // Cache hit: hydrate immediately, no network, no duplicate request.
        options.onUpdate(id, cached);
        continue;
      }
      if (!pending.includes(id)) pending.push(id);
    }
    runQueue(pending, seq, controller);
  }

  function runQueue(ids: string[], seq: number, controller: AbortController): void {
    let next = 0;
    let inFlight = 0;

    async function run(id: string): Promise<void> {
      try {
        const text = await options.describe(id, controller.signal);
        if (seq !== batch || disposed) return;
        const resolved: ResolvedDescription = { status: 'loaded', text };
        cache.set(id, resolved);
        options.onUpdate(id, resolved);
      } catch (err) {
        if (seq !== batch || disposed) return;
        if (isCancellation(err)) return;
        // Per-row isolation: a failure degrades only this row.
        const resolved: ResolvedDescription = { status: 'unavailable', text: null };
        cache.set(id, resolved);
        options.onUpdate(id, resolved);
      } finally {
        inFlight -= 1;
        if (seq === batch && !disposed) pump();
      }
    }

    function pump(): void {
      while (inFlight < concurrency && next < ids.length) {
        const id = ids[next];
        next += 1;
        inFlight += 1;
        void run(id);
      }
    }

    pump();
  }

  function dispose(): void {
    disposed = true;
    cancel();
  }

  return {
    hydrate,
    cancel,
    dispose,
    isCached: (id: string) => cache.has(id),
  };
}

function isCancellation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || (err as { code?: unknown }).code === 'cancelled')
  );
}
