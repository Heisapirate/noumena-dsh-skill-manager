import { PLUGIN_NAME } from './meta';
import { ManifestStore } from './manifest';
import { SkillRoot } from './path-safety';
import { createSkillsShClient } from './skills-sh';
import type { SkillsShClient } from './skills-sh';
import type { CheckUpdatesResult, HealthInfo, UpdateInput, UpdateResult } from './types';
import { resolveSkillsRoot, UpdateManager } from './update';
import type { ManifestStoreLike } from './update';

export interface SkillManagerServiceOptions {
  version: string;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /** `$DSH_HOME/skills`; defaults to the environment-resolved skills root. */
  skillsRoot?: string;
  /** The skills.sh adapter; defaults to the production HTTP client. */
  client?: SkillsShClient;
  /** Path-safety boundary; defaults to `new SkillRoot(skillsRoot)`. */
  root?: SkillRoot;
  /** Manifest store; defaults to `new ManifestStore(skillsRoot)`. */
  store?: ManifestStoreLike;
  /** Swap seam for the update transaction (tests override to force failure). */
  publish?: (root: SkillRoot, slug: string) => Promise<void>;
}

/**
 * The host half of the skill manager. Owns all networking, filesystem,
 * manifest, hashing, and path-validation work. The health probe proves the
 * host is alive; `checkUpdates`/`update` implement Issue #16.
 */
export class SkillManagerService {
  private readonly version: string;
  private readonly now: () => number;
  private readonly updateManager: UpdateManager;

  constructor(options: SkillManagerServiceOptions) {
    this.version = options.version;
    this.now = options.now ?? Date.now;
    const skillsRoot = options.skillsRoot ?? options.root?.path ?? resolveSkillsRoot();
    this.updateManager = new UpdateManager({
      skillsRoot,
      client: options.client ?? createSkillsShClient(),
      now: this.now,
      root: options.root,
      store: options.store ?? new ManifestStore(skillsRoot),
      publish: options.publish,
    });
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

  /** Update detection for every plugin-managed skill (Issue #16). */
  checkUpdates(): Promise<CheckUpdatesResult> {
    return this.updateManager.checkUpdates();
  }

  /** Apply the latest upstream snapshot to one skill (Issue #16). */
  update(input: UpdateInput): Promise<UpdateResult> {
    return this.updateManager.update(input);
  }
}
