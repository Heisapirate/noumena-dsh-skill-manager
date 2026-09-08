// The update transaction orchestrator (Issue #16, spec §10). It composes the
// merged foundations — ManifestStore (#10), path safety (#11, including the
// #14 backup-swap primitives), and SkillsShClient (#12) — into two behaviors:
//
//   checkUpdates()  detect upstream change (remoteSourceHash vs recorded
//                   remoteSourceHash) and local drift (recomputed
//                   localContentHash vs recorded localContentHash) per managed
//                   skill, mapping them to the six update states.
//
//   update()        fetch → validate → drift-gate → stage → swap → manifest,
//                   in the spec's accepted order, so local modifications are
//                   never silently overwritten and the manifest is refreshed
//                   only after a successful swap. A manifest-save failure rolls
//                   the swap back, leaving the prior skill intact (matching the
//                   install transaction's guarantee).
//
// Every filesystem mutation goes through the SkillRoot boundary; every failure
// is normalized to a typed code.

import { localContentHash, ManifestStore } from '../manifest';
import type { RemoteSourceHash, SkillManifest, SkillManifestEntry } from '../manifest';
import type { ManifestLoadResult } from '../manifest';
import { assertSkillName, SkillRoot, type SafePath } from '../path-safety';
import { toRpcError } from '../rpc-error';
import { classifySource, splitDownloadId, type SkillsShClient } from '../skills-sh';
import type { SkillSnapshot } from '../skills-sh';
import type { CheckUpdatesResult, UpdateInfo, UpdateInput, UpdateResult } from '../types';
import { UpdateError } from './errors';
import { readDirFiles, readSkillFiles } from './files';
import { assertSnapshotSafe } from './snapshot';
import { buildUpdateInfo } from './status';
import { recoverInterruptedSwap } from './swap';

/** The manifest operations the transaction needs (a ManifestStore satisfies it). */
export interface ManifestStoreLike {
  load(): Promise<ManifestLoadResult>;
  save(manifest: SkillManifest): Promise<void>;
}

export interface UpdateManagerOptions {
  /** `$DSH_HOME/skills` (tests inject a temp directory). */
  skillsRoot: string;
  /** The skills.sh adapter; the only network actor. */
  client: SkillsShClient;
  /** Injectable clock for deterministic timestamps. */
  now?: () => number;
  /** Path-safety boundary (defaults to `new SkillRoot(skillsRoot)`). */
  root?: SkillRoot;
  /** Manifest store (defaults to a `ManifestStore` over `skillsRoot`). */
  store?: ManifestStoreLike;
}

/**
 * Host-side orchestrator for update detection and the update transaction. It
 * composes the merged foundations and is constructed per skills root; the RPC
 * layer delegates `checkUpdates`/`update` to it.
 */
export class UpdateManager {
  private readonly client: SkillsShClient;
  private readonly now: () => number;
  private readonly root: SkillRoot;
  private readonly store: ManifestStoreLike;

  constructor(options: UpdateManagerOptions) {
    this.client = options.client;
    this.now = options.now ?? Date.now;
    this.root = options.root ?? new SkillRoot(options.skillsRoot);
    this.store = options.store ?? new ManifestStore(options.skillsRoot);
  }

