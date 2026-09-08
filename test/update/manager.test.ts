import { readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { localContentHash, ManifestStore } from '../../src/manifest';
import { SkillRoot } from '../../src/path-safety';
import { UpdateManager } from '../../src/update';
import type { UpdateManagerOptions } from '../../src/update';
import { cleanupRoots, FakeSkillsShClient, installSkill, readInstalled, snapshot, tempSkillsRoot, writeCorruptManifest } from './helpers';

const SLUG = 'find-skills';
const ID = `owner/repo/${SLUG}`;

const NEW_FILES = [
  { path: 'SKILL.md', contents: '---\nname: find-skills\ndescription: "Updated skill"\n---\n# Updated\n' },
  { path: 'README.md', contents: '# New readme\n' },
];

afterEach(async () => {
  await cleanupRoots();
});

function manager(root: string, client: FakeSkillsShClient, overrides: Partial<UpdateManagerOptions> = {}) {
  return new UpdateManager({
    skillsRoot: root,
    client,
    now: () => 0,
    ...overrides,
  });
}

async function manifestSkills(root: string) {
  const loaded = await new ManifestStore(root).load();
  return loaded.manifest.skills;
}

describe('UpdateManager.checkUpdates', () => {
  it('reports up-to-date when remote and local both match', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v1'));

    const { updates } = await manager(root, client).checkUpdates();

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      slug: SLUG,
      status: 'up-to-date',
      updateAvailable: false,
      upstreamChanged: false,
      localModified: false,
    });
  });

  it('reports update-available when only the remote hash changed', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2'));

    const { updates } = await manager(root, client).checkUpdates();

    expect(updates[0]).toMatchObject({
      status: 'update-available',
      updateAvailable: true,
      upstreamChanged: true,
      localModified: false,
      recordedRemoteSourceHash: 'opaque-v1',
      latestRemoteSourceHash: 'opaque-v2',
    });
  });

  it('treats the remote hash as opaque and never recomputes it', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG, undefined, { remoteSourceHash: 'not-a-sha:abc' });
    client.setSnapshot(ID, snapshot(ID, 'not-a-sha:def'));

    const { updates } = await manager(root, client).checkUpdates();

    expect(updates[0]).toMatchObject({
      status: 'update-available',
      recordedRemoteSourceHash: 'not-a-sha:abc',
      latestRemoteSourceHash: 'not-a-sha:def',
    });
    // The recorded localContentHash is the plugin's SHA-256, independent of the
    // opaque remote fingerprint; the two are never conflated.
    expect(updates[0].recordedLocalContentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports locally-modified when the installed files drifted', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await writeFile(join(root, SLUG, 'README.md'), '# edited locally\n', 'utf8');
    client.setSnapshot(ID, snapshot(ID, 'opaque-v1'));

    const { updates } = await manager(root, client).checkUpdates();

    expect(updates[0]).toMatchObject({
      status: 'locally-modified',
      updateAvailable: false,
      localModified: true,
    });
    expect(updates[0].currentLocalContentHash).toBeDefined();
    expect(updates[0].currentLocalContentHash).not.toBe(updates[0].recordedLocalContentHash);
  });

  it('reports update-available-and-locally-modified when both axes differ', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await writeFile(join(root, SLUG, 'README.md'), '# edited locally\n', 'utf8');
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2'));

    const { updates } = await manager(root, client).checkUpdates();

    expect(updates[0]).toMatchObject({
      status: 'update-available-and-locally-modified',
      updateAvailable: true,
      localModified: true,
    });
  });

  it('reports source-unavailable when the snapshot is gone (404)', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setError(ID, 'source-unavailable', 'skill source not found');

    const { updates } = await manager(root, client).checkUpdates();

    expect(updates[0]).toMatchObject({
      status: 'source-unavailable',
      updateAvailable: false,
      localModified: false,
      error: { code: 'source-unavailable' },
    });
  });

  it('reports remote-check-failure for a network failure, without hiding drift', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await writeFile(join(root, SLUG, 'README.md'), '# drift\n', 'utf8');
    client.setError(ID, 'network-unavailable', 'offline');

    const { updates } = await manager(root, client).checkUpdates();

    expect(updates[0]).toMatchObject({
      status: 'remote-check-failure',
      updateAvailable: false,
      localModified: true,
      error: { code: 'network-unavailable' },
    });
  });

  it('omits a managed skill whose directory is missing on disk', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await rm(join(root, SLUG), { recursive: true, force: true });

    const { updates } = await manager(root, client).checkUpdates();

    expect(updates).toEqual([]);
  });

  it('never mutates the manifest while checking', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    const entry = await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2'));

    await manager(root, client).checkUpdates();

    expect((await manifestSkills(root))[SLUG]).toEqual(entry);
  });

  it('reports no skills (never crashes) when the manifest is corrupt', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await writeCorruptManifest(root);

    const { updates } = await manager(root, client).checkUpdates();

    expect(updates).toEqual([]);
    // The corrupt manifest is left for the user to repair, never rewritten.
    expect((await new ManifestStore(root).load()).status).toBe('corrupt');
  });
});

