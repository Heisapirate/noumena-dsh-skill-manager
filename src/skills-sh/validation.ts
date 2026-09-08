// Strict response validation for the skills.sh compatibility endpoints. Any
// shape deviation raises a typed `malformed-response` error ("registry
// changed"), never a crash and never a silently-wrong result.

import { classifySource, slugFromId, toPageUrl } from './domain';
import { SkillsShError } from './errors';
import { extractFrontmatterMetadata } from './frontmatter';
import type { SkillFile, SkillMetadata, SkillSearchResult, SkillSnapshot } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(message: string): SkillsShError {
  return new SkillsShError('malformed-response', message);
}

function requireNonEmptyString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw malformed(`expected ${what} to be a non-empty string`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed(`expected ${what} to be a finite number`);
  }
  return value;
}

/** Validate the `/api/search` compatibility payload into typed results. */
export function validateSearchResponse(body: unknown): SkillSearchResult[] {
  if (!isRecord(body) || !Array.isArray(body.skills)) {
    throw malformed('search response is missing a `skills` array');
  }
  return body.skills.map((entry, index) => {
    const where = `skills[${index}]`;
    if (!isRecord(entry)) throw malformed(`expected ${where} to be an object`);
    const id = requireNonEmptyString(entry.id, `${where}.id`);
    const source = requireNonEmptyString(entry.source, `${where}.source`);
    const name = requireNonEmptyString(entry.name, `${where}.name`);
    const installs = requireFiniteNumber(entry.installs, `${where}.installs`);
    // `skillId` is derived from `id` when absent, so a missing slug never breaks search.
    const skillId =
      entry.skillId != null ? requireNonEmptyString(entry.skillId, `${where}.skillId`) : slugFromId(id);
    const sourceKind = classifySource(source);
    return {
      id,
      skillId,
      name,
      source,
      installs,
      pageUrl: toPageUrl(id),
      installable: sourceKind === 'github',
      sourceKind,
    };
  });
}

/** Validate the `/api/download` compatibility payload into a typed snapshot. */
export function validateSnapshotResponse(id: string, body: unknown): SkillSnapshot {
  if (!isRecord(body) || !Array.isArray(body.files)) {
    throw malformed('snapshot response is missing a `files` array');
  }
  const files: SkillFile[] = body.files.map((entry, index) => {
    const where = `files[${index}]`;
    if (!isRecord(entry)) throw malformed(`expected ${where} to be an object`);
    const path = requireNonEmptyString(entry.path, `${where}.path`);
    if (typeof entry.contents !== 'string') {
      throw malformed(`expected ${where}.contents to be a string`);
    }
    return { path, contents: entry.contents };
  });
  const remoteSourceHash = requireNonEmptyString(body.hash, 'snapshot `hash`');
  return { id, remoteSourceHash, files, metadata: extractMetadata(files) };
}

/** Find the `SKILL.md` file and parse its frontmatter (empty when absent). */
function extractMetadata(files: SkillFile[]): SkillMetadata {
  const skillMd = files.find((file) => file.path === 'SKILL.md');
  return skillMd ? extractFrontmatterMetadata(skillMd.contents) : {};
}
