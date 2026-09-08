// Typed DTOs and the public contract for the SkillsShClient adapter. This is
// the ONLY code that knows skills.sh endpoint shapes (ADR-0003): application
// and UI code depend on these types, never on raw response JSON.

/** How a skill originates on skills.sh; drives installability downstream. */
export type SourceKind = 'github' | 'well-known';

/** One normalized search result. */
export interface SkillSearchResult {
  /** Full skills.sh id: `owner/repo/slug`. */
  id: string;
  /** The kebab-case slug (skills.sh `skillId`); the DSH "skill name". */
  skillId: string;
  /** Display name as skills.sh reports it. */
  name: string;
  /** Where the skill originates: GitHub `owner/repo` or a well-known domain. */
  source: string;
  /** Install count reported by skills.sh. */
  installs: number;
  /** Link to the skill's skills.sh page. */
  pageUrl: string;
  /** Whether the source is a GitHub `owner/repo` (installable) vs well-known. */
  installable: boolean;
  /** The source classification backing {@link installable}. */
  sourceKind: SourceKind;
}

/** One file inside a download snapshot. */
export interface SkillFile {
  /** `/`-separated path relative to the skill root. */
  path: string;
  /** UTF-8 file contents. */
  contents: string;
}

/** `SKILL.md` YAML frontmatter fields the plugin consumes. */
export interface SkillMetadata {
  name?: string;
  description?: string;
}

/** A validated download snapshot (GitHub sources only). */
export interface SkillSnapshot {
  /** The full id (`owner/repo/slug`) the snapshot was fetched for. */
  id: string;
  /** Opaque upstream fingerprint; never recomputed nor compared to localContentHash. */
  remoteSourceHash: string;
  /** Snapshot files in server order. */
  files: SkillFile[];
  /** Parsed `SKILL.md` frontmatter (empty when the snapshot has none). */
  metadata: SkillMetadata;
}

/** Options common to every request. */
export interface RequestOptions {
  /** Cancels the request; a cancelled request rejects with code `cancelled`. */
  signal?: AbortSignal;
}

/** Options for {@link SkillsShClient.search}. */
export interface SearchOptions extends RequestOptions {
  /** Server `limit` (max results). */
  limit?: number;
  /** Restrict to one GitHub owner (server `owner` param). */
  owner?: string;
}

/** The adapter contract — the seam application/UI code depends on. */
export interface SkillsShClient {
  /**
   * Search skills.sh. Queries shorter than the minimum length resolve to an
   * empty array without a network call. Never eagerly downloads snapshots.
   */
  search(query: string, options?: SearchOptions): Promise<SkillSearchResult[]>;

  /** Fetch and validate a GitHub snapshot; never touches the filesystem. */
  getSnapshot(id: string, options?: RequestOptions): Promise<SkillSnapshot>;

  /** Lazy description hydration for one result; `null` when the skill has no description. */
  getDescription(id: string, options?: RequestOptions): Promise<string | null>;
}
