import { installSkill } from './install';
import { ManifestStore } from './manifest/store';
import { PLUGIN_NAME } from './meta';
import { SkillRoot } from './path-safety';
import type { SkillsShClient } from './skills-sh';
import type { HealthInfo, InstallRequest, InstallResult } from './types';

export interface SkillManagerServiceOptions {
  version: string;
  /** The DSH user skills root (`$DSH_HOME/skills`); the only directory mutated. */
  skillsRoot: string;
  /** The skills.sh adapter that owns snapshot retrieval and its typed errors. */
  client: SkillsShClient;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * The host half of the skill manager. It owns the security boundary for
 * networking, filesystem, manifest, hashing, path validation, and mutations.
 * Issue #14 adds the install transaction; update/uninstall/list land later.
 */
export class SkillManagerService {
  private readonly version: string;
  private readonly now: () => number;
  private readonly root: SkillRoot;
  private readonly store: ManifestStore;
  private readonly client: SkillsShClient;

  constructor(options: SkillManagerServiceOptions) {
    this.version = options.version;
    this.now = options.now ?? Date.now;
    this.root = new SkillRoot(options.skillsRoot);
    this.store = new ManifestStore(options.skillsRoot);
    this.client = options.client;
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

  /** Install one GitHub-backed skill as an atomic transaction (Issue #14). */
  install(request: InstallRequest, signal?: AbortSignal): Promise<InstallResult> {
    return installSkill(
      { client: this.client, root: this.root, store: this.store, now: this.now },
      request,
      signal,
    );
  }
}
