// Manifest load/save/reconciliation (ADR-0002, spec §6/§7/§12).

import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  emptyManifest,
  MANIFEST_SCHEMA_VERSION,
  manifestPath,
  SYSTEM_DIRECTORY_NAME,
  type LocalContentHash,
  type RemoteSourceHash,
  type SkillManifest,
  type SkillManifestEntry,
} from './types';

/** Why a manifest was treated as corrupt. */
export type ManifestCorruptionReason = 'malformed-json' | 'invalid-structure' | 'unsupported-version';

/** A non-crashing signal that the on-disk manifest could not be trusted. */
export interface ManifestCorruption {
  reason: ManifestCorruptionReason;
  detail: string;
}

export type ManifestLoadStatus = 'ok' | 'missing' | 'corrupt';

/** Result of reconciling a manifest against the skill directories on disk. */
export interface ReconcileResult {
  /** The manifest with entries whose directory is missing removed. */
  manifest: SkillManifest;
  /** Slugs of entries that were dropped because their directory is missing. */
  dropped: string[];
  /** Slugs of on-disk directories that have no manifest entry (foreign). */
  foreign: string[];
}

/** Result of loading + reconciling the manifest. */
export interface ManifestLoadResult extends ReconcileResult {
  status: ManifestLoadStatus;
  /** Present only when `status === 'corrupt'`. */
  corruption?: ManifestCorruption;
}

function corrupt(reason: ManifestCorruptionReason, detail: string): ManifestCorruption {
  return { reason, detail };
}

/**
 * Reconcile a parsed manifest against the skill directories present on disk.
 * A manifest entry whose directory is missing is dropped as already-uninstalled;
 * a directory with no manifest entry is foreign and is left alone. The caller
 * supplies `onDiskSlugs` already excluding the reserved `.system` directory.
 */
export function reconcile(manifest: SkillManifest, onDiskSlugs: readonly string[]): ReconcileResult {
  const onDisk = new Set(onDiskSlugs);
  const surviving = Object.entries(manifest.skills)
    .filter(([slug]) => onDisk.has(slug))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dropped = Object.keys(manifest.skills)
    .filter((slug) => !onDisk.has(slug))
    .sort();
  const foreign = [...onDisk].filter((slug) => !Object.hasOwn(manifest.skills, slug)).sort();

  return {
    manifest: { version: manifest.version, skills: Object.fromEntries(surviving) },
    dropped,
    foreign,
  };
}

/** Directories directly under the skills root, excluding the reserved `.system`. */
async function listSkillDirectories(skillsRoot: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== SYSTEM_DIRECTORY_NAME)
    .map((entry) => entry.name)
    .sort();
}

type ParseResult =
  | { status: 'ok'; manifest: SkillManifest }
  | { status: 'corrupt'; corruption: ManifestCorruption };

function parseEntry(slug: string, value: unknown): SkillManifestEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  if (
    typeof e.source !== 'string' ||
    typeof e.slug !== 'string' ||
    typeof e.remoteSourceHash !== 'string' ||
    typeof e.localContentHash !== 'string' ||
    typeof e.installedAt !== 'string' ||
    typeof e.updatedAt !== 'string'
  ) {
    return null;
  }
  if (e.slug !== slug) return null;
  return {
    source: e.source,
    slug: e.slug,
    remoteSourceHash: e.remoteSourceHash as RemoteSourceHash,
    localContentHash: e.localContentHash as LocalContentHash,
    installedAt: e.installedAt,
    updatedAt: e.updatedAt,
  };
}

function parseManifest(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unparseable JSON';
    return { status: 'corrupt', corruption: corrupt('malformed-json', detail) };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { status: 'corrupt', corruption: corrupt('invalid-structure', 'manifest root must be an object') };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== MANIFEST_SCHEMA_VERSION) {
    return {
      status: 'corrupt',
      corruption: corrupt('unsupported-version', `unsupported manifest version: ${String(obj.version)}`),
    };
  }
  const skills = obj.skills;
  if (typeof skills !== 'object' || skills === null || Array.isArray(skills)) {
    return {
      status: 'corrupt',
      corruption: corrupt('invalid-structure', 'manifest "skills" must be an object keyed by slug'),
    };
  }

  const parsed: Record<string, SkillManifestEntry> = {};
  for (const [slug, value] of Object.entries(skills)) {
    const entry = parseEntry(slug, value);
    if (entry === null) {
      return {
        status: 'corrupt',
        corruption: corrupt('invalid-structure', `invalid manifest entry for slug "${slug}"`),
      };
    }
    parsed[slug] = entry;
  }
  return { status: 'ok', manifest: { version: MANIFEST_SCHEMA_VERSION, skills: parsed } };
}

/** Serialize a manifest to a canonical, deterministic JSON document. */
function serializeManifest(manifest: SkillManifest): string {
  const skills: Record<string, unknown> = {};
  for (const slug of Object.keys(manifest.skills).sort()) {
    const entry = manifest.skills[slug];
    skills[slug] = {
      source: entry.source,
      slug: entry.slug,
      remoteSourceHash: entry.remoteSourceHash,
      localContentHash: entry.localContentHash,
      installedAt: entry.installedAt,
      updatedAt: entry.updatedAt,
    };
  }
  return `${JSON.stringify({ version: manifest.version, skills }, null, 2)}\n`;
}

/**
 * Load, parse, and reconcile the plugin-owned manifest under a skills root
 * (`$DSH_HOME/skills`). A missing manifest yields an empty one; a corrupt or
 * unsupported manifest yields an empty one plus a corruption signal — never a
 * throw. Manifest/filesystem drift is reconciled here: missing local dirs drop
 * their entries, and on-disk dirs without an entry are reported as foreign.
 */
export class ManifestStore {
  private readonly skillsRoot: string;
  /** Absolute path of the manifest file this store reads and writes. */
  private readonly path: string;

  constructor(skillsRoot: string) {
    this.skillsRoot = skillsRoot;
    this.path = manifestPath(skillsRoot);
  }

  async load(): Promise<ManifestLoadResult> {
    const onDisk = await listSkillDirectories(this.skillsRoot);

    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { status: 'missing', ...reconcile(emptyManifest(), onDisk) };
      }
      throw err;
    }

    const parsed = parseManifest(text);
    if (parsed.status === 'corrupt') {
      return { status: 'corrupt', ...reconcile(emptyManifest(), onDisk), corruption: parsed.corruption };
    }
    return { status: 'ok', ...reconcile(parsed.manifest, onDisk) };
  }

  /**
   * Atomically persist the manifest: serialize to a sibling temp file and rename
   * it over the target, serialized across processes with a writer lock. The
   * caller supplies a complete, well-formed manifest (the store does not perform
   * read-modify-write; the transactions in later tickets compose load + save).
   */
  async save(manifest: SkillManifest): Promise<void> {
    for (const [key, entry] of Object.entries(manifest.skills)) {
      if (entry.slug !== key) {
        throw new Error(`refusing to persist manifest: entry slug "${entry.slug}" does not match its key "${key}"`);
      }
    }
    const json = serializeManifest(manifest);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await withFileLock(this.path, () => writeFileAtomic(this.path, json, { mode: 0o600, dirMode: 0o700 }));
  }
}
