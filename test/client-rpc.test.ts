import { describe, expect, it } from 'vitest';
import type { ClientConnection } from '../src/client/connection';
import { createSkillManagerApi, SkillManagerRpcError } from '../src/client/rpc';
import {
  ENDPOINT_DESCRIBE,
  ENDPOINT_INSTALL,
  ENDPOINT_LIST,
  ENDPOINT_SEARCH,
  ENDPOINT_UNINSTALL,
  ENDPOINT_UPDATE,
  RPC_CHANNEL,
} from '../src/contract';
import type { InstallResult, ManagedSkill, RpcResult, SkillSearchResult, UninstallResult, UpdateResult } from '../src/types';

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

  it('installs over the channel with the id and overwrite flag', async () => {
    const installResult: InstallResult = {
      slug: 'slug',
      source: 'owner/repo',
      remoteSourceHash: 'opaque',
      localContentHash: 'a'.repeat(64),
      installedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const calls: Array<{ endpoint: string; payload: unknown }> = [];
    const api = createSkillManagerApi(
      connection(async (_c, endpoint, payload) => {
        calls.push({ endpoint, payload });
        return { ok: true, value: installResult };
      }),
    );
    await expect(api.install('owner/repo/slug', true)).resolves.toEqual(installResult);
    expect(calls).toEqual([{ endpoint: ENDPOINT_INSTALL, payload: { id: 'owner/repo/slug', overwrite: true } }]);
  });

  it('updates over the channel with the id and discard flag', async () => {
    const updateResult: UpdateResult = {
      slug: 'slug',
      source: 'owner/repo',
      remoteSourceHash: 'opaque',
      localContentHash: 'b'.repeat(64),
      updatedAt: '2024-01-01T00:00:00.000Z',
      discardedLocalChanges: true,
      applied: true,
    };
    const calls: Array<{ endpoint: string; payload: unknown }> = [];
    const api = createSkillManagerApi(
      connection(async (_c, endpoint, payload) => {
        calls.push({ endpoint, payload });
        return { ok: true, value: updateResult };
      }),
    );
    await expect(api.update('owner/repo/slug', true)).resolves.toEqual(updateResult);
    expect(calls).toEqual([
      { endpoint: ENDPOINT_UPDATE, payload: { id: 'owner/repo/slug', discardLocalChanges: true } },
    ]);
  });

  it('uninstalls over the channel with the slug and confirmation flags', async () => {
    const uninstallResult: UninstallResult = { ok: true };
    const calls: Array<{ endpoint: string; payload: unknown }> = [];
    const api = createSkillManagerApi(
      connection(async (_c, endpoint, payload) => {
        calls.push({ endpoint, payload });
        return { ok: true, value: uninstallResult };
      }),
    );
    await expect(
      api.uninstall('slug', { confirm: true, discardLocalChanges: true }),
    ).resolves.toEqual(uninstallResult);
    expect(calls).toEqual([
      {
        endpoint: ENDPOINT_UNINSTALL,
        payload: { id: 'slug', confirm: true, discardLocalChanges: true },
      },
    ]);
  });

  it('omits undefined confirmation flags from the wire payload', async () => {
    const calls: Array<{ endpoint: string; payload: unknown }> = [];
    const api = createSkillManagerApi(
      connection(async (_c, endpoint, payload) => {
        calls.push({ endpoint, payload });
        return { ok: true, value: { ok: true } };
      }),
    );
    await api.uninstall('slug');
    expect(calls).toEqual([{ endpoint: ENDPOINT_UNINSTALL, payload: { id: 'slug' } }]);
  });

  it('surfaces a host failure for a mutation as a typed SkillManagerRpcError', async () => {
    const api = createSkillManagerApi(
      connection(async () => ({
        ok: false,
        error: { code: 'local-modification-conflict', message: 'x', details: {} },
      })),
    );
    const err = await api.update('owner/repo/slug').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkillManagerRpcError);
    expect(err).toMatchObject({ code: 'local-modification-conflict' });
  });
});
