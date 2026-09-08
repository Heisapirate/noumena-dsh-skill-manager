import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { localContentHash } from '../../src/manifest';
import { ManifestStore } from '../../src/manifest';
import type {
  LocalContentHash,
  RemoteSourceHash,
  SkillFile,
  SkillManifestEntry,
} from '../../src/manifest';
import {
  SkillsShError,
  type SkillsShErrorCode,
  type SkillsShClient,
  type SkillSearchResult,
  type SkillSnapshot,
} from '../../src/skills-sh';

export const remote = (s: string): RemoteSourceHash => s as RemoteSourceHash;
export const local = (s: string): LocalContentHash => s as LocalContentHash;

export const SKILL_MD = '---\nname: find-skills\ndescription: "Find skills on skills.sh"\n---\n# Find skills\n';

/** A minimal valid snapshot: SKILL.md (valid frontmatter) plus one extra file. */
export function snapshot(
  id: string,
  hash: string,
  files: SkillFile[] = [
    { path: 'SKILL.md', contents: SKILL_MD },
    { path: 'README.md', contents: '# Readme\n' },
  ],
): SkillSnapshot {
  return { id, remoteSourceHash: hash, files, metadata: {} };
}

export function makeEntry(
  slug: string,
  overrides: Partial<SkillManifestEntry> = {},
): SkillManifestEntry {
  return {
    source: 'owner/repo',
    slug,
    remoteSourceHash: remote('opaque-v1'),
    localContentHash: local('a'.repeat(64)),
    installedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Fake of the skills.sh adapter: programmable snapshot + typed failure per id. */
export class FakeSkillsShClient implements SkillsShClient {
  private readonly snapshots = new Map<string, SkillSnapshot>();
  private readonly errors = new Map<string, SkillsShError>();
  private defaultError: SkillsShError | null = null;

  setSnapshot(id: string, value: SkillSnapshot): void {
    this.snapshots.set(id, value);
  }

  setError(id: string, code: SkillsShErrorCode, message: string): void {
    this.errors.set(id, new SkillsShError(code, message));
  }

  setDefaultError(err: SkillsShError): void {
    this.defaultError = err;
  }

  async search(): Promise<SkillSearchResult[]> {
    return [];
  }

  async getSnapshot(id: string): Promise<SkillSnapshot> {
    const error = this.errors.get(id);
    if (error) throw error;
    const value = this.snapshots.get(id);
    if (value) return value;
    throw this.defaultError ?? new SkillsShError('source-unavailable', 'snapshot not found', { statusCode: 404 });
  }

  async getDescription(id: string): Promise<string | null> {
    const value = await this.getSnapshot(id);
    return value.metadata.description ?? null;
  }
}

const roots: string[] = [];

/** Create a temp skills root (tracked for teardown). */
export async function tempSkillsRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sm-update-'));
  roots.push(root);
  return root;
}

export async function cleanupRoots(): Promise<void> {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
}

/**
 * Install a skill directly (write files + record a consistent manifest entry).
 * This stands in for the install transaction; update operates only on
 * plugin-managed, manifest-recorded skills.
 */
export async function installSkill(
  root: string,
  slug: string,
  files: SkillFile[] = [
    { path: 'SKILL.md', contents: SKILL_MD },
    { path: 'README.md', contents: '# Readme\n' },
  ],
  opts: { source?: string; remoteSourceHash?: string } = {},
): Promise<SkillManifestEntry> {
  const dir = join(root, slug);
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    const target = join(dir, ...file.path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents, 'utf8');
  }

  const entry = makeEntry(slug, {
    source: opts.source ?? 'owner/repo',
    remoteSourceHash: remote(opts.remoteSourceHash ?? 'opaque-v1'),
    localContentHash: localContentHash(files),
  });
  const store = new ManifestStore(root);
  const loaded = await store.load();
  loaded.manifest.skills[slug] = entry;
  await store.save(loaded.manifest);
  return entry;
}

/** Read a skill file's contents from the installed directory. */
export function readInstalled(root: string, slug: string, relPath: string): Promise<string> {
  return readFile(join(root, slug, ...relPath.split('/')), 'utf8');
}
