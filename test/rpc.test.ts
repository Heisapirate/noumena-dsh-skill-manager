import { describe, expect, it } from 'vitest';
import { apply } from '../src/index';
import { createRpcHandler } from '../src/rpc';
import { SkillManagerService } from '../src/service';
import type { RpcHandler } from '../src/types';

const signal = () => new AbortController().signal;

describe('SkillManagerService.health', () => {
  it('returns a typed health response with version and a timestamp', () => {
    const service = new SkillManagerService({ version: '1.0.0', now: () => 1234 });
    expect(service.health()).toEqual({
      ok: true,
      plugin: 'dsh-skill-manager',
      version: '1.0.0',
      now: 1234,
    });
  });
});

describe('createRpcHandler', () => {
  const service = new SkillManagerService({ version: '1.0.0', now: () => 1234 });
  const handler = createRpcHandler(service);

  it('answers the health endpoint with an ok result', async () => {
    const result = await handler('health', {}, signal());
    expect(result).toEqual({
      ok: true,
      value: { ok: true, plugin: 'dsh-skill-manager', version: '1.0.0', now: 1234 },
    });
  });

  it('answers ping as a liveness alias of health', async () => {
    const result = await handler('ping', {}, signal());
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ ok: true }) });
  });

  it('returns a typed failure for an unknown endpoint', async () => {
    const result = await handler('install', {}, signal());
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });
});

describe('host apply', () => {
  it('registers the /skill-manager channel and its handler answers health', async () => {
    let channel: string | undefined;
    let captured: unknown;

    const ctx = {
      get: () => ({
        rpc: {
          handle: (c: string, h: unknown) => {
            channel = c;
            captured = h;
            return () => {};
          },
        },
      }),
      effect: () => {},
    };

    apply(ctx as never);

    expect(channel).toBe('/skill-manager');
    expect(typeof captured).toBe('function');

    const handler = captured as RpcHandler;
    const result = await handler('health', {}, signal());
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({ plugin: 'dsh-skill-manager' }),
    });
  });
});
