import { describe, expect, it } from 'vitest';
import type { ClientConnection } from '../src/client/connection';
import { createSkillManagerApi, SkillManagerRpcError } from '../src/client/rpc';
import { ENDPOINT_DESCRIBE, ENDPOINT_LIST, ENDPOINT_SEARCH, RPC_CHANNEL } from '../src/contract';
import type { ManagedSkill, RpcResult, SkillSearchResult } from '../src/types';

const githubResult: SkillSearchResult = {
  id: 'microsoft/azure-skills/python-appservice-deploy',
  skillId: 'python-appservice-deploy',
  name: 'python-appservice-deploy',
  source: 'microsoft/azure-skills',
  installs: 170535,
  pageUrl: 'https://skills.sh/microsoft/azure-skills/python-appservice-deploy',
  installable: true,
  sourceKind: 'github',
};

const managedSkill: ManagedSkill = {
  slug: 'find-skills',
  source: 'owner/repo',
  id: 'owner/repo/find-skills',
  remoteSourceHash: 'opaque-v1',
  localContentHash: 'a'.repeat(64),
  installedAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  status: 'up-to-date',
  localModified: false,
  updateAvailable: false,
};

type Handler = (
  channel: string,
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
) => Promise<RpcResult<unknown>>;

function connection(handler: Handler): ClientConnection {
  return {
    rpc: {
      call: <T>(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) =>
        handler(channel, endpoint, payload, signal) as Promise<RpcResult<T>>,
    },
  };
}

describe('createSkillManagerApi', () => {
  it('searches over the /skill-manager channel and unwraps results', async () => {
    const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = [];
    const api = createSkillManagerApi(
      connection(async (channel, endpoint, payload) => {
        calls.push({ channel, endpoint, payload });
        return { ok: true, value: { results: [githubResult], complete: true } };
      }),
    );
    await expect(api.search('python')).resolves.toEqual([githubResult]);
    expect(calls).toEqual([
      { channel: RPC_CHANNEL, endpoint: ENDPOINT_SEARCH, payload: { query: 'python' } },
    ]);
  });

  it('describes over the channel and unwraps the description', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = [];
    const api = createSkillManagerApi(
      connection(async (_c, endpoint, payload) => {
        calls.push({ endpoint, payload });
        return { ok: true, value: { description: 'the desc' } };
      }),
    );
    await expect(api.describe('owner/repo/slug')).resolves.toBe('the desc');
    expect(calls).toEqual([{ endpoint: ENDPOINT_DESCRIBE, payload: { id: 'owner/repo/slug' } }]);
  });

  it('returns null description when the host reports none', async () => {
    const api = createSkillManagerApi(
      connection(async () => ({ ok: true, value: { description: null } })),
    );
    await expect(api.describe('owner/repo/slug')).resolves.toBeNull();
  });

  it('lists managed skills over the channel and unwraps skills', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = [];
    const api = createSkillManagerApi(
      connection(async (_c, endpoint, payload) => {
        calls.push({ endpoint, payload });
        return { ok: true, value: { skills: [managedSkill] } };
      }),
    );
    await expect(api.list()).resolves.toEqual([managedSkill]);
    expect(calls).toEqual([{ endpoint: ENDPOINT_LIST, payload: {} }]);
  });

  it('throws a typed SkillManagerRpcError on a host failure', async () => {
    const api = createSkillManagerApi(
      connection(async () => ({
        ok: false,
        error: { code: 'network-unavailable', message: 'x', details: {} },
      })),
    );
    const err = await api.search('python').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkillManagerRpcError);
    expect(err).toMatchObject({ name: 'SkillManagerRpcError', code: 'network-unavailable' });
  });

  it('forwards the caller signal to the connection', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const api = createSkillManagerApi(
      connection(async (_c, _e, _p, signal) => {
        received = signal;
        return { ok: true, value: { results: [], complete: true } };
      }),
    );
    await api.search('python', controller.signal);
    expect(received).toBe(controller.signal);
  });
});