  /**
   * Report the update state of every plugin-managed skill that is present on
   * disk. Per-skill remote failures never abort the whole check — they are
   * recorded as `source-unavailable` or `remote-check-failure` on that skill.
   */
  async checkUpdates(): Promise<CheckUpdatesResult> {
    await recoverInterruptedSwap(this.root);
    const { manifest } = await this.store.load();
    const updates: UpdateInfo[] = [];

    for (const [slug, entry] of Object.entries(manifest.skills)) {
      const id = `${entry.source}/${slug}`;

      let currentLocalContentHash: string | null = null;
      try {
        currentLocalContentHash = localContentHash(await readSkillFiles(this.root, slug));
      } catch {
        // Local recompute failed; we cannot assert drift, so it is not reported.
      }

      let latestRemoteSourceHash: string | null = null;
      let remoteError: UpdateInfo['error'];
      try {
        latestRemoteSourceHash = (await this.client.getSnapshot(id)).remoteSourceHash;
      } catch (err) {
        remoteError = toRpcError(err);
      }

      updates.push(
        buildUpdateInfo({
          slug,
          entry,
          latestRemoteSourceHash,
          currentLocalContentHash,
          remoteError,
        }),
      );
    }

    return { updates: updates.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)) };
  }

  /**
   * Apply the latest upstream snapshot to one skill, in the spec's accepted
   * transaction order. Throws a typed error for every refusal/failure path;
   * the RPC layer normalizes it to `{ok:false,error}`.
   */
  async update(input: UpdateInput): Promise<UpdateResult> {
    const id = input.id;
    const parts = splitDownloadId(id);
    const source = parts ? `${parts.owner}/${parts.repo}` : '';
    if (!parts || classifySource(source) !== 'github') {
      throw new UpdateError(
        'source-unavailable',
        `cannot update ${JSON.stringify(id)}: only GitHub owner/repo/slug sources are updatable`,
      );
    }
    assertSkillName(parts.slug);
    const { slug } = parts;

    await recoverInterruptedSwap(this.root);
    const load = await this.store.load();
    if (load.status === 'corrupt') {
      throw new UpdateError(
        'manifest-corruption',
        load.corruption?.detail ?? 'manifest is corrupt',
      );
    }

    const entry = load.manifest.skills[slug];
    if (!entry) {
      throw new UpdateError('skill-not-found', `${JSON.stringify(slug)} is not a plugin-managed skill`);
    }
    if (entry.source !== source) {
      throw new UpdateError(
        'skill-not-found',
        `${JSON.stringify(slug)} was installed from ${JSON.stringify(entry.source)}, not ${JSON.stringify(source)}`,
      );
    }

    // Fetch + validate the latest snapshot before any filesystem mutation.
    const snapshot: SkillSnapshot = await this.client.getSnapshot(id);
    assertSnapshotSafe(this.root, slug, snapshot);

    // Drift gate: never silently overwrite local modifications.
    const currentLocalContentHash = localContentHash(await readSkillFiles(this.root, slug));
    const drifted = currentLocalContentHash !== entry.localContentHash;
    if (drifted && input.discardLocalChanges !== true) {
      throw new UpdateError(
        'local-modification-conflict',
        `${JSON.stringify(slug)} has local modifications; pass discardLocalChanges to overwrite`,
        { slug },
      );
    }

    // Already up to date and unmodified (spec §10 step 2): nothing to stage,
    // swap, or re-record.
    const updateAvailable = snapshot.remoteSourceHash !== entry.remoteSourceHash;
    if (!updateAvailable && !drifted) {
      return {
        slug,
        source: entry.source,
        remoteSourceHash: snapshot.remoteSourceHash,
        localContentHash: entry.localContentHash,
        updatedAt: entry.updatedAt,
        discardedLocalChanges: false,
        applied: false,
      };
    }

    // Stage the replacement inside `.staging/` (path-safety enforced per file).
    let staged: SafePath;
    try {
      await this.root.removeStagingDir(slug);
      staged = await this.root.createStagingDir(slug);
      await this.root.materializeFiles(staged, snapshot.files);
    } catch (err) {
      await this.root.removeStagingDir(slug).catch(() => {});
      throw err;
    }

    // Fresh local-content hash from the bytes actually staged.
    const newLocalContentHash = localContentHash(await readDirFiles(this.root, staged));

    // Swap: preserve the old installation until the new one is in place.
    try {
      await this.root.moveSkillToBackup(slug);
      await this.root.publishStaged(slug);
    } catch (err) {
      await this.root.restoreBackup(slug).catch(() => {});
      await this.root.removeStagingDir(slug).catch(() => {});
      throw err;
    }

    // Manifest update only after a successful swap (spec §10(6)).
    const updated: SkillManifestEntry = {
      ...entry,
      remoteSourceHash: snapshot.remoteSourceHash as RemoteSourceHash,
      localContentHash: newLocalContentHash,
      updatedAt: new Date(this.now()).toISOString(),
    };
    const next: SkillManifest = {
      version: load.manifest.version,
      skills: { ...load.manifest.skills, [slug]: updated },
    };
    try {
      await this.store.save(next);
    } catch (err) {
      // Roll the swap back so the prior usable skill survives (no partial state).
      await this.root.removeSkillDir(slug).catch(() => {});
      await this.root.restoreBackup(slug).catch(() => {});
      await this.root.removeStagingDir(slug).catch(() => {});
      throw new UpdateError(
        'update-partial-failure',
        `skill update failed to record: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Commit: drop the old backup (best-effort; staging was consumed by publish).
    await this.root.removeBackup(slug).catch(() => {});

    return {
      slug,
      source: entry.source,
      remoteSourceHash: snapshot.remoteSourceHash,
      localContentHash: newLocalContentHash,
      updatedAt: updated.updatedAt,
      discardedLocalChanges: drifted,
      applied: true,
    };
  }
}
