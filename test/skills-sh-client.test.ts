import { describe, expect, it } from 'vitest';
import { createSkillsShClient, isSkillsShError, SkillsShError } from '../src/skills-sh';

type FetchFn = typeof fetch;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Fetch that returns the given responses in order, repeating the last one. */
function sequential(
  responses: Response[],
  calls: Array<{ url: string; init?: RequestInit }> = [],
): FetchFn {
  let index = 0;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(response);
  }) as FetchFn;
}

/** Fetch that never resolves and rejects with AbortError when its signal aborts. */
function abortableFetch(): FetchFn {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      );
    })) as FetchFn;
}

const searchBody = {
  skills: [
    {
      id: 'microsoft/azure-skills/python-appservice-deploy',
      skillId: 'python-appservice-deploy',
      name: 'python-appservice-deploy',
      installs: 170535,
      source: 'microsoft/azure-skills',
    },
  ],
};

const snapshotBody = {
  files: [
    { path: 'SKILL.md', contents: '---\nname: foo\ndescription: "the description"\n---\n# Body' },
    { path: 'references/a.md', contents: '# A' },
  ],
  hash: '551771d631c3ab218c0389fd696e10a8cd6bfaa06cf3182fdac252cd4909f07a',
};

describe('SkillsShHttpClient.search', () => {
  it('returns typed summaries for a successful search', async () => {
    const client = createSkillsShClient({ fetch: sequential([json(searchBody)]) });
    const results = await client.search('python');
    expect(results).toEqual([
      {
        id: 'microsoft/azure-skills/python-appservice-deploy',
        skillId: 'python-appservice-deploy',
        name: 'python-appservice-deploy',
        source: 'microsoft/azure-skills',
        installs: 170535,
        pageUrl: 'https://skills.sh/microsoft/azure-skills/python-appservice-deploy',
        installable: true,
        sourceKind: 'github',
      },
    ]);
  });

  it('encodes the query and forwards limit/owner params', async () => {
    const calls: Array<{ url: string }> = [];
    const client = createSkillsShClient({ fetch: sequential([json(searchBody)], calls) });
    await client.search('a & b=1?', { limit: 5, owner: 'microsoft' });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('q')).toBe('a & b=1?');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('owner')).toBe('microsoft');
  });

  it('returns empty results without fetching for an empty/too-short query', async () => {
    let called = false;
    const fetchFn = (() => {
      called = true;
      return Promise.resolve(json({}));
    }) as FetchFn;
    const client = createSkillsShClient({ fetch: fetchFn });
    await expect(client.search('')).resolves.toEqual([]);
    await expect(client.search('   ')).resolves.toEqual([]);
    await expect(client.search('a')).resolves.toEqual([]);
    expect(called).toBe(false);
  });

  it('returns empty results when the server has no matches', async () => {
    const client = createSkillsShClient({ fetch: sequential([json({ skills: [] })]) });
    await expect(client.search('zzzz')).resolves.toEqual([]);
  });

  it('maps a malformed search payload to malformed-response', async () => {
    const client = createSkillsShClient({ fetch: sequential([json({ nope: true })]) });
    await expect(client.search('python')).rejects.toMatchObject({ code: 'malformed-response' });
  });

  it('maps a 4xx to http-error without retrying', async () => {
    const calls: Array<{ url: string }> = [];
    const client = createSkillsShClient({
      fetch: sequential([json({}, 401)], calls),
      sleep: async () => {},
    });
    await expect(client.search('python')).rejects.toMatchObject({ code: 'http-error', statusCode: 401 });
    expect(calls).toHaveLength(1);
  });

  it('maps a network failure to network-unavailable', async () => {
    const fetchFn = (() => Promise.reject(new TypeError('fetch failed'))) as FetchFn;
    const client = createSkillsShClient({ fetch: fetchFn });
    await expect(client.search('python')).rejects.toMatchObject({ code: 'network-unavailable' });
  });

  it('maps a slow request to timeout', async () => {
    const fetchFn = abortableFetch();
    const client = createSkillsShClient({ fetch: fetchFn, timeoutMs: 10 });
    await expect(client.search('python')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('retries a transient 503 and succeeds', async () => {
    const calls: Array<{ url: string }> = [];
    const client = createSkillsShClient({
      fetch: sequential([json({}, 503), json(searchBody)], calls),
      sleep: async () => {},
    });
    const results = await client.search('python');
    expect(results).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('gives up after the retry bound with registry-unavailable', async () => {
    const calls: Array<{ url: string }> = [];
    const delays: number[] = [];
    const client = createSkillsShClient({
      fetch: sequential([json({}, 503)], calls),
      maxRetries: 2,
      baseDelayMs: 500,
      maxDelayMs: 5000,
      random: () => 0.5,
      sleep: async (ms: number) => {
        delays.push(ms);
      },
    });
    await expect(client.search('python')).rejects.toMatchObject({
      code: 'registry-unavailable',
      statusCode: 503,
    });
    expect(calls).toHaveLength(3); // initial + 2 retries
    expect(delays).toEqual([375, 750]);
  });

  it('does not retry a non-transient 500', async () => {
    const calls: Array<{ url: string }> = [];
    const client = createSkillsShClient({
      fetch: sequential([json({}, 500)], calls),
      sleep: async () => {},
    });
    await expect(client.search('python')).rejects.toMatchObject({ code: 'http-error', statusCode: 500 });
    expect(calls).toHaveLength(1);
  });

  it('maps a 429 to rate-limited and surfaces Retry-After seconds', async () => {
    const client = createSkillsShClient({ fetch: sequential([json({}, 429, { 'retry-after': '120' })]) });
    await expect(client.search('python')).rejects.toMatchObject({
      code: 'rate-limited',
      statusCode: 429,
      retryAfterSeconds: 120,
    });
  });
});

describe('SkillsShHttpClient.getSnapshot', () => {
  it('returns a validated snapshot and preserves the opaque remoteSourceHash', async () => {
    const calls: Array<{ url: string }> = [];
    const client = createSkillsShClient({ fetch: sequential([json(snapshotBody)], calls) });
    const snapshot = await client.getSnapshot('microsoft/azure-skills/python-appservice-deploy');
    expect(snapshot).toMatchObject({
      id: 'microsoft/azure-skills/python-appservice-deploy',
      remoteSourceHash: '551771d631c3ab218c0389fd696e10a8cd6bfaa06cf3182fdac252cd4909f07a',
      metadata: { name: 'foo', description: 'the description' },
    });
    expect(snapshot.files).toHaveLength(2);
    expect(new URL(calls[0].url).pathname).toBe('/api/download/microsoft/azure-skills/python-appservice-deploy');
  });

  it('rejects a non-GitHub download id as source-unavailable without fetching', async () => {
    const calls: Array<{ url: string }> = [];
    const client = createSkillsShClient({ fetch: sequential([json({})], calls) });
    await expect(client.getSnapshot('example.com/skill')).rejects.toMatchObject({ code: 'source-unavailable' });
    expect(calls).toHaveLength(0);
  });

  it('maps a 404 snapshot to source-unavailable', async () => {
    const client = createSkillsShClient({ fetch: sequential([json({ error: 'not found' }, 404)]) });
    await expect(client.getSnapshot('owner/repo/slug')).rejects.toMatchObject({
      code: 'source-unavailable',
      statusCode: 404,
    });
  });

  it('maps an invalid download payload to malformed-response', async () => {
    const client = createSkillsShClient({ fetch: sequential([json({ files: 'nope' })]) });
    await expect(client.getSnapshot('owner/repo/slug')).rejects.toMatchObject({ code: 'malformed-response' });
  });
});

describe('SkillsShHttpClient.getDescription', () => {
  it('hydrates the description from the snapshot metadata', async () => {
    const client = createSkillsShClient({ fetch: sequential([json(snapshotBody)]) });
    await expect(client.getDescription('owner/repo/slug')).resolves.toBe('the description');
  });

  it('returns null when the skill has no description', async () => {
    const body = { files: [{ path: 'SKILL.md', contents: '---\nname: foo\n---\n' }], hash: 'abc' };
    const client = createSkillsShClient({ fetch: sequential([json(body)]) });
    await expect(client.getDescription('owner/repo/slug')).resolves.toBeNull();
  });
});

describe('SkillsShHttpClient cancellation', () => {
  it('rejects a pre-aborted request as cancelled without fetching', async () => {
    const calls: Array<{ url: string }> = [];
    const client = createSkillsShClient({ fetch: sequential([json(searchBody)], calls) });
    const controller = new AbortController();
    controller.abort();
    await expect(client.search('python', { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(calls).toHaveLength(0);
  });

  it('rejects an in-flight request as cancelled when the signal aborts', async () => {
    const fetchFn = abortableFetch();
    const client = createSkillsShClient({ fetch: fetchFn });
    const controller = new AbortController();
    const promise = client.search('python', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('SkillsShError normalization surface', () => {
  it('exposes code, statusCode, and retryAfterSeconds on typed failures', async () => {
    const client = createSkillsShClient({ fetch: sequential([json({}, 429, { 'retry-after': '30' })]) });
    const err = await client.search('python').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkillsShError);
    if (!isSkillsShError(err)) throw new Error('expected a SkillsShError');
    expect(err).toMatchObject({ code: 'rate-limited', statusCode: 429, retryAfterSeconds: 30 });
    expect(err.toObject()).toEqual({
      code: 'rate-limited',
      message: expect.any(String),
      details: { statusCode: 429, retryAfterSeconds: 30 },
    });
  });
});
