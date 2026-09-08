import { describe, expect, it, vi } from 'vitest';
import { createSearchEngine } from '../src/client/search/engine';
import type { SearchEngineOptions } from '../src/client/search/engine';
import type { SearchSnapshot } from '../src/client/search/types';
import type { SkillSearchResult } from '../src/types';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function result(overrides: Partial<SkillSearchResult> = {}): SkillSearchResult {
  return {
    id: 'owner/repo/slug',
    skillId: 'slug',
    name: 'slug',
    source: 'owner/repo',
    installs: 170535,
    pageUrl: 'https://skills.sh/owner/repo/slug',
    installable: true,
    sourceKind: 'github',
    ...overrides,
  };
}

function wellKnown(): SkillSearchResult {
  return result({
    id: 'example.com/thing',
    skillId: 'thing',
    name: 'thing',
    source: 'example.com',
    installable: false,
    sourceKind: 'well-known',
    pageUrl: 'https://skills.sh/example.com/thing',
  });
}

type Deps = Partial<SearchEngineOptions>;

/** An engine whose debounce fires synchronously (deterministic tests). */
function immediate(deps: Deps = {}) {
  return createSearchEngine({
    search: deps.search ?? (async () => []),
    describe: deps.describe ?? (async () => null),
    minQueryLength: deps.minQueryLength,
    debounceMs: deps.debounceMs,
    concurrency: deps.concurrency,
    schedule: deps.schedule ?? ((fn) => {
      fn();
      return () => {};
    }),
  });
}

describe('search engine — minimum query', () => {
  it('stays idle and never searches for a too-short or blank query', async () => {
    const search = vi.fn(async () => [result()]);
    const engine = immediate({ search });
    engine.setQuery('a');
    engine.setQuery('   ');
    engine.setQuery('');
    await flush();
    expect(search).not.toHaveBeenCalled();
    expect(engine.getState()).toMatchObject({ status: 'idle', results: [], error: null });
  });

  it('searches once the query reaches the minimum length', async () => {
    const search = vi.fn(async () => [result()]);
    const engine = immediate({ search });
    engine.setQuery('py');
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('py', expect.any(AbortSignal));
  });
});

describe('search engine — debounce', () => {
  it('debounces rapid input into a single search after the delay', async () => {
    const search = vi.fn(async () => [result()]);
    const holder: { scheduled: { fn: () => void; ms: number } | null } = { scheduled: null };
    const engine = createSearchEngine({
      search,
      describe: async () => null,
      schedule: (fn, ms) => {
        holder.scheduled = { fn, ms };
        return () => {
          holder.scheduled = null;
        };
      },
    });

    engine.setQuery('py');
    expect(holder.scheduled?.ms).toBe(300); // default debounce
    expect(search).not.toHaveBeenCalled();

    engine.setQuery('pyt');
    engine.setQuery('python');
    expect(search).not.toHaveBeenCalled(); // still debouncing

    holder.scheduled!.fn();
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('python', expect.any(AbortSignal));
  });

  it('honours a configured debounce delay', () => {
    let scheduledMs = 0;
    const engine = createSearchEngine({
      search: async () => [],
      describe: async () => null,
      debounceMs: 250,
      schedule: (_fn, ms) => {
        scheduledMs = ms;
        return () => {};
      },
    });
    engine.setQuery('python');
    expect(scheduledMs).toBe(250);
  });
});