describe('UpdateManager.update', () => {
  it('refuses to update a foreign skill (directory with no manifest entry)', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, 'foreign-skill', [
      { path: 'SKILL.md', contents: '---\nname: foreign\ndescription: "foreign"\n---\n' },
    ]);
    // Simulate it being foreign by removing its manifest entry entirely.
    const store = new ManifestStore(root);
    const loaded = await store.load();
    delete loaded.manifest.skills['foreign-skill'];
    await store.save(loaded.manifest);

    client.setSnapshot('owner/repo/foreign-skill', snapshot('owner/repo/foreign-skill', 'opaque-v1'));

    await expect(manager(root, client).update({ id: 'owner/repo/foreign-skill' })).rejects.toMatchObject({
      code: 'skill-not-found',
    });
    expect(await readInstalled(root, 'foreign-skill', 'SKILL.md')).toContain('name: foreign');
  });

  it('refuses to update a managed skill whose directory is missing', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await rm(join(root, SLUG), { recursive: true, force: true });
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));

    await expect(manager(root, client).update({ id: ID })).rejects.toMatchObject({
      code: 'skill-not-found',
    });
  });

  it('refuses an update whose id source does not match the recorded source', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot('other/repo/find-skills', snapshot('other/repo/find-skills', 'opaque-v2', NEW_FILES));

    await expect(manager(root, client).update({ id: 'other/repo/find-skills' })).rejects.toMatchObject({
      code: 'skill-not-found',
    });
  });

  it('refuses a well-known (non-GitHub) source', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();

    await expect(manager(root, client).update({ id: 'example.com/foo/bar' })).rejects.toMatchObject({
      code: 'source-unavailable',
    });
  });

  it('refuses to update when the manifest is corrupt, leaving the skill intact', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));
    await writeCorruptManifest(root);

    await expect(manager(root, client).update({ id: ID })).rejects.toMatchObject({
      code: 'manifest-corruption',
    });

    expect(await readInstalled(root, SLUG, 'README.md')).toBe('# Readme\n');
    expect((await new ManifestStore(root).load()).status).toBe('corrupt');
  });

  it('leaves the installed skill intact when the snapshot fetch fails', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setError(ID, 'source-unavailable', 'skill source not found');

    await expect(manager(root, client).update({ id: ID })).rejects.toMatchObject({
      code: 'source-unavailable',
    });

    // Nothing was staged, swapped, or re-recorded.
    expect(await readInstalled(root, SLUG, 'README.md')).toBe('# Readme\n');
    expect((await manifestSkills(root))[SLUG].remoteSourceHash).toBe('opaque-v1');
    await expect(readdir(join(root, '.system', 'skill-manager', '.staging'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('is a no-op when already up to date and unmodified', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    const installed = await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v1'));

    const result = await manager(root, client).update({ id: ID });

    expect(result).toMatchObject({
      applied: false,
      remoteSourceHash: 'opaque-v1',
      updatedAt: installed.updatedAt,
    });
    // Nothing was staged, swapped, or re-recorded.
    const entry = (await manifestSkills(root))[SLUG];
    expect(entry).toEqual(installed);
    await expect(readdir(join(root, '.system', 'skill-manager', '.staging'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('applies a valid update and refreshes both hashes + updatedAt', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));

    const result = await manager(root, client).update({ id: ID });

    expect(result).toEqual({
      slug: SLUG,
      source: 'owner/repo',
      remoteSourceHash: 'opaque-v2',
      localContentHash: localContentHash(NEW_FILES),
      updatedAt: '1970-01-01T00:00:00.000Z',
      discardedLocalChanges: false,
      applied: true,
    });
    expect(await readInstalled(root, SLUG, 'README.md')).toBe('# New readme\n');

    const entry = (await manifestSkills(root))[SLUG];
    expect(entry.remoteSourceHash).toBe('opaque-v2');
    expect(entry.localContentHash).toBe(localContentHash(NEW_FILES));
    expect(entry.updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('protects local modifications unless discardLocalChanges is set', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await writeFile(join(root, SLUG, 'README.md'), '# my edit\n', 'utf8');
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));

    await expect(manager(root, client).update({ id: ID })).rejects.toMatchObject({
      code: 'local-modification-conflict',
    });
    // Local edit and manifest provenance are untouched.
    expect(await readInstalled(root, SLUG, 'README.md')).toBe('# my edit\n');
    expect((await manifestSkills(root))[SLUG].remoteSourceHash).toBe('opaque-v1');
  });

  it('overwrites local modifications when discardLocalChanges is true', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await writeFile(join(root, SLUG, 'README.md'), '# my edit\n', 'utf8');
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));

    const result = await manager(root, client).update({ id: ID, discardLocalChanges: true });

    expect(result.discardedLocalChanges).toBe(true);
    expect(await readInstalled(root, SLUG, 'README.md')).toBe('# New readme\n');
  });

  it('refuses an unsafe snapshot without mutating the skill or writing outside staging', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(
      ID,
      snapshot(ID, 'opaque-v2', [
        { path: 'SKILL.md', contents: NEW_FILES[0].contents },
        { path: '../evil.txt', contents: 'escape' },
      ]),
    );

    await expect(manager(root, client).update({ id: ID })).rejects.toMatchObject({ code: 'unsafe-path' });

    // The installed skill is unchanged and no escape file was written anywhere.
    expect(await readInstalled(root, SLUG, 'README.md')).toBe('# Readme\n');
    const rootEntries = (await readdir(root)).sort();
    expect(rootEntries).toEqual(['.system', SLUG]);
    const skillEntries = (await readdir(join(root, SLUG))).sort();
    expect(skillEntries).toEqual(['README.md', 'SKILL.md']);
  });

  it('refuses a snapshot missing a valid SKILL.md frontmatter', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(
      ID,
      snapshot(ID, 'opaque-v2', [{ path: 'SKILL.md', contents: '---\nname: only-name\n---\n# no description\n' }]),
    );

    await expect(manager(root, client).update({ id: ID })).rejects.toMatchObject({ code: 'malformed-snapshot' });
    expect(await readInstalled(root, SLUG, 'README.md')).toBe('# Readme\n');
  });

  it('leaves the old skill intact when the swap fails', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));

    class FailingPublishRoot extends SkillRoot {
      override async publishStaged(): Promise<void> {
        throw new Error('simulated publish failure');
      }
    }

    await expect(
      manager(root, client, { root: new FailingPublishRoot(root) }).update({ id: ID }),
    ).rejects.toThrow('simulated publish failure');

    expect(await readInstalled(root, SLUG, 'README.md')).toBe('# Readme\n');
    expect((await manifestSkills(root))[SLUG].remoteSourceHash).toBe('opaque-v1');
    // Staging was cleaned up deterministically.
    const staging = join(root, '.system', 'skill-manager', '.staging', SLUG);
    await expect(readdir(staging)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back the swap when the manifest write fails, restoring the prior skill', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2', NEW_FILES));

    const real = new ManifestStore(root);
    await expect(
      manager(root, client, {
        store: {
          load: () => real.load(),
          save: () => Promise.reject(new Error('disk full')),
        },
      }).update({ id: ID }),
    ).rejects.toMatchObject({ code: 'update-partial-failure' });

    // The prior skill is restored and provenance is unchanged (no partial state).
    expect(await readInstalled(root, SLUG, 'README.md')).toBe('# Readme\n');
    const onDisk = await new ManifestStore(root).load();
    expect(onDisk.manifest.skills[SLUG].remoteSourceHash).toBe('opaque-v1');
    await expect(readdir(join(root, '.system', 'skill-manager', '.staging', SLUG))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
