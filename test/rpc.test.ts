import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { apply } from '../src/index';
import { MANIFEST_SCHEMA_VERSION, ManifestStore } from '../src/manifest';
import { localContentHash } from '../src/manifest/hash';
import type { RemoteSourceHash } from '../src/manifest';
import { createRpcHandler } from '../src/rpc';
import { SkillManagerService } from '../src/service';
import type { RpcHandler } from '../src/types';

const remote = (s: string): RemoteSourceHash => s as RemoteSourceHash;

const signal = () => new AbortController().signal;

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sm-rpc-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe('SkillManagerService.health', () => {
  it('returns a typed health response with version and a timestamp', () => {
    const service = new SkillManagerService({ version: '1.0.0', skillsRoot: join(tmpdir(), 'x'), now: () => 1234 });
    expect(service.health()).toEqual({
      ok: true,
      plugin: 'dsh-skill-manager',
      version: '1.0.0',
      now: 1234,
    });
  });
});

describe('createRpcHandler', () => {
  it('answers the health endpoint with an ok result', async () => {
    const service = new SkillManagerService({ version: '1.0.0', skillsRoot: join(tmpdir(), 'x'), now: () => 1234 });
    const handler = createRpcHandler(service);
    const result = await handler('health', {}, signal());
    expect(result).toEqual({
      ok: true,
      value: { ok: true, plugin: 'dsh-skill-manager', version: '1.0.0', now: 1234 },
    });
  });

  it('answers ping as a liveness alias of health', async () => {
    const service = new SkillManagerService({ version: '1.0.0', skillsRoot: join(tmpdir(), 'x'), now: () => 1234 });
    const handler = createRpcHandler(service);
    const result = await handler('ping', {}, signal());
    expect(result).toEqual({ ok: true, value: expect.objectContaining({ ok: true }) });
  });

  it('returns a typed failure for an unknown endpoint', async () => {
    const service = new SkillManagerService({ version: '1.0.0', skillsRoot: join(tmpdir(), 'x'), now: () => 1234 });
    const handler = createRpcHandler(service);
    const result = await handler('install', {}, signal());
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('dispatches uninstall and returns the typed ok result', async () => {
    const root = await tempRoot();
    const files = [{ path: 'SKILL.md', contents: '---\nname: find-skills\n---\n# hi\n' }];
    await writeSkillFiles(root, 'find-skills', files);
    await writeManifestEntry(root, 'find-skills');

    const handler = createRpcHandler(new SkillManagerService({ version: '1.0.0', skillsRoot: root }));
    const result = await handler('uninstall', { id: 'find-skills', confirm: true }, signal());

    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('normalizes a foreign-skill refusal to a typed error', async () => {
    const root = await tempRoot();
    await writeSkillFiles(root, 'foreign-skill', [{ path: 'SKILL.md', contents: 'x' }]);

    const handler = createRpcHandler(new SkillManagerService({ version: '1.0.0', skillsRoot: root }));
    const result = await handler('uninstall', { id: 'foreign-skill', confirm: true }, signal());

    expect(result).toMatchObject({ ok: false, error: { code: 'foreign-skill' } });
  });

  it('normalizes an invalid skill name to the path-safety error code', async () => {
    const handler = createRpcHandler(new SkillManagerService({ version: '1.0.0', skillsRoot: join(tmpdir(), 'x') }));
    const result = await handler('uninstall', { id: '../escape', confirm: true }, signal());

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-skill-name' } });
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

// --- local test helpers (mirror the install shape; keep this file focused) ---

async function writeSkillFiles(root: string, slug: string, files: Array<{ path: string; contents: string }>): Promise<void> {
  for (const f of files) {
    const p = join(root, slug, ...f.path.split('/'));
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, f.contents, 'utf8');
  }
}

async function writeManifestEntry(root: string, slug: string): Promise<void> {
  const files = [{ path: 'SKILL.md', contents: '---\nname: find-skills\n---\n# hi\n' }];
  const manifest = {
    version: MANIFEST_SCHEMA_VERSION,
    skills: {
      [slug]: {
        source: 'owner/repo',
        slug,
        remoteSourceHash: remote(`opaque-${slug}`),
        localContentHash: localContentHash(files),
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  };
  await new ManifestStore(root).save(manifest);
}
