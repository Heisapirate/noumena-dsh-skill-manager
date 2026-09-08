import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManifestStore, reconcile } from '../../src/manifest/store';
import {
  emptyManifest,
  MANIFEST_RELATIVE_PATH,
  MANIFEST_SCHEMA_VERSION,
  manifestPath,
  type LocalContentHash,
  type RemoteSourceHash,
  type SkillManifest,
  type SkillManifestEntry,
} from '../../src/manifest/types';

const remote = (s: string): RemoteSourceHash => s as RemoteSourceHash;
const local = (s: string): LocalContentHash => s as LocalContentHash;

function makeEntry(slug: string, overrides: Partial<SkillManifestEntry> = {}): SkillManifestEntry {
  return {
    source: 'owner/repo',
    slug,
    remoteSourceHash: remote(`opaque-${slug}`),
    localContentHash: local('a'.repeat(64)),
    installedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeManifest(entries: SkillManifestEntry[]): SkillManifest {
  const skills: Record<string, SkillManifestEntry> = {};
  for (const entry of entries) skills[entry.slug] = entry;
  return { version: MANIFEST_SCHEMA_VERSION, skills };
}

const roots: string[] = [];
async function tempSkillsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sm-manifest-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

async function writeRawManifest(root: string, text: string): Promise<void> {
  const file = manifestPath(root);
  await mkdir(join(root, '.system', 'skill-manager'), { recursive: true });
  await writeFile(file, text, 'utf8');
}

describe('manifest schema constants', () => {
  it('pins the schema version and manifest location', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(1);
    expect(MANIFEST_RELATIVE_PATH).toBe('.system/skill-manager/manifest.json');
  });
});

describe('ManifestStore.load', () => {
  it('returns an empty manifest with status "missing" when no manifest exists', async () => {
    const store = new ManifestStore(await tempSkillsRoot());
    await expect(store.load()).resolves.toEqual({
      status: 'missing',
      manifest: emptyManifest(),
      dropped: [],
      foreign: [],
    });
  });

  it('round-trips a manifest through save and load', async () => {
    const root = await tempSkillsRoot();
    await mkdir(join(root, 'find-skills'));
    const store = new ManifestStore(root);
    const manifest = makeManifest([makeEntry('find-skills')]);

    await store.save(manifest);
    const result = await store.load();

    expect(result.status).toBe('ok');
    expect(result.manifest).toEqual(manifest);
    expect(result.dropped).toEqual([]);
    expect(result.foreign).toEqual([]);
  });

  it('treats malformed JSON as corrupt and never throws', async () => {
    const root = await tempSkillsRoot();
    await writeRawManifest(root, '{ this is not json');
    const result = await new ManifestStore(root).load();

    expect(result.status).toBe('corrupt');
    expect(result.corruption?.reason).toBe('malformed-json');
    expect(result.manifest).toEqual(emptyManifest());
    expect(result.dropped).toEqual([]);
    expect(result.foreign).toEqual([]);
  });

  it('treats invalid structure (skills not an object) as corrupt', async () => {
    const root = await tempSkillsRoot();
    await writeRawManifest(root, JSON.stringify({ version: 1, skills: [] }));
    const result = await new ManifestStore(root).load();

    expect(result.status).toBe('corrupt');
    expect(result.corruption?.reason).toBe('invalid-structure');
  });

  it('treats an entry with wrong field types as corrupt', async () => {
    const root = await tempSkillsRoot();
    await writeRawManifest(root, JSON.stringify({ version: 1, skills: { x: { source: 123 } } }));
    const result = await new ManifestStore(root).load();

    expect(result.status).toBe('corrupt');
    expect(result.corruption?.reason).toBe('invalid-structure');
  });

  it('treats a slug/key mismatch as corrupt', async () => {
    const root = await tempSkillsRoot();
    await writeRawManifest(
      root,
      JSON.stringify({
        version: 1,
        skills: { key: makeEntry('different-slug') },
      }),
    );
    const result = await new ManifestStore(root).load();

    expect(result.status).toBe('corrupt');
    expect(result.corruption?.reason).toBe('invalid-structure');
  });

  it('treats an unsupported version as corrupt', async () => {
    const root = await tempSkillsRoot();
    await writeRawManifest(root, JSON.stringify({ version: 2, skills: {} }));
    const result = await new ManifestStore(root).load();

    expect(result.status).toBe('corrupt');
    expect(result.corruption?.reason).toBe('unsupported-version');
  });

  it('drops manifest entries whose local directory is missing', async () => {
    const root = await tempSkillsRoot();
    await mkdir(join(root, 'present'));
    const store = new ManifestStore(root);
    await store.save(makeManifest([makeEntry('present'), makeEntry('gone')]));

    const result = await store.load();

    expect(result.status).toBe('ok');
    expect(Object.keys(result.manifest.skills)).toEqual(['present']);
    expect(result.dropped).toEqual(['gone']);
    expect(result.foreign).toEqual([]);
  });

  it('treats a directory with no manifest entry as foreign (never adopted)', async () => {
    const root = await tempSkillsRoot();
    await mkdir(join(root, 'foreign-skill'));
    const result = await new ManifestStore(root).load();

    expect(result.status).toBe('missing');
    expect(result.foreign).toEqual(['foreign-skill']);
    expect(result.manifest.skills).toEqual({});
  });

  it('leaves a foreign directory alone even when a manifest exists', async () => {
    const root = await tempSkillsRoot();
    await mkdir(join(root, 'managed'));
    await mkdir(join(root, 'foreign-skill'));
    const store = new ManifestStore(root);
    await store.save(makeManifest([makeEntry('managed')]));

    const result = await store.load();

    expect(result.status).toBe('ok');
    expect(Object.keys(result.manifest.skills)).toEqual(['managed']);
    expect(result.foreign).toEqual(['foreign-skill']);
  });

  it('never treats .system as a skill or a foreign entry', async () => {
    const root = await tempSkillsRoot();
    await mkdir(join(root, '.system'));
    await mkdir(join(root, 'foreign-skill'));
    const result = await new ManifestStore(root).load();

    expect(result.foreign).toEqual(['foreign-skill']);
    expect(result.manifest.skills).toEqual({});
  });

  it('excludes the .system directory created by save from foreign skills', async () => {
    const root = await tempSkillsRoot();
    await mkdir(join(root, 'managed'));
    const store = new ManifestStore(root);
    await store.save(makeManifest([makeEntry('managed')]));

    const result = await store.load();

    expect(result.status).toBe('ok');
    expect(Object.keys(result.manifest.skills)).toEqual(['managed']);
    expect(result.foreign).toEqual([]);
  });
});

describe('ManifestStore.save (atomic persistence contract)', () => {
  it('writes at the exact path, leaves no temp/lock siblings, and round-trips', async () => {
    const root = await tempSkillsRoot();
    const manifest = makeManifest([makeEntry('find-skills')]);
    await new ManifestStore(root).save(manifest);

    const file = manifestPath(root);
    expect(file).toBe(join(root, '.system', 'skill-manager', 'manifest.json'));

    const text = await readFile(file, 'utf8');
    expect(JSON.parse(text)).toEqual(manifest);

    // Atomic write must not leave `.tmp` or `.lock` artifacts behind.
    const siblings = await readdir(join(root, '.system', 'skill-manager'));
    expect(siblings).toEqual(['manifest.json']);
  });

  it('replaces the previous manifest contents', async () => {
    const root = await tempSkillsRoot();
    const store = new ManifestStore(root);
    await store.save(makeManifest([makeEntry('a')]));
    await store.save(makeManifest([makeEntry('b')]));

    const parsed = JSON.parse(await readFile(manifestPath(root), 'utf8'));
    expect(parsed.skills).toHaveProperty('b');
    expect(parsed.skills).not.toHaveProperty('a');
  });

  it('refuses to persist an entry whose slug does not match its key', async () => {
    const root = await tempSkillsRoot();
    const skills: Record<string, SkillManifestEntry> = { key: makeEntry('different-slug') };
    const manifest: SkillManifest = { version: MANIFEST_SCHEMA_VERSION, skills };
    await expect(new ManifestStore(root).save(manifest)).rejects.toThrow(/slug/i);
  });
});

describe('remoteSourceHash / localContentHash separation', () => {
  it('preserves remoteSourceHash verbatim through reconciliation (opaque, never recomputed)', async () => {
    const root = await tempSkillsRoot();
    await mkdir(join(root, 'x'));
    const store = new ManifestStore(root);
    const opaque = 'not-a-sha256-at-all:an-upstream-fingerprint';
    await store.save(makeManifest([makeEntry('x', { remoteSourceHash: remote(opaque) })]));

    const result = await store.load();

    expect(result.manifest.skills.x.remoteSourceHash).toBe(opaque);
    // The two hashes are separate fields and are never treated as equivalent.
    expect(result.manifest.skills.x.localContentHash).toBe('a'.repeat(64));
  });
});

describe('reconcile', () => {
  it('keeps entries with a matching directory, drops missing ones, and lists foreign dirs', () => {
    const result = reconcile(makeManifest([makeEntry('kept'), makeEntry('gone')]), ['kept', 'foreign']);

    expect(Object.keys(result.manifest.skills)).toEqual(['kept']);
    expect(result.dropped).toEqual(['gone']);
    expect(result.foreign).toEqual(['foreign']);
  });

  it('does not mutate the input manifest', () => {
    const manifest = makeManifest([makeEntry('kept'), makeEntry('gone')]);
    reconcile(manifest, ['kept']);

    expect(Object.keys(manifest.skills)).toEqual(['kept', 'gone']);
  });

  it('orders dropped and foreign lists deterministically', () => {
    const result = reconcile(makeManifest([makeEntry('z'), makeEntry('a')]), []);
    expect(result.dropped).toEqual(['a', 'z']);
    expect(reconcile(emptyManifest(), ['b', 'a']).foreign).toEqual(['a', 'b']);
  });
});
