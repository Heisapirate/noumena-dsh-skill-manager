// Filesystem-integration tests for the install transaction (Issue #14,
// production spec §9). Every test runs against an isolated temp skills root and
// a mocked SkillsShClient; nothing here ever touches a real DSH skills root or
// `.proto-dsh-home`.
//
// Seams under test:
//   1. `installSkill` (src/install.ts) — the host-side transaction composing
//      SkillsShClient (#12), SkillRoot (#11), and ManifestStore (#10).
//   2. The `/skill-manager` RPC `install` endpoint (src/rpc.ts) — the typed
//      host API a UI consumer will call.

import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { InstallError, installSkill } from '../src/install';
import { localContentHash } from '../src/manifest';
import { ManifestStore } from '../src/manifest/store';
import type { SkillManifest } from '../src/manifest/types';
import { SkillRoot } from '../src/path-safety';
import { createRpcHandler } from '../src/rpc';
import { SkillManagerService } from '../src/service';
import { isSkillsShError, SkillsShError, type SkillsShClient, type SkillSnapshot } from '../src/skills-sh';
import type { InstallRequest } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

const ID = 'vercel-labs/skills/find-skills';
const SOURCE = 'vercel-labs/skills';
const SLUG = 'find-skills';

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sm-install-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

const skillMd = '---\nname: find-skills\ndescription: Find and install skills\n---\n# Find Skills\n';

function snapshot(overrides: Partial<SkillSnapshot> = {}): SkillSnapshot {
  return {
    id: ID,
    remoteSourceHash: 'opaque-upstream-fingerprint-abc',
    files: [
      { path: 'SKILL.md', contents: skillMd },
      { path: 'README.md', contents: '# Find Skills\n' },
      { path: 'docs/guide.md', contents: '# Guide\n' },
    ],
    metadata: { name: SLUG, description: 'Find and install skills' },
    ...overrides,
  };
}

function mockClient(overrides: Partial<SkillsShClient> = {}): SkillsShClient {
  return {
    search: async () => [],
    getDescription: async () => null,
    getSnapshot: async () => snapshot(),
    ...overrides,
  };
}

interface Deps {
  client: SkillsShClient;
  root: SkillRoot;
  store: ManifestStore;
  now: () => number;
}

function makeDeps(root: string, client: SkillsShClient = mockClient(), nowMs = Date.parse('2024-01-02T03:04:05.000Z')): Deps {
  return {
    client,
    root: new SkillRoot(root),
    store: new ManifestStore(root),
    now: () => nowMs,
  };
}

async function readManifest(root: string): Promise<SkillManifest> {
  return JSON.parse(await readFile(join(root, '.system', 'skill-manager', 'manifest.json'), 'utf8')) as SkillManifest;
}

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

describe('installSkill — valid install', () => {
  it('installs a GitHub snapshot so DSH discovers it, with correct provenance', async () => {
    const root = await tempRoot();
    const snap = snapshot();
    const result = await installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID });

    // Typed result carries the manifest provenance (plain strings for RPC).
    expect(result).toEqual({
      slug: SLUG,
      source: SOURCE,
      remoteSourceHash: 'opaque-upstream-fingerprint-abc',
      localContentHash: localContentHash(snap.files),
      installedAt: '2024-01-02T03:04:05.000Z',
      updatedAt: '2024-01-02T03:04:05.000Z',
    });

    // DSH's expected layout: skills root/<slug>/SKILL.md.
    const skillDir = join(root, SLUG);
    expect(await exists(join(skillDir, 'SKILL.md'))).toBe(true);
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toContain('name: find-skills');
    expect(await readFile(join(skillDir, 'SKILL.md'), 'utf8')).toContain('description: Find and install skills');

    // Manifest provenance: source, slug, two distinct hashes, ISO-8601 timestamps, schema v1.
    const manifest = await readManifest(root);
    expect(manifest.version).toBe(1);
    expect(manifest.skills[SLUG]).toEqual({
      source: SOURCE,
      slug: SLUG,
      remoteSourceHash: 'opaque-upstream-fingerprint-abc',
      localContentHash: localContentHash(snap.files),
      installedAt: '2024-01-02T03:04:05.000Z',
      updatedAt: '2024-01-02T03:04:05.000Z',
    });

    // Staging and backup are fully cleaned up.
    expect(await exists(join(root, '.system', 'skill-manager', '.staging', SLUG))).toBe(false);
    expect(await exists(join(root, '.system', 'skill-manager', '.staging', `.backup-${SLUG}`))).toBe(false);
  });

  it('writes every snapshot file exactly as provided', async () => {
    const root = await tempRoot();
    const snap = snapshot();
    await installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID });

    for (const file of snap.files) {
      const p = join(root, SLUG, ...file.path.split('/'));
      expect(await readFile(p, 'utf8')).toBe(file.contents);
    }
  });

  it('stores a deterministic localContentHash and preserves remoteSourceHash opaquely', async () => {
    const rootA = await tempRoot();
    const rootB = await tempRoot();
    const snap = snapshot();

    const a = await installSkill(makeDeps(rootA, mockClient({ getSnapshot: async () => snap })), { id: ID });
    const b = await installSkill(makeDeps(rootB, mockClient({ getSnapshot: async () => snap })), { id: ID });

    // Same content → identical local hash; and the opaque upstream hash is stored verbatim.
    expect(a.localContentHash).toBe(b.localContentHash);
    expect(a.localContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.remoteSourceHash).toBe('opaque-upstream-fingerprint-abc');
    expect(b.remoteSourceHash).toBe('opaque-upstream-fingerprint-abc');

    const manifestA = await readManifest(rootA);
    expect(manifestA.skills[SLUG].remoteSourceHash).toBe('opaque-upstream-fingerprint-abc');
    // The two hashes are distinct concepts and are never equal here.
    expect(manifestA.skills[SLUG].remoteSourceHash).not.toBe(manifestA.skills[SLUG].localContentHash);
  });
});

