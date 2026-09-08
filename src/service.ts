import { PLUGIN_NAME } from './meta';
import type { HealthInfo } from './types';

export interface SkillManagerServiceOptions {
  version: string;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * The host half of the skill manager. This is the future security boundary for
 * networking, filesystem, manifest, hashing, path validation, and mutations —
 * none of which exist yet in the Issue #9 foundation. Those endpoints land in
 * later tickets; today the service answers only a typed health/status probe.
 */
export class SkillManagerService {
  private readonly version: string;
  private readonly now: () => number;

  constructor(options: SkillManagerServiceOptions) {
    this.version = options.version;
    this.now = options.now ?? Date.now;
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
}
