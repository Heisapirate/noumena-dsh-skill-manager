// The host half of the skill manager: the business-logic service behind the
// `/skill-manager` RPC channel. It owns the security boundary for networking,
// filesystem, manifest, hashing, path validation, and mutations. Issue #14 adds
// the install transaction; Issue #16 adds update detection + the update
// transaction; Issue #17 adds the uninstall transaction (production spec §11).
// All three compose the same manifest (#10) and safe-path (#11) primitives.

import { SkillManagerError, toFilesystemError } from './errors';
import { installSkill, type InstallDeps } from './install';
import { computeLocalContentHash } from './manifest/read';
import { ManifestStore } from './manifest/store';
import type { ManifestLoadResult } from './manifest/store';
import type { LocalContentHash, SkillManifest } from './manifest/types';
import { PLUGIN_NAME } from './meta';
import { PathSafetyError, SkillRoot } from './path-safety';
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

  /**
   * Uninstall a plugin-managed skill (spec §11). Only a manifest-recorded skill
   * is removable (foreign → refuse); local drift and the removal itself are each
   * confirmation-gated; the directory is deleted first and the manifest entry is
   * removed second, so any interruption is recovered by reconcile-on-load.
   */
  async uninstall(input: UninstallRequest): Promise<UninstallResult> {
    if (typeof input?.id !== 'string') {
      throw new SkillManagerError('invalid-request', 'uninstall requires a string "id"', {});
    }
    const { id } = input;
    const root = this.deps.root;
    const store = this.deps.store;

    // 1. Validate the skill name and resolve the target strictly inside the root.
    const skillDir = root.skillDir(id);

    // 2. Load + reconcile the manifest; refuse when it cannot be trusted.
    const load = await this.loadManifest();
    if (load.status === 'corrupt') {
      throw new SkillManagerError(
        'manifest-corruption',
        `cannot uninstall: the manifest is corrupt (${load.corruption?.reason ?? 'unknown'})`,
        { reason: load.corruption?.reason },
      );
    }

    // 3. Managed-only enforcement + missing-state classification.
    const entry = load.manifest.skills[id];
    if (!entry) {
      if (load.dropped.includes(id)) {
        // Entry present, directory missing. If a symlink/junction (or anything
        // else) occupies the slug path it is an escape surface / foreign
        // content — refuse rather than silently dropping the entry. Genuinely
        // missing ⇒ already uninstalled: persist the reconciled manifest and
        // succeed idempotently.
        const kind = await root.classifySkill(id);
        if (kind === 'symlink') {
          throw new PathSafetyError(
            'symlink-escape',
            `skill "${id}" is a symlink/junction, not a managed directory`,
            skillDir,
          );
        }
        if (kind !== 'missing') {
          throw new SkillManagerError('foreign-skill', `"${id}" is not a managed skill directory`, { id });
        }
        await this.persistManifest(
          load.manifest,
          `skill "${id}" is already uninstalled but its manifest entry could not be removed`,
        );
        return { ok: true };
      }

      // Not recorded in the manifest at all: refuse, whether the path exists
      // (foreign) or not (unknown).
      const kind = await root.classifySkill(id);
      if (kind !== 'missing') {
        throw new SkillManagerError(
          'foreign-skill',
          `skill "${id}" is not managed by this plugin and will not be removed`,
          { id },
        );
      }
      throw new SkillManagerError('skill-not-found', `skill "${id}" is not installed`, { id });
    }

    // 4. Local-drift confirmation (spec §11(2)): never silently destroy content.
    const drifted = await this.hasLocalDrift(id, entry.localContentHash);
    if (drifted && input.discardLocalChanges !== true) {
      throw new SkillManagerError(
        'local-modification-conflict',
        `skill "${id}" has local changes that will be discarded`,
        { id },
      );
    }

    // 5. Removal confirmation (spec §11(3)).
    if (input.confirm !== true) {
      throw new SkillManagerError('confirmation-required', `confirm removal of skill "${id}"`, { id });
    }

    // 6. Delete the directory first, then remove the manifest entry atomically.
    //    If the directory delete fails the entry stays (no ambiguity); if the
    //    manifest save fails the entry is dropped by reconcile on next load.
    await root.removeSkillDir(id);
    await this.persistManifest(
      this.withoutEntry(load.manifest, id),
      'removed the skill directory but failed to update the manifest',
    );
    return { ok: true };
  }

  /** Recompute the local-content hash and compare to the recorded value. */
  private async hasLocalDrift(id: string, recorded: LocalContentHash): Promise<boolean> {
    const kind = await this.deps.root.classifySkill(id);
    // Vanished between load and drift check: nothing left to protect.
    if (kind === 'missing') return false;
    // Replaced by a symlink/junction (or a plain file) → local modification.
    if (kind !== 'directory') return true;
    return (await computeLocalContentHash(this.deps.root.skillDir(id))) !== recorded;
  }

  private async loadManifest(): Promise<ManifestLoadResult> {
    try {
      return await this.deps.store.load();
    } catch (err) {
      throw toFilesystemError(err, this.deps.root.path);
    }
  }

  private async persistManifest(manifest: SkillManifest, failureMessage: string): Promise<void> {
    try {
      await this.deps.store.save(manifest);
    } catch (err) {
      throw new SkillManagerError('uninstall-partial-failure', failureMessage, {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private withoutEntry(manifest: SkillManifest, id: string): SkillManifest {
    const skills = { ...manifest.skills };
    delete skills[id];
    return { version: manifest.version, skills };
  }
}