describe('search engine — immediate basic-result rendering contract', () => {
  it('emits results with basic fields while descriptions are still idle', async () => {
    const snapshots: SearchSnapshot[] = [];
    const engine = immediate({
      search: async () => [result({ name: 'python-skill' })],
      describe: async () => 'the description',
    });
    engine.subscribe((state) => snapshots.push(state));

    engine.setQuery('python');
    await flush();

    const resultsSnapshot = snapshots.find((state) => state.status === 'results');
    expect(resultsSnapshot).toBeDefined();
    expect(resultsSnapshot!.results[0]).toMatchObject({
      name: 'python-skill',
      source: 'owner/repo',
      installs: 170535,
      pageUrl: 'https://skills.sh/owner/repo/slug',
      installable: true,
    });
    // Basic fields render before the description arrives.
    expect(resultsSnapshot!.results[0].description.status).toBe('idle');

    // Then the description hydrates progressively.
    expect(engine.getState().results[0].description).toEqual({
      status: 'loaded',
      text: 'the description',
    });
  });

  it('preserves the skills.sh page link and metadata on every row', async () => {
    const engine = immediate({
      search: async () => [result({ installs: 42 })],
      describe: async () => null,
    });
    engine.setQuery('python');
    await flush();
    expect(engine.getState().results[0]).toMatchObject({
      pageUrl: 'https://skills.sh/owner/repo/slug',
      installs: 42,
      sourceKind: 'github',
    });
  });
});

describe('search engine — progressive hydration', () => {
  it('hydrates multiple rows and updates them individually', async () => {
    const engine = immediate({
      search: async () => [
        result({ id: 'a', skillId: 'a', name: 'a' }),
        result({ id: 'b', skillId: 'b', name: 'b' }),
      ],
      describe: async (id) => `desc:${id}`,
    });
    engine.setQuery('py');
    await flush();
    const byId = Object.fromEntries(engine.getState().results.map((row) => [row.id, row]));
    expect(byId.a.description).toEqual({ status: 'loaded', text: 'desc:a' });
    expect(byId.b.description).toEqual({ status: 'loaded', text: 'desc:b' });
  });
});

describe('search engine — metadata cache', () => {
  it('does not re-describe an id seen earlier in the session', async () => {
    const describe = vi.fn(async () => 'desc');
    const engine = immediate({ search: async () => [result()], describe });
    engine.setQuery('python');
    await flush();
    engine.setQuery('pytho'); // same result id
    await flush();
    expect(describe).toHaveBeenCalledTimes(1);
  });
});

