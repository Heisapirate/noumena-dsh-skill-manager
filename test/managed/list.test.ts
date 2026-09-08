// Host-side `list()` behavior (Issue #15). The managed listing reuses the
// reconciled manifest (#10) and the accepted update-status model (#16): it
// returns only manifest-recorded skills that are present on disk, each with its
// provenance and the same `status` the `checkUpdates` endpoint reports. Foreign
// directories are never returned, and a managed entry whose directory is gone
// is dropped as already-uninstalled (spec §6, ADR-0002).

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRpcHandler } from '../../src/rpc';
import { SkillManagerService } from '../../src/service';
import type { ManagedSkill } from '../../src/types';
import {
  cleanupRoots,
  FakeSkillsShClient,
  installSkill,
  snapshot,
  tempSkillsRoot,
  writeCorruptManifest,
} from '../update/helpers';

const SLUG = 'find-skills';
const ID = `owner/repo/${SLUG}`;
const signal = () => new AbortController().signal;

afterEach(async () => {
  await cleanupRoots();
});

function makeService(root: string, client: FakeSkillsShClient): SkillManagerService {
  return new SkillManagerService({
    version: '1.0.0',
    skillsRoot: root,
    client,
    now: () => 0,
  });
}

async function listSkills(root: string, client: FakeSkillsShClient): Promise<ManagedSkill[]> {
  return (await makeService(root, client).list()).skills;
}

describe('SkillManagerService.list', () => {
  it('returns an empty list when the plugin manages no skills', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();

    await expect(listSkills(root, client)).resolves.toEqual([]);
  });

  it('returns only manifest-managed skills and excludes foreign directories', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v1'));
    // A foreign skill directory that happens to exist on disk, with no manifest
    // entry. It must never appear as plugin-managed.
    await mkdir(join(root, 'foreign-skill'), { recursive: true });
    await writeFile(join(root, 'foreign-skill', 'SKILL.md'), '---\nname: foreign-skill\n---\n', 'utf8');

    const skills = await listSkills(root, client);

    expect(skills.map((s) => s.slug)).toEqual([SLUG]);
  });

  it('reports basic provenance and status for a managed skill', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    const entry = await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v1'));

    const skills = await listSkills(root, client);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      slug: SLUG,
      source: 'owner/repo',
      id: ID,
      remoteSourceHash: 'opaque-v1',
      localContentHash: entry.localContentHash,
      installedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      status: 'up-to-date',
      localModified: false,
      updateAvailable: false,
    });
    // The listing exposes registry identifiers + status, never a filesystem
    // path. Lock the exact key set so no path field can creep in.
    expect(Object.keys(skills[0]).sort()).toEqual([
      'id',
      'installedAt',
      'localContentHash',
      'localModified',
      'remoteSourceHash',
      'slug',
      'source',
      'status',
      'updateAvailable',
      'updatedAt',
    ]);
  });

  it('drops a managed entry whose directory is missing (already-uninstalled)', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await rm(join(root, SLUG), { recursive: true, force: true });

    await expect(listSkills(root, client)).resolves.toEqual([]);
  });

  it('returns an empty list (never crashes) when the manifest is corrupt', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    await writeCorruptManifest(root);

    await expect(listSkills(root, client)).resolves.toEqual([]);
  });

  it('reports local drift when the installed files changed', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v1'));
    await writeFile(join(root, SLUG, 'README.md'), '# local edit\n', 'utf8');

    const skills = await listSkills(root, client);

    expect(skills[0]).toMatchObject({
      status: 'locally-modified',
      localModified: true,
      updateAvailable: false,
    });
  });

  it('reports update availability when the upstream hash changed', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2'));

    const skills = await listSkills(root, client);

    expect(skills[0]).toMatchObject({
      status: 'update-available',
      localModified: false,
      updateAvailable: true,
    });
  });

  it('reports update available plus local drift when both differ', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v2'));
    await writeFile(join(root, SLUG, 'README.md'), '# local edit\n', 'utf8');

    const skills = await listSkills(root, client);

    expect(skills[0]).toMatchObject({
      status: 'update-available-and-locally-modified',
      localModified: true,
      updateAvailable: true,
    });
  });

  it('flags an unavailable source rather than silently dropping the skill', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setError(ID, 'source-unavailable', 'gone');

    const skills = await listSkills(root, client);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      slug: SLUG,
      status: 'source-unavailable',
      updateAvailable: false,
      error: { code: 'source-unavailable' },
    });
  });

  it('keeps a per-skill remote-check failure without dropping the skill', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setError(ID, 'network-unavailable', 'offline');

    const skills = await listSkills(root, client);

    expect(skills[0]).toMatchObject({
      status: 'remote-check-failure',
      error: { code: 'network-unavailable' },
    });
  });
});

describe('createRpcHandler list', () => {
  it('returns the typed { ok, value } result with managed identifiers', async () => {
    const root = await tempSkillsRoot();
    const client = new FakeSkillsShClient();
    await installSkill(root, SLUG);
    client.setSnapshot(ID, snapshot(ID, 'opaque-v1'));

    const handler = createRpcHandler(makeService(root, client));
    const result = await handler('list', {}, signal());

    expect(result).toEqual({
      ok: true,
      value: {
        skills: [expect.objectContaining({ slug: SLUG, source: 'owner/repo', id: ID })],
      },
    });
  });
});
