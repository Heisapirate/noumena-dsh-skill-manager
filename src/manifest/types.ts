// Typed domain model for the plugin-owned Manifest (ADR-0002, spec §6).
// This is pure host logic: it has no dependency on the UI or the RPC layer.

import { join } from 'node:path';

/** The single manifest schema version. A manifest with any other version is corrupt. */
export const MANIFEST_SCHEMA_VERSION = 1 as const;
export type ManifestSchemaVersion = typeof MANIFEST_SCHEMA_VERSION;

/** Reserved metadata directory under the skills root (skipped by DSH discovery). */
export const SYSTEM_DIRECTORY_NAME = '.system';
/** Directory holding the plugin's own metadata under `.system`. */
export const MANIFEST_DIRECTORY_NAME = 'skill-manager';
export const MANIFEST_FILE_NAME = 'manifest.json';

/** Path of the manifest relative to the skills root (`$DSH_HOME/skills`). */
export const MANIFEST_RELATIVE_PATH = `${SYSTEM_DIRECTORY_NAME}/${MANIFEST_DIRECTORY_NAME}/${MANIFEST_FILE_NAME}`;

/**
 * The two hashes are deliberately distinct nominal types. `remoteSourceHash` is
 * the opaque upstream fingerprint returned by skills.sh and is never recomputed
 * locally; `localContentHash` is the plugin-computed deterministic SHA-256 over
 * installed files. They must never be assigned to one another or compared as
 * equivalent (spec §7); the brands make accidental cross-assignment a type error.
 */
declare const remoteSourceHashBrand: unique symbol;
/** Opaque upstream skills.sh fingerprint. Never recomputed locally. */
export type RemoteSourceHash = string & { readonly [remoteSourceHashBrand]: 'remoteSourceHash' };

declare const localContentHashBrand: unique symbol;
/** Plugin-computed deterministic SHA-256 hex over a skill's installed files. */
export type LocalContentHash = string & { readonly [localContentHashBrand]: 'localContentHash' };

/** One file in a skill snapshot, as the skills.sh download endpoint reports it. */
export interface SkillFile {
  /** Relative path within the skill directory. */
  path: string;
  /** File contents. */
  contents: string;
}

/**
 * One plugin-managed skill's provenance record. `slug` must equal its key in
 * {@link SkillManifest.skills}; both are recorded for downstream convenience.
 */
export interface SkillManifestEntry {
  /** Upstream origin as skills.sh reports it (GitHub `owner/repo`). */
  source: string;
  /** The kebab-case skill name that keys the entry. */
  slug: string;
  remoteSourceHash: RemoteSourceHash;
  localContentHash: LocalContentHash;
  /** ISO-8601 timestamp of the original install. */
  installedAt: string;
  /** ISO-8601 timestamp of the most recent install/update. */
  updatedAt: string;
}

/**
 * The plugin-owned provenance record. The `version` field is the schema version
 * used to gate future migrations; `skills` maps slug → entry.
 */
export interface SkillManifest {
  version: ManifestSchemaVersion;
  skills: Record<string, SkillManifestEntry>;
}

/** Absolute path of the manifest file for a given skills root (`$DSH_HOME/skills`). */
export function manifestPath(skillsRoot: string): string {
  return join(skillsRoot, SYSTEM_DIRECTORY_NAME, MANIFEST_DIRECTORY_NAME, MANIFEST_FILE_NAME);
}

/** A fresh, empty manifest at the current schema version. */
export function emptyManifest(): SkillManifest {
  return { version: MANIFEST_SCHEMA_VERSION, skills: {} };
}
