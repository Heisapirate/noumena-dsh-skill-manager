// The host half of the skill manager: the business-logic service behind the
// `/skill-manager` RPC channel. Issue #17 adds the uninstall transaction
// (production spec §11), built on the manifest ownership model (#10) and the
// safe-path boundary (#11). It reuses those primitives rather than duplicating
// their containment, ownership, or errno-mapping rules.

import { SkillManagerError, toFilesystemError } from './errors';
import { computeLocalContentHash } from './manifest/read';
import { ManifestStore } from './manifest/store';
import type { ManifestLoadResult } from './manifest/store';
import type { LocalContentHash, SkillManifest } from './manifest/types';
import { PLUGIN_NAME } from './meta';
import { PathSafetyError, SkillRoot } from './path-safety';
import type { HealthInfo, UninstallRequest, UninstallResult } from './types';

export interface SkillManagerServiceOptions {
  version: string;
  /** Absolute path of the DSH user skills root (`$DSH_HOME/skills`). */
  skillsRoot: string;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Test seam: the safe-path boundary. Defaults to a `SkillRoot` over `skillsRoot`. */
  skillRoot?: SkillRoot;
  /** Test seam: the manifest store. Defaults to a `ManifestStore` over `skillsRoot`. */
  manifestStore?: ManifestStore;
}

export class SkillManagerService {
  private readonly version: string;
  private readonly now: () => number;
  private readonly skillRoot: SkillRoot;
  private readonly manifestStore: ManifestStore;

  constructor(options: SkillManagerServiceOptions) {
    this.version = options.version;
    this.now = options.now ?? Date.now;
    this.skillRoot = options.skillRoot ?? new SkillRoot(options.skillsRoot);
    this.manifestStore = options.manifestStore ?? new ManifestStore(options.skillsRoot);
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

    // 1. Validate the skill name and resolve the target strictly inside the root.
    const skillDir = this.skillRoot.skillDir(id);

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
        const kind = await this.skillRoot.classifySkill(id);
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
      const kind = await this.skillRoot.classifySkill(id);
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
    await this.skillRoot.removeSkillDir(id);
    await this.persistManifest(
      this.withoutEntry(load.manifest, id),
      'removed the skill directory but failed to update the manifest',
    );
    return { ok: true };
  }

  /** Recompute the local-content hash and compare to the recorded value. */
  private async hasLocalDrift(id: string, recorded: LocalContentHash): Promise<boolean> {
    const kind = await this.skillRoot.classifySkill(id);
    // Vanished between load and drift check: nothing left to protect.
    if (kind === 'missing') return false;
    // Replaced by a symlink/junction (or a plain file) → local modification.
    if (kind !== 'directory') return true;
    return (await computeLocalContentHash(this.skillRoot.skillDir(id))) !== recorded;
  }

  private async loadManifest(): Promise<ManifestLoadResult> {
    try {
      return await this.manifestStore.load();
    } catch (err) {
      throw toFilesystemError(err, this.skillRoot.path);
    }
  }

  private async persistManifest(manifest: SkillManifest, failureMessage: string): Promise<void> {
    try {
      await this.manifestStore.save(manifest);
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