describe('search engine — stale search suppression', () => {
  it('ignores a superseded search response', async () => {
    let resolveSlow!: (value: SkillSearchResult[]) => void;
    const engine = immediate({
      search: (query) => {
        if (query === 'slow') return new Promise((resolve) => (resolveSlow = resolve));
        return Promise.resolve([result({ name: 'fast-result' })]);
      },
      describe: async () => null,
    });
    engine.setQuery('slow');
    await flush(); // 'slow' in flight
    engine.setQuery('fast');
    await flush(); // 'fast' resolves

    resolveSlow([result({ name: 'slow-result' })]); // late stale response
    await flush();

    const state = engine.getState();
    expect(state).toMatchObject({ status: 'results', query: 'fast' });
    expect(state.results[0].name).toBe('fast-result');
  });

  it('does not surface a stale search rejection as an error', async () => {
    const search = vi.fn((_query: string, signal: AbortSignal) => {
      return new Promise<SkillSearchResult[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const engine = immediate({ search, describe: async () => null });
    engine.setQuery('first');
    await flush();
    engine.setQuery('second'); // aborts 'first'
    await flush();
    expect(engine.getState().status).not.toBe('error');
    expect(engine.getState().status).toBe('loading');
  });
});

describe('search engine — cancellation', () => {
  it('aborts the in-flight search signal when the query changes', async () => {
    const signals: AbortSignal[] = [];
    const engine = immediate({
      search: (_query, signal) => {
        signals.push(signal);
        return new Promise<SkillSearchResult[]>(() => {});
      },
      describe: async () => null,
    });
    engine.setQuery('first');
    await flush();
    engine.setQuery('second');
    await flush();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('aborts the in-flight hydration when the query changes', async () => {
    const aborted: string[] = [];
    const engine = immediate({
      search: async () => [result()],
      describe: (_id, signal) =>
        new Promise<string | null>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted.push('aborted');
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    });
    engine.setQuery('first');
    await flush(); // search resolves, hydration starts
    engine.setQuery('second'); // supersedes, cancels hydration
    await flush();
    expect(aborted).toContain('aborted');
  });
});

describe('search engine — states', () => {
  it('shows the empty state for a valid query with no results', async () => {
    const engine = immediate({ search: async () => [], describe: async () => null });
    engine.setQuery('zzzz');
    await flush();
    expect(engine.getState()).toMatchObject({ status: 'empty', query: 'zzzz', results: [] });
  });

  it('shows the error state on a search failure', async () => {
    const engine = immediate({
      search: async () => {
        throw new Error('network down');
      },
      describe: async () => null,
    });
    engine.setQuery('python');
    await flush();
    expect(engine.getState()).toMatchObject({
      status: 'error',
      results: [],
      error: { code: 'unknown' },
    });
  });

  it('shows loading while a search is in flight', async () => {
    let resolveSearch!: (value: SkillSearchResult[]) => void;
    const engine = immediate({
      search: () => new Promise((resolve) => (resolveSearch = resolve)),
      describe: async () => null,
    });
    engine.setQuery('python');
    expect(engine.getState().status).toBe('loading');
    resolveSearch([result()]);
    await flush();
    expect(engine.getState().status).toBe('results');
  });

  it('retry re-runs the last committed query', async () => {
    const search = vi.fn(async () => [result()]);
    const engine = immediate({ search, describe: async () => null });
    engine.setQuery('python');
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    engine.retry();
    await flush();
    expect(search).toHaveBeenCalledTimes(2);
    expect(search).toHaveBeenLastCalledWith('python', expect.any(AbortSignal));
  });
});

describe('search engine — per-row failure isolation', () => {
  it('keeps the whole list when one description fails', async () => {
    const engine = immediate({
      search: async () => [
        result({ id: 'a', skillId: 'a', name: 'a' }),
        result({ id: 'b', skillId: 'b', name: 'b' }),
      ],
      describe: async (id) => {
        if (id === 'a') throw new Error('boom');
        return `desc:${id}`;
      },
    });
    engine.setQuery('py');
    await flush();
    const byId = Object.fromEntries(engine.getState().results.map((row) => [row.id, row]));
    expect(engine.getState().status).toBe('results');
    expect(byId.a.description).toEqual({ status: 'unavailable', text: null });
    expect(byId.b.description).toEqual({ status: 'loaded', text: 'desc:b' });
  });
});

describe('search engine — unavailable/non-GitHub source state', () => {
  it('marks well-known sources unavailable without a describe call', async () => {
    const describe = vi.fn(async () => null);
    const engine = immediate({
      search: async () => [wellKnown(), result()],
      describe,
    });
    engine.setQuery('py');
    await flush();

    const wellKnownRow = engine.getState().results.find((row) => row.id === 'example.com/thing')!;
    expect(wellKnownRow.installable).toBe(false);
    expect(wellKnownRow.sourceKind).toBe('well-known');
    expect(wellKnownRow.description).toEqual({ status: 'unavailable', text: null });

    // Only the GitHub row is described.
    expect(describe).toHaveBeenCalledTimes(1);
    expect(describe).toHaveBeenCalledWith('owner/repo/slug', expect.any(AbortSignal));
  });
});

describe('search engine — bounded metadata concurrency', () => {
  it('propagates a concurrency limit to the hydrator', async () => {
    let active = 0;
    let peak = 0;
    const gates = new Map<string, () => void>();
    const engine = immediate({
      concurrency: 2,
      search: async () => [
        result({ id: 'a', skillId: 'a' }),
        result({ id: 'b', skillId: 'b' }),
        result({ id: 'c', skillId: 'c' }),
        result({ id: 'd', skillId: 'd' }),
      ],
      describe: (id) =>
        new Promise<string | null>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          gates.set(id, () => {
            active -= 1;
            resolve(`desc:${id}`);
          });
        }),
    });
    engine.setQuery('py');
    await flush();
    expect(peak).toBe(2);
  });
});
