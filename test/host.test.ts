import { describe, expect, it } from 'vitest';
import { apply, handler } from '../src/index';

describe('host RPC handler (prototype)', () => {
  it('returns the typed ok response for ping', async () => {
    const r: any = await handler('ping', {});
    expect(r.ok).toBe(true);
    expect(r.value.ok).toBe(true);
    expect(r.value.version).toBe('prototype');
    expect(typeof r.value.now).toBe('number');
  });

  it('returns the typed failure for an unknown endpoint', async () => {
    const r: any = await handler('nope', {});
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('internal');
  });

  it('registers the /skill-manager channel with a disposer', () => {
    let channel: string | undefined;
    let captured: unknown;
    const disposer = () => {};
    const ctx = {
      get: () => ({
        rpc: { handle: (c: string, h: unknown) => ((channel = c), (captured = h), disposer) },
      }),
      effect: () => {},
    };
    apply(ctx as any);
    expect(channel).toBe('/skill-manager');
    expect(captured).toBe(handler);
  });
});