// ---------------------------------------------------------------------------
// 1b. Fresh skills root (the GitHub-installed runtime does not pre-create it)
// ---------------------------------------------------------------------------

describe('installSkill — fresh skills root', () => {
  it('creates the skills root when it does not yet exist (fresh install)', async () => {
    // `mkdtemp` yields an existing PARENT; the skills root under it is absent,
    // mirroring a fresh `$DSH_HOME/skills` that the DSH runtime has not created.
    const parent = await mkdtemp(join(tmpdir(), 'sm-install-fresh-'));
    roots.push(parent);
    const root = join(parent, 'skills'); // does not exist yet

    await installSkill(makeDeps(root), { id: ID });

    // The root was created, the skill was published inside it, and provenance
    // was recorded — the exact fresh-install path that previously failed.
    expect(await exists(join(root, SLUG, 'SKILL.md'))).toBe(true);
    const manifest = await readManifest(root);
    expect(manifest.skills[SLUG].slug).toBe(SLUG);
    expect(manifest.skills[SLUG].source).toBe(SOURCE);
  });
});

// ---------------------------------------------------------------------------
// 2. Source / installability validation
// ---------------------------------------------------------------------------

describe('installSkill — source validation', () => {
  it.each([
    ['non-GitHub id (two segments)', 'example.com/some-skill'],
    ['non-GitHub id (dot owner)', 'example.com/foo/slug'],
    ['empty id', ''],
  ])('fails with source-unavailable for %s, without touching the filesystem', async (_label, id) => {
    const root = await tempRoot();
    let fetched = false;
    const client = mockClient({ getSnapshot: async () => { fetched = true; return snapshot(); } });

    await expect(installSkill(makeDeps(root, client), { id })).rejects.toMatchObject({
      code: 'source-unavailable',
    });
    expect(fetched).toBe(false);
    expect(await readdir(root)).toEqual([]); // nothing was created
  });

  it('fails with invalid-skill-name for a non-kebab-case slug', async () => {
    const root = await tempRoot();
    let fetched = false;
    const client = mockClient({ getSnapshot: async () => { fetched = true; return snapshot(); } });

    await expect(installSkill(makeDeps(root, client), { id: 'vercel-labs/skills/Bad_Name' })).rejects.toMatchObject({
      code: 'invalid-skill-name',
    });
    expect(fetched).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Snapshot validation (before any filesystem mutation)
// ---------------------------------------------------------------------------

describe('installSkill — snapshot validation', () => {
  it('fails with malformed-snapshot when SKILL.md is missing', async () => {
    const root = await tempRoot();
    const snap = snapshot({ files: [{ path: 'README.md', contents: '# no skill.md' }] });
    await expect(installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID })).rejects.toMatchObject({
      code: 'malformed-snapshot',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it('fails with malformed-snapshot when SKILL.md frontmatter name does not match the slug', async () => {
    const root = await tempRoot();
    const snap = snapshot({
      files: [
        { path: 'SKILL.md', contents: '---\nname: other-name\ndescription: x\n---\n# x\n' },
        { path: 'README.md', contents: '# x\n' },
      ],
      metadata: { name: 'other-name', description: 'x' },
    });
    await expect(installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID })).rejects.toMatchObject({
      code: 'malformed-snapshot',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it('fails with malformed-snapshot when SKILL.md frontmatter lacks a description', async () => {
    const root = await tempRoot();
    const snap = snapshot({
      files: [{ path: 'SKILL.md', contents: '---\nname: find-skills\n---\n# x\n' }],
      metadata: { name: SLUG },
    });
    await expect(installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID })).rejects.toMatchObject({
      code: 'malformed-snapshot',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it('fails with unsafe-path for a traversal file path', async () => {
    const root = await tempRoot();
    const snap = snapshot({ files: [...snapshot().files, { path: '../escape.md', contents: 'evil' }] });
    await expect(installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID })).rejects.toMatchObject({
      code: 'unsafe-path',
    });
    // Nothing escapes the root.
    expect(await exists(join(dirname(root), 'escape.md'))).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });

  it('fails with unsafe-path for a Windows path escape', async () => {
    const root = await tempRoot();
    const snap = snapshot({ files: [...snapshot().files, { path: 'C:\\Windows\\evil.md', contents: 'evil' }] });
    await expect(installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID })).rejects.toMatchObject({
      code: 'unsafe-path',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it('fails with malformed-snapshot for a duplicate file path', async () => {
    const root = await tempRoot();
    const files = [
      { path: 'SKILL.md', contents: skillMd },
      { path: 'docs/guide.md', contents: '# A\n' },
      { path: 'docs/guide.md', contents: '# B\n' },
    ];
    const snap = snapshot({ files, metadata: { name: SLUG, description: 'x' } });
    await expect(installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID })).rejects.toMatchObject({
      code: 'malformed-snapshot',
    });
    expect(await readdir(root)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Duplicate / foreign handling
// ---------------------------------------------------------------------------

describe('installSkill — duplicate and foreign handling', () => {
  it('refuses to overwrite a foreign skill occupying the target path', async () => {
    const root = await tempRoot();
    const foreignDir = join(root, SLUG);
    await mkdir(foreignDir, { recursive: true });
    await writeFile(join(foreignDir, 'precious.txt'), 'user data');

    await expect(installSkill(makeDeps(root), { id: ID })).rejects.toMatchObject({ code: 'foreign-target' });

    // Foreign content is untouched; no manifest entry was written.
    expect(await readFile(join(foreignDir, 'precious.txt'), 'utf8')).toBe('user data');
    expect(await exists(join(root, '.system', 'skill-manager', 'manifest.json'))).toBe(false);
  });

  it('requires overwrite confirmation for a plugin-managed duplicate and leaves it intact without one', async () => {
    const root = await tempRoot();
    let now = Date.parse('2024-01-02T03:04:05.000Z');
    const deps = () => makeDeps(root, mockClient(), now);
    await installSkill(deps(), { id: ID });

    const original = await readFile(join(root, SLUG, 'SKILL.md'), 'utf8');

    await expect(installSkill(deps(), { id: ID })).rejects.toMatchObject({ code: 'duplicate-install' });
    expect(await readFile(join(root, SLUG, 'SKILL.md'), 'utf8')).toBe(original); // no silent overwrite

    // With confirmation, the re-install succeeds and refreshes provenance.
    now = Date.parse('2024-02-03T04:05:06.000Z');
    const result = await installSkill(deps(), { id: ID, overwrite: true });
    expect(result).toMatchObject({
      slug: SLUG,
      installedAt: '2024-01-02T03:04:05.000Z', // original install time preserved
      updatedAt: '2024-02-03T04:05:06.000Z',
    });

    const manifest = await readManifest(root);
    expect(manifest.skills[SLUG].installedAt).toBe('2024-01-02T03:04:05.000Z');
    expect(manifest.skills[SLUG].updatedAt).toBe('2024-02-03T04:05:06.000Z');
  });
});

// ---------------------------------------------------------------------------
// 4b. Manifest integrity
// ---------------------------------------------------------------------------

describe('installSkill — manifest integrity', () => {
  it('refuses to install when the manifest is corrupt (cannot prove ownership)', async () => {
    const root = await tempRoot();
    // A corrupt manifest already exists (e.g. a truncated hand edit).
    const manifestFile = join(root, '.system', 'skill-manager', 'manifest.json');
    await mkdir(join(root, '.system', 'skill-manager'), { recursive: true });
    await writeFile(manifestFile, '{ not json', 'utf8');

    await expect(installSkill(makeDeps(root), { id: ID })).rejects.toMatchObject({
      code: 'manifest-corruption',
    });

    // Nothing is written: the corrupt manifest is preserved verbatim and no
    // skill directory or staging debris was created. Installing must never
    // silently rebuild a corrupt manifest and orphan other managed entries.
    expect(await readFile(manifestFile, 'utf8')).toBe('{ not json');
    expect(await exists(join(root, SLUG))).toBe(false);
    expect(await readdir(root)).toEqual(['.system']);
  });

  it('refuses with manifest-corruption before the foreign gate, leaving foreign content intact', async () => {
    const root = await tempRoot();
    const manifestFile = join(root, '.system', 'skill-manager', 'manifest.json');
    await mkdir(join(root, '.system', 'skill-manager'), { recursive: true });
    await writeFile(manifestFile, '{ not json', 'utf8');
    // A foreign skill already occupies the target path — exactly the
    // ownership question a corrupt manifest cannot answer, so the corruption
    // gate must fire before the foreign/duplicate gate.
    const foreignDir = join(root, SLUG);
    await mkdir(foreignDir, { recursive: true });
    await writeFile(join(foreignDir, 'precious.txt'), 'user data');

    await expect(installSkill(makeDeps(root), { id: ID })).rejects.toMatchObject({
      code: 'manifest-corruption',
    });

    expect(await readFile(join(foreignDir, 'precious.txt'), 'utf8')).toBe('user data');
    expect(await readFile(manifestFile, 'utf8')).toBe('{ not json');
  });
});

// ---------------------------------------------------------------------------
// 5. Staged transaction & rollback
// ---------------------------------------------------------------------------

describe('installSkill — staged transaction, failure cleanup, and rollback', () => {
  it('leaves no partial state when staging materialization fails', async () => {
    const root = await tempRoot();
    // A directory already sits where the snapshot wants a file `docs`.
    const staged = join(root, '.system', 'skill-manager', '.staging', SLUG);
    await mkdir(join(staged, 'docs'), { recursive: true });
    const snap = snapshot({ files: [...snapshot().files, { path: 'docs', contents: 'should be a file' }] });

    await expect(installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID })).rejects.toMatchObject({
      code: 'install-partial-failure',
    });

    expect(await exists(join(root, SLUG))).toBe(false); // no skill dir
    expect(await exists(staged)).toBe(false); // staging cleaned up
    expect(await exists(join(root, '.system', 'skill-manager', 'manifest.json'))).toBe(false);
  });

  it('rolls back a fresh install when publish fails', async () => {
    const root = await tempRoot();
    class FailingPublishRoot extends SkillRoot {
      override async publishStaged(): Promise<void> {
        throw new Error('rename failed');
      }
    }
    const deps = { ...makeDeps(root), root: new FailingPublishRoot(root) };

    await expect(installSkill(deps, { id: ID })).rejects.toMatchObject({ code: 'install-partial-failure' });

    expect(await exists(join(root, SLUG))).toBe(false);
    expect(await exists(join(root, '.system', 'skill-manager', '.staging', SLUG))).toBe(false);
    expect(await exists(join(root, '.system', 'skill-manager', 'manifest.json'))).toBe(false);
  });

  it('rolls back an overwrite when publish fails, leaving the prior skill intact', async () => {
    const root = await tempRoot();
    await installSkill(makeDeps(root), { id: ID });
    const original = await readFile(join(root, SLUG, 'SKILL.md'), 'utf8');
    const before = await readManifest(root);

    class FailingPublishRoot extends SkillRoot {
      override async publishStaged(): Promise<void> {
        throw new Error('rename failed');
      }
    }
    const deps = { ...makeDeps(root), root: new FailingPublishRoot(root) };

    await expect(installSkill(deps, { id: ID, overwrite: true })).rejects.toMatchObject({
      code: 'install-partial-failure',
    });

    expect(await readFile(join(root, SLUG, 'SKILL.md'), 'utf8')).toBe(original); // prior state intact
    expect(await readManifest(root)).toEqual(before);
    expect(await exists(join(root, '.system', 'skill-manager', '.staging', SLUG))).toBe(false);
  });

  it('rolls back a fresh install when the manifest save fails after publish', async () => {
    const root = await tempRoot();
    class FailingSaveStore extends ManifestStore {
      override async save(): Promise<void> {
        throw new Error('disk full');
      }
    }
    const deps = { ...makeDeps(root), store: new FailingSaveStore(root) };

    await expect(installSkill(deps, { id: ID })).rejects.toMatchObject({ code: 'install-partial-failure' });

    expect(await exists(join(root, SLUG))).toBe(false); // published skill rolled back
    expect(await exists(join(root, '.system', 'skill-manager', 'manifest.json'))).toBe(false);
    expect(await exists(join(root, '.system', 'skill-manager', '.staging', SLUG))).toBe(false);
  });

  it('rolls back an overwrite when the manifest save fails after publish, restoring the prior skill', async () => {
    const root = await tempRoot();
    await installSkill(makeDeps(root), { id: ID });
    const original = await readFile(join(root, SLUG, 'SKILL.md'), 'utf8');
    const before = await readManifest(root);

    class FailingSaveStore extends ManifestStore {
      override async save(): Promise<void> {
        throw new Error('disk full');
      }
    }
    const deps = { ...makeDeps(root), store: new FailingSaveStore(root) };

    await expect(installSkill(deps, { id: ID, overwrite: true })).rejects.toMatchObject({
      code: 'install-partial-failure',
    });

    expect(await readFile(join(root, SLUG, 'SKILL.md'), 'utf8')).toBe(original);
    expect(await readManifest(root)).toEqual(before);
    expect(await exists(join(root, '.system', 'skill-manager', '.staging', SLUG))).toBe(false);
  });

  it('clears a stale staging directory left by an interrupted attempt', async () => {
    const root = await tempRoot();
    const staged = join(root, '.system', 'skill-manager', '.staging', SLUG);
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, 'stale.txt'), 'stale');

    await installSkill(makeDeps(root, mockClient()), { id: ID });

    // The published skill contains only the snapshot files — never stale staging debris.
    expect(await exists(join(root, SLUG, 'stale.txt'))).toBe(false);
    expect(await exists(join(root, SLUG, 'SKILL.md'))).toBe(true);
  });

  it('propagates a network failure before any write and leaves nothing behind', async () => {
    const root = await tempRoot();
    const client = mockClient({
      getSnapshot: async () => {
        throw new SkillsShError('network-unavailable', 'network down');
      },
    });

    await expect(installSkill(makeDeps(root, client), { id: ID })).rejects.toMatchObject({
      code: 'network-unavailable',
    });
    expect(await readdir(root)).toEqual([]);
  });

  it('never writes outside the skills root for a hostile snapshot', async () => {
    const root = await tempRoot();
    const parentSentinel = join(dirname(root), 'should-not-exist.md');
    const snap = snapshot({
      files: [
        { path: 'SKILL.md', contents: skillMd },
        { path: '../../../../escape.md', contents: 'evil' },
      ],
    });

    await expect(installSkill(makeDeps(root, mockClient({ getSnapshot: async () => snap })), { id: ID })).rejects.toMatchObject({
      code: 'unsafe-path',
    });

    expect(await exists(parentSentinel)).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. RPC / service seam
// ---------------------------------------------------------------------------

describe('SkillManagerService + RPC install endpoint', () => {
  it('answers a typed install over the /skill-manager channel', async () => {
    const root = await tempRoot();
    const service = new SkillManagerService({
      version: '1.0.0',
      skillsRoot: root,
      client: mockClient(),
      now: () => Date.parse('2024-01-02T03:04:05.000Z'),
    });
    const handler = createRpcHandler(service);

    const result = await handler('install', { id: ID } satisfies InstallRequest, new AbortController().signal);

    expect(result).toEqual({
      ok: true,
      value: {
        slug: SLUG,
        source: SOURCE,
        remoteSourceHash: 'opaque-upstream-fingerprint-abc',
        localContentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        installedAt: '2024-01-02T03:04:05.000Z',
        updatedAt: '2024-01-02T03:04:05.000Z',
      },
    });
    expect(await exists(join(root, SLUG, 'SKILL.md'))).toBe(true);
  });

  it('returns a typed {ok:false,error} for a foreign target, never a raw throw', async () => {
    const root = await tempRoot();
    await mkdir(join(root, SLUG), { recursive: true });
    const service = new SkillManagerService({ version: '1.0.0', skillsRoot: root, client: mockClient() });
    const handler = createRpcHandler(service);

    const result = await handler('install', { id: ID } satisfies InstallRequest, new AbortController().signal);

    expect(result).toMatchObject({ ok: false, error: { code: 'foreign-target' } });
  });
});

describe('InstallError', () => {
  it('exposes a typed RPC-normalizable shape', () => {
    const err = new InstallError('foreign-target', 'occupied', { path: '/x' });
    expect(err.code).toBe('foreign-target');
    expect(isSkillsShError(err)).toBe(false);
    expect((err as unknown as { toRpcError: () => unknown }).toRpcError()).toEqual({
      code: 'foreign-target',
      message: 'occupied',
      details: { path: '/x' },
    });
  });
});
