import { describe, expect, it } from 'vitest';
import { createDescriptionHydrator } from '../src/client/search/hydrator';
import type { ResolvedDescription } from '../src/client/search/hydrator';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function collect() {
  const updates: Record<string, ResolvedDescription> = {};
  const calls: string[] = [];
  return { updates, calls };
}

describe('createDescriptionHydrator', () => {
  it('hydrates descriptions progressively and reports each outcome', async () => {
    const { updates, calls } = collect();
    const hydrator = createDescriptionHydrator({
      describe: async (id) => {
        calls.push(id);
        return `desc:${id}`;
      },
      onUpdate: (id, description) => {
        updates[id] = description;
      },
    });
    hydrator.hydrate(['a', 'b', 'c']);
    await flush();
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(updates.a).toEqual({ status: 'loaded', text: 'desc:a' });
    expect(updates.b).toEqual({ status: 'loaded', text: 'desc:b' });
    expect(updates.c).toEqual({ status: 'loaded', text: 'desc:c' });
  });

  it('bounds in-flight describe calls to the concurrency limit', async () => {
    const gates = new Map<string, () => void>();
    let active = 0;
    let peak = 0;
    const started: string[] = [];

    const hydrator = createDescriptionHydrator({
      concurrency: 2,
      describe: (id) =>
        new Promise<string | null>((resolve) => {
          started.push(id);
          active += 1;
          peak = Math.max(peak, active);
          gates.set(id, () => {
            active -= 1;
            resolve(`desc:${id}`);
          });
        }),
      onUpdate: () => {},
    });

    hydrator.hydrate(['a', 'b', 'c', 'd', 'e']);
    expect(started).toEqual(['a', 'b']);
    expect(peak).toBe(2);

    gates.get('a')!();
    await flush();
    expect(started).toEqual(['a', 'b', 'c']);

    gates.get('b')!();
    await flush();
    expect(started).toEqual(['a', 'b', 'c', 'd']);

    gates.get('c')!();
    gates.get('d')!();
    await flush();
    expect(started).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(peak).toBe(2);
  });

  it('serves cached descriptions without re-fetching (no duplicate requests)', async () => {
    const { updates, calls } = collect();
    const hydrator = createDescriptionHydrator({
      describe: async (id) => {
        calls.push(id);
        return `desc:${id}`;
      },
      onUpdate: (id, description) => {
        updates[id] = description;
      },
    });
    hydrator.hydrate(['a', 'b']);
    await flush();
    expect(calls).toEqual(['a', 'b']);

    // A new search returns 'a' again plus a new 'c'.
    hydrator.hydrate(['a', 'c']);
    await flush();
    expect(calls).toEqual(['a', 'b', 'c']); // 'a' served from cache
    expect(updates.a).toEqual({ status: 'loaded', text: 'desc:a' });
    expect(updates.c).toEqual({ status: 'loaded', text: 'desc:c' });
    expect(hydrator.isCached('a')).toBe(true);
  });

  it('isolates a per-row failure and still hydrates the rest', async () => {
    const { updates } = collect();
    const hydrator = createDescriptionHydrator({
      describe: async (id) => {
        if (id === 'bad') throw new Error('boom');
        return `desc:${id}`;
      },
      onUpdate: (id, description) => {
        updates[id] = description;
      },
    });
    hydrator.hydrate(['bad', 'good']);
    await flush();
    expect(updates.bad).toEqual({ status: 'unavailable', text: null });
    expect(updates.good).toEqual({ status: 'loaded', text: 'desc:good' });
  });

  it('caches a failure so a dead id is not re-fetched', async () => {
    const calls: string[] = [];
    const hydrator = createDescriptionHydrator({
      describe: async (id) => {
        calls.push(id);
        throw new Error('boom');
      },
      onUpdate: () => {},
    });
    hydrator.hydrate(['bad']);
    await flush();
    hydrator.hydrate(['bad']);
    await flush();
    expect(calls).toEqual(['bad']); // only one attempt
  });

  it('ignores a superseded batch after cancel', async () => {
    let resolveLate!: (value: string | null) => void;
    const { updates } = collect();
    const hydrator = createDescriptionHydrator({
      describe: (id) =>
        id === 'a'
          ? new Promise<string | null>((resolve) => {
              resolveLate = resolve;
            })
          : Promise.resolve('desc:b'),
      onUpdate: (id, description) => {
        updates[id] = description;
      },
    });
    hydrator.hydrate(['a']);
    hydrator.cancel(); // a newer query superseded this batch
    resolveLate('desc:a'); // late resolution of the stale batch
    await flush();
    expect(updates.a).toBeUndefined();
  });

  it('aborts the active describe calls on cancel', async () => {
    const aborted: string[] = [];
    const hydrator = createDescriptionHydrator({
      describe: (_id, signal) =>
        new Promise<string | null>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted.push('a');
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      onUpdate: () => {},
    });
    hydrator.hydrate(['a']);
    hydrator.cancel();
    expect(aborted).toEqual(['a']);
  });

  it('does not treat an abort as a per-row unavailable result', async () => {
    const { updates } = collect();
    const hydrator = createDescriptionHydrator({
      describe: (_id, signal) =>
        new Promise<string | null>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      onUpdate: (id, description) => {
        updates[id] = description;
      },
    });
    hydrator.hydrate(['a']);
    hydrator.cancel();
    await flush();
    expect(updates.a).toBeUndefined();
  });
});
