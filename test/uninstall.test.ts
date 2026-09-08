// Filesystem integration tests for the uninstall transaction (Issue #17, spec
// §11). The seam under test is `SkillManagerService.uninstall` — the host-side
// business API behind the `/skill-manager` RPC `uninstall` endpoint.
//
// Every test uses a temp skills root; nothing here touches a real DSH skills
// root. The manifest/path-safety primitives are real implementations (no
// internal mocking); only the two deletion/manifest boundaries are swapped for
// deterministic failure tests.

import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { localContentHash } from '../src/manifest/hash';
import { manifestPath, ManifestStore } from '../src/manifest';
import type { ManifestLoadResult } from '../src/manifest';
import {
  MANIFEST_SCHEMA_VERSION,
  type LocalContentHash,
  type RemoteSourceHash,
  type SkillFile,
  type SkillManifest,
  type SkillManifestEntry,
} from '../src/manifest';
import { PathSafetyError, SkillRoot } from '../src/path-safety';
import { SkillManagerService } from '../src/service';
import type { SkillManagerServiceOptions } from '../src/service';
import type { SkillsShClient } from '../src/skills-sh';

const JUNCTION_SUPPORTED: boolean = (() => {
  try {
    const base = mkdtempSync(join(tmpdir(), 'dsh-uninstall-junction-probe-'));
    const target = join(base, 'target');
    mkdirSync(target);
    symlinkSync(target, join(base, 'link'), 'junction');
    rmSync(base, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

const remote = (s: string): RemoteSourceHash => s as RemoteSourceHash;
const local = (s: string): LocalContentHash => s as LocalContentHash;

const SNAPSHOT: SkillFile[] = [
  { path: 'SKILL.md', contents: '---\nname: find-skills\ndescription: find things\n---\n# Find skills\n' },
  { path: 'docs/guide.md', contents: '# Guide\n' },
];

const roots: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sm-uninstall-'));
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

async function writeFiles(root: string, slug: string, files: SkillFile[]): Promise<void> {
  for (const f of files) {
    const p = join(root, slug, ...f.path.split('/'));
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, f.contents, 'utf8');
  }
}

function makeEntry(slug: string, localHash: LocalContentHash, overrides: Partial<SkillManifestEntry> = {}): SkillManifestEntry {
  return {
    source: 'owner/repo',
    slug,
    remoteSourceHash: remote(`opaque-${slug}`),
    localContentHash: localHash,
    installedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function writeManifest(root: string, skills: SkillManifestEntry[]): Promise<void> {
  const manifest: SkillManifest = {
    version: MANIFEST_SCHEMA_VERSION,
    skills: Object.fromEntries(skills.map((e) => [e.slug, e])),
  };
  await new ManifestStore(root).save(manifest);
}

/** Install a managed skill: write snapshot files, merge a hash entry into the manifest. */
async function installSkill(root: string, slug: string, files: SkillFile[] = SNAPSHOT): Promise<void> {
  await writeFiles(root, slug, files);
  const store = new ManifestStore(root);
  const load = await store.load();
  const skills = { ...load.manifest.skills, [slug]: makeEntry(slug, localContentHash(files)) };
  await store.save({ version: load.manifest.version, skills });
}

const stubClient: SkillsShClient = {
  search: async () => [],
  getSnapshot: async () => {
    throw new Error('unused');
  },
  getDescription: async () => null,
};

function makeService(root: string, overrides: Partial<SkillManagerServiceOptions> = {}): SkillManagerService {
  return new SkillManagerService({ version: '1.0.0', skillsRoot: root, client: stubClient, ...overrides });
}

describe('SkillManagerService.uninstall', () => {
  it('uninstalls a managed skill with confirmation, removing dir and manifest entry', async () => {
    const root = await tempRoot();
    await installSkill(root, 'find-skills');

    await expect(makeService(root).uninstall({ id: 'find-skills', confirm: true })).resolves.toEqual({ ok: true });

    expect(await exists(join(root, 'find-skills'))).toBe(false);
    const load = await new ManifestStore(root).load();
    expect(load.manifest.skills).not.toHaveProperty('find-skills');
  });

  it('leaves an unrelated managed skill and its manifest entry untouched', async () => {
    const root = await tempRoot();
    await installSkill(root, 'keep-me');
    await installSkill(root, 'remove-me');

    await makeService(root).uninstall({ id: 'remove-me', confirm: true });

    expect(await exists(join(root, 'keep-me'))).toBe(true);
    expect(await exists(join(root, 'remove-me'))).toBe(false);
    const load = await new ManifestStore(root).load();
    expect(load.manifest.skills).toHaveProperty('keep-me');
    expect(load.manifest.skills).not.toHaveProperty('remove-me');
  });

  it('refuses a foreign directory (on disk, no manifest entry) and leaves it alone', async () => {
    const root = await tempRoot();
    await writeFiles(root, 'foreign-skill', SNAPSHOT);

    await expect(makeService(root).uninstall({ id: 'foreign-skill', confirm: true })).rejects.toMatchObject({
      code: 'foreign-skill',
    });
    expect(await exists(join(root, 'foreign-skill'))).toBe(true);
  });

  it('returns skill-not-found for an unknown id with no directory', async () => {
    const root = await tempRoot();
    await expect(makeService(root).uninstall({ id: 'never-installed', confirm: true })).rejects.toMatchObject({
      code: 'skill-not-found',
    });
  });

  it('treats a manifest entry whose directory is missing as already-uninstalled (idempotent)', async () => {
    const root = await tempRoot();
    await writeFiles(root, 'gone', SNAPSHOT);
    await writeManifest(root, [makeEntry('gone', localContentHash(SNAPSHOT))]);
    await rm(join(root, 'gone'), { recursive: true, force: true }); // simulate interrupted uninstall

    await expect(makeService(root).uninstall({ id: 'gone', confirm: true })).resolves.toEqual({ ok: true });

    const load = await new ManifestStore(root).load();
    expect(load.manifest.skills).not.toHaveProperty('gone');
  });

  it('refuses a corrupt manifest (cannot prove ownership)', async () => {
    const root = await tempRoot();
    await mkdir(join(root, '.system', 'skill-manager'), { recursive: true });
    await writeFile(manifestPath(root), '{ not json', 'utf8');

    await expect(makeService(root).uninstall({ id: 'find-skills', confirm: true })).rejects.toMatchObject({
      code: 'manifest-corruption',
    });
  });

  it('maps a manifest-load permission failure to a typed filesystem error', async () => {
    const root = await tempRoot();
    await installSkill(root, 'find-skills');

    class LoadFailingStore extends ManifestStore {
      override async load(): Promise<ManifestLoadResult> {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }
    }

    const service = makeService(root, { store: new LoadFailingStore(root) });
    await expect(service.uninstall({ id: 'find-skills', confirm: true })).rejects.toMatchObject({
      code: 'filesystem-permission',
    });
  });

  it('requires removal confirmation even with no drift', async () => {
    const root = await tempRoot();
    await installSkill(root, 'find-skills');

    await expect(makeService(root).uninstall({ id: 'find-skills' })).rejects.toMatchObject({
      code: 'confirmation-required',
    });
    expect(await exists(join(root, 'find-skills'))).toBe(true);
  });

  it('detects local drift and refuses to discard without explicit consent', async () => {
    const root = await tempRoot();
    await installSkill(root, 'find-skills');
    await writeFile(join(root, 'find-skills', 'SKILL.md'), '---\nname: find-skills\n---\n# edited locally\n');

    await expect(makeService(root).uninstall({ id: 'find-skills', confirm: true })).rejects.toMatchObject({
      code: 'local-modification-conflict',
    });
    // Protected: nothing was removed.
    expect(await exists(join(root, 'find-skills'))).toBe(true);
    const load = await new ManifestStore(root).load();
    expect(load.manifest.skills).toHaveProperty('find-skills');
  });

  it('removes locally drifted content only with discard + removal confirmation', async () => {
    const root = await tempRoot();
    await installSkill(root, 'find-skills');
    await writeFile(join(root, 'find-skills', 'SKILL.md'), '---\nname: find-skills\n---\n# edited locally\n');

    await makeService(root).uninstall({ id: 'find-skills', confirm: true, discardLocalChanges: true });

    expect(await exists(join(root, 'find-skills'))).toBe(false);
    const load = await new ManifestStore(root).load();
    expect(load.manifest.skills).not.toHaveProperty('find-skills');
  });

  it('refuses an invalid / out-of-root skill name', async () => {
    const root = await tempRoot();
    const service = makeService(root);

    await expect(service.uninstall({ id: '../escape', confirm: true })).rejects.toMatchObject({
      code: 'invalid-skill-name',
    });
    await expect(service.uninstall({ id: 'C:\\evil', confirm: true })).rejects.toMatchObject({
      code: 'invalid-skill-name',
    });
    await expect(service.uninstall({ id: 'a/b', confirm: true })).rejects.toMatchObject({
      code: 'invalid-skill-name',
    });
  });

  it('refuses a non-string id', async () => {
    const root = await tempRoot();
    await expect(
      makeService(root).uninstall({ id: 123 as unknown as string, confirm: true }),
    ).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('reports delete failure as a typed filesystem error and leaves the manifest entry intact', async () => {
    const root = await tempRoot();
    await installSkill(root, 'find-skills');

    class FailingSkillRoot extends SkillRoot {
      override async removeSkillDir(name: string): Promise<void> {
        throw new PathSafetyError('filesystem-permission', 'delete denied', this.skillDir(name));
      }
    }

    const service = makeService(root, { root: new FailingSkillRoot(root) });
    await expect(service.uninstall({ id: 'find-skills', confirm: true })).rejects.toMatchObject({
      code: 'filesystem-permission',
    });

    // Ordering: delete failed, so the manifest entry must remain (recoverable).
    expect(await exists(join(root, 'find-skills'))).toBe(true);
    const load = await new ManifestStore(root).load();
    expect(load.manifest.skills).toHaveProperty('find-skills');
  });

  it('reports manifest-cleanup failure as uninstall-partial-failure after the dir is gone', async () => {
    const root = await tempRoot();
    await installSkill(root, 'find-skills');

    class FailingManifestStore extends ManifestStore {
      override async save(_manifest: SkillManifest): Promise<void> {
        throw new Error('simulated manifest write failure');
      }
    }

    const service = makeService(root, { store: new FailingManifestStore(root) });
    await expect(service.uninstall({ id: 'find-skills', confirm: true })).rejects.toMatchObject({
      code: 'uninstall-partial-failure',
    });

    // Dir is gone; the on-disk manifest still records the entry, so the next
    // load reconciles it away (recovery semantics).
    expect(await exists(join(root, 'find-skills'))).toBe(false);
    const onDisk = JSON.parse(await readFile(manifestPath(root), 'utf8')) as SkillManifest;
    expect(onDisk.skills).toHaveProperty('find-skills');
    const load = await new ManifestStore(root).load();
    expect(load.dropped).toContain('find-skills');
  });

  it('removes the manifest entry but never writes to the skill directory', async () => {
    const root = await tempRoot();
    await installSkill(root, 'find-skills');

    await makeService(root).uninstall({ id: 'find-skills', confirm: true });

    const manifest = JSON.parse(await readFile(manifestPath(root), 'utf8')) as SkillManifest;
    expect(manifest.skills).toEqual({});
  });

  it.skipIf(!JUNCTION_SUPPORTED)('refuses a managed skill whose directory is a junction (escape surface)', async () => {
    const root = await tempRoot();
    const outside = await mkdtemp(join(tmpdir(), 'sm-uninstall-out-'));
    roots.push(outside);
    const victim = join(outside, 'victim.txt');
    await writeFile(victim, 'precious');
    await writeManifest(root, [makeEntry('evil', localContentHash(SNAPSHOT))]);
    await symlink(outside, join(root, 'evil'), 'junction');

    await expect(makeService(root).uninstall({ id: 'evil', confirm: true })).rejects.toMatchObject({
      code: 'symlink-escape',
    });

    // Nothing was touched: the junction remains, the outside victim is intact,
    // and the on-disk manifest still records the entry (refused before any save).
    expect(await exists(join(root, 'evil'))).toBe(true);
    expect(await exists(victim)).toBe(true);
    const onDisk = JSON.parse(await readFile(manifestPath(root), 'utf8')) as SkillManifest;
    expect(onDisk.skills).toHaveProperty('evil');
  });

  it.skipIf(!JUNCTION_SUPPORTED)('a confirmed uninstall of a skill with an interior junction never follows it', async () => {
    const root = await tempRoot();
    const outside = await mkdtemp(join(tmpdir(), 'sm-uninstall-out-'));
    roots.push(outside);
    const victim = join(outside, 'victim.txt');
    await writeFile(victim, 'precious');
    await installSkill(root, 'with-link');
    await symlink(outside, join(root, 'with-link', 'link'), 'junction');

    // Interior junction = drift; discard confirmation is required.
    await expect(makeService(root).uninstall({ id: 'with-link', confirm: true })).rejects.toMatchObject({
      code: 'local-modification-conflict',
    });
    await makeService(root).uninstall({ id: 'with-link', confirm: true, discardLocalChanges: true });

    expect(await exists(join(root, 'with-link'))).toBe(false);
    expect(await exists(victim)).toBe(true); // the junction target survived
  });
});
