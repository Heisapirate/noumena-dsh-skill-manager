import { PLUGIN_NAME } from './meta';
import { createSkillsShClient } from './skills-sh';
import type { SkillsShClient } from './skills-sh';
import type { DescribeResponse, HealthInfo, SearchResponse } from './types';

export interface SkillManagerServiceOptions {
  version: string;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Injectable SkillsShClient; defaults to the production adapter. */
  client?: SkillsShClient;
}

/**
 * The host half of the skill manager — the security boundary that owns all
 * skills.sh networking. The Client never talks to skills.sh directly; it
 * reaches this service through typed `/skill-manager` RPC endpoints. Issue #13
 * adds read-only `search` and `describe`; install/update/uninstall mutations
 * land in later tickets and must never be implemented here.
 */
export class SkillManagerService {
  private readonly version: string;
  private readonly now: () => number;
  private readonly client: SkillsShClient;

  constructor(options: SkillManagerServiceOptions) {
    this.version = options.version;
    this.now = options.now ?? Date.now;
    this.client = options.client ?? createSkillsShClient();
  }

  /** Typed health/status probe proving the host is alive behind the RPC boundary. */
  health(): HealthInfo {
    return {
      ok: true,
      plugin: PLUGIN_NAME,
      version: this.version,
      now: this.now(),
    };
  }

  /**
   * Search skills.sh for normalized basic results. Never downloads snapshots:
   * descriptions are hydrated separately via {@link describe}. Queries shorter
   * than the adapter minimum resolve to an empty result set without a network
   * call. Errors propagate as typed `SkillsShError`s for the RPC layer to map.
   */
  async search(query: string, signal?: AbortSignal): Promise<SearchResponse> {
    const results = await this.client.search(query, { signal });
    return { results, complete: true };
  }

  /**
   * Lazily hydrate one result's description from its snapshot. Returns `null`
   * when the skill has no description; throws a typed error on failure so a
   * single bad row never fails the surrounding search (the client isolates it).
   */
  async describe(id: string, signal?: AbortSignal): Promise<DescribeResponse> {
    const description = await this.client.getDescription(id, { signal });
    return { description };
  }
}
