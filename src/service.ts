// The host half of the skill manager: the business-logic service behind the
// `/skill-manager` RPC channel. It owns the security boundary for networking,
// filesystem, manifest, hashing, path validation, and mutations, and delegates
// each transaction to its module — install (#14), update (#16), and uninstall
// (#17) — which all compose the same manifest (#10) and safe-path (#11)
// primitives.

import { installSkill, type InstallDeps } from './install';
import { ManifestStore } from './manifest/store';
import { PLUGIN_NAME } from './meta';
import { SkillRoot } from './path-safety';
import type { SkillsShClient } from './skills-sh';
import type {
  CheckUpdatesResult,
  HealthInfo,
  InstallRequest,
  InstallResult,
  UninstallRequest,
  UninstallResult,
  UpdateInput,
  UpdateResult,
} from './types';
import { uninstallSkill } from './uninstall';
import { UpdateManager } from './update';

export interface SkillManagerServiceOptions {
  version: string;
  /** The DSH user skills root (`$DSH_HOME/skills`); the only directory mutated. */
  skillsRoot: string;
  /** The skills.sh adapter that owns snapshot retrieval and its typed errors. */
  client: SkillsShClient;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Path-safety boundary seam (tests override to force publish/delete failure). */
  root?: SkillRoot;
  /** Manifest store seam (tests override to force load/save failure). */
  store?: ManifestStore;
}

export class SkillManagerService {
  private readonly version: string;
  private readonly now: () => number;
  private readonly deps: InstallDeps;
  private readonly updateManager: UpdateManager;

  constructor(options: SkillManagerServiceOptions) {
    this.version = options.version;
    this.now = options.now ?? Date.now;
    const root = options.root ?? new SkillRoot(options.skillsRoot);
    const store = options.store ?? new ManifestStore(options.skillsRoot);
    this.deps = { client: options.client, root, store, now: this.now };
    this.updateManager = new UpdateManager({
      skillsRoot: options.skillsRoot,
      client: options.client,
      now: this.now,
      root,
      store,
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

  /** Install one GitHub-backed skill as an atomic transaction (Issue #14). */
  install(request: InstallRequest, signal?: AbortSignal): Promise<InstallResult> {
    return installSkill(this.deps, request, signal);
  }

  /** Update detection for every plugin-managed skill (Issue #16). */
  checkUpdates(): Promise<CheckUpdatesResult> {
    return this.updateManager.checkUpdates();
  }

  /** Apply the latest upstream snapshot to one skill (Issue #16). */
  update(input: UpdateInput): Promise<UpdateResult> {
    return this.updateManager.update(input);
  }

  /** Remove a plugin-managed skill (Issue #17; destructive, confirmation-gated). */
  uninstall(input: UninstallRequest): Promise<UninstallResult> {
    return uninstallSkill(this.deps.root, this.deps.store, input);
  }
}
