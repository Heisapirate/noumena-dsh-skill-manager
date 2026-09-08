import { describe, expect, it } from 'vitest';
import { createRpcHandler } from '../src/rpc';
import { SkillManagerService } from '../src/service';
import { SkillsShError } from '../src/skills-sh';
import type { SkillsShClient } from '../src/skills-sh';
import type { SkillSearchResult } from '../src/types';

const signal = () => new AbortController().signal;

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

function fakeClient(overrides: Partial<SkillsShClient> = {}): SkillsShClient {
  return {
    search: async () => [],
    getSnapshot: async () => {
      throw new Error('unused in #13');
    },
    getDescription: async () => null,
    ...overrides,
  };
}

describe('SkillManagerService.search', () => {
  it('returns adapter results and complete: true', async () => {
    const service = new SkillManagerService({
      version: '1.0.0',
      client: fakeClient({ search: async () => [githubResult] }),
    });
    await expect(service.search('python', signal())).resolves.toEqual({
      results: [githubResult],
      complete: true,
    });
  });

  it('does not hydrate descriptions during search', async () => {
    let described = false;
    const service = new SkillManagerService({
      version: '1.0.0',
      client: fakeClient({
        search: async () => [githubResult],
        getDescription: async () => {
          described = true;
          return 'x';
        },
      }),
    });
    await service.search('python', signal());
    expect(described).toBe(false);
  });
});

describe('SkillManagerService.describe', () => {
  it('returns the hydrated description', async () => {
    const service = new SkillManagerService({
      version: '1.0.0',
      client: fakeClient({ getDescription: async (id) => (id === 'a/b/c' ? 'the desc' : null) }),
    });
    await expect(service.describe('a/b/c', signal())).resolves.toEqual({ description: 'the desc' });
  });

  it('returns null for a skill with no description', async () => {
    const service = new SkillManagerService({
      version: '1.0.0',
      client: fakeClient({ getDescription: async () => null }),
    });
    await expect(service.describe('a/b/c', signal())).resolves.toEqual({ description: null });
  });
});

describe('createRpcHandler dispatch', () => {
  it('answers the search endpoint with an ok result', async () => {
    const service = new SkillManagerService({
      version: '1.0.0',
      client: fakeClient({ search: async () => [githubResult] }),
    });
    const handler = createRpcHandler(service);
    await expect(handler('search', { query: 'python' }, signal())).resolves.toEqual({
      ok: true,
      value: { results: [githubResult], complete: true },
    });
  });

  it('answers the describe endpoint with an ok result', async () => {
    const service = new SkillManagerService({
      version: '1.0.0',
      client: fakeClient({ getDescription: async () => 'the desc' }),
    });
    const handler = createRpcHandler(service);
    await expect(handler('describe', { id: 'owner/repo/slug' }, signal())).resolves.toEqual({
      ok: true,
      value: { description: 'the desc' },
    });
  });

  it('maps a SkillsShError to a typed failure', async () => {
    const service = new SkillManagerService({
      version: '1.0.0',
      client: fakeClient({
        search: async () => {
          throw new SkillsShError('rate-limited', 'limited', { statusCode: 429, retryAfterSeconds: 30 });
        },
      }),
    });
    const handler = createRpcHandler(service);
    const result = await handler('search', { query: 'x' }, signal());
    expect(result).toMatchObject({ ok: false, error: { code: 'rate-limited' } });
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed search payload with invalid-request', async () => {
    const handler = createRpcHandler(new SkillManagerService({ version: '1.0.0', client: fakeClient() }));
    await expect(handler('search', { nope: true }, signal())).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    await expect(handler('search', undefined, signal())).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });

  it('rejects a malformed describe payload with invalid-request', async () => {
    const handler = createRpcHandler(new SkillManagerService({ version: '1.0.0', client: fakeClient() }));
    await expect(handler('describe', { id: 42 }, signal())).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
    await expect(handler('describe', { id: '   ' }, signal())).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });

  it('passes the connection signal through to the service', async () => {
    const aborter = new AbortController();
    let received: AbortSignal | undefined;
    const service = new SkillManagerService({
      version: '1.0.0',
      client: fakeClient({
        search: async (_query, opts) => {
          received = opts?.signal;
          return [];
        },
      }),
    });
    const handler = createRpcHandler(service);
    await handler('search', { query: 'python' }, aborter.signal);
    expect(received).toBe(aborter.signal);
  });

  it('still answers the health and ping endpoints', async () => {
    const service = new SkillManagerService({ version: '1.0.0', now: () => 1, client: fakeClient() });
    const handler = createRpcHandler(service);
    await expect(handler('health', {}, signal())).resolves.toMatchObject({ ok: true });
    await expect(handler('ping', {}, signal())).resolves.toMatchObject({ ok: true });
  });
});
