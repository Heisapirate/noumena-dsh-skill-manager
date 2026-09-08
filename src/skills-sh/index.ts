// Public surface of the SkillsShClient adapter. Application/UI code imports
// only from here — never from the modules that know endpoint shapes.

export { SkillsShHttpClient, createSkillsShClient } from './client';
export type { SkillsShClientOptions } from './client';
export { classifySource, slugFromId, splitDownloadId, toPageUrl, SKILLS_SH_BASE_URL } from './domain';
export type { DownloadId } from './domain';
export { isSkillsShError, parseRetryAfter, SkillsShError, cancelledError } from './errors';
export type { SkillsShErrorCode, SkillsShErrorOptions } from './errors';
export { extractFrontmatterMetadata } from './frontmatter';
export type {
  RequestOptions,
  SearchOptions,
  SkillFile,
  SkillMetadata,
  SkillSearchResult,
  SkillSnapshot,
  SkillsShClient,
  SourceKind,
} from './types';
export { validateSearchResponse, validateSnapshotResponse } from './validation';
