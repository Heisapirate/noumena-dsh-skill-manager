// The production uninstall transaction (Issue #17, production spec §11). It
// composes — never re-implements — the two boundaries built earlier:
//
//   - ManifestStore (#10) for provenance; only a manifest-recorded skill is
//     removable and the entry is removed atomically after the directory;
//   - SkillRoot (#11) for every filesystem mutation (validate, classify, and
//     delete the directory; never follow a symlink/junction).
//
// Order (spec §11): validate the skill name → load + reconcile the manifest →
// managed-only gate (foreign / unknown / missing → typed refusal) → local-drift
// gate → removal-confirmation gate → delete the skill dir → remove the manifest
// entry atomically. Deleting the directory first means an interrupted uninstall
// is recovered by reconcile-on-load (a dir with no entry is foreign; an entry
// with no dir is dropped).

import { SkillManagerError, toFilesystemError } from './errors';
import { computeLocalContentHash } from './manifest/read';
import type { ManifestStore } from './manifest/store';
import type { ManifestLoadResult } from './manifest/store';
import type { LocalContentHash, SkillManifest } from './manifest/types';
import { PathSafetyError, type SkillRoot } from './path-safety';
import type { UninstallRequest, UninstallResult } from './types';

/**
 * Run the uninstall transaction. On success the skill directory is gone and the
 * manifest no longer records it; on any refusal nothing is removed, and on a
 * partial failure (dir deleted, manifest save failed) the entry is reconciled
 * away on the next load.
 */
export async function uninstallSkill(
  root: SkillRoot,
  store: ManifestStore,
  input: UninstallRequest,
): Promise<UninstallResult> {
  if (typeof input?.id !== 'string') {
    throw new SkillManagerError('invalid-request', 'uninstall requires a string "id"', {});
  }
  const { id } = input;

  // 1. Validate the skill name and resolve the target strictly inside the root.
  const skillDir = root.skillDir(id);

  // 2. Load + reconcile the manifest; refuse when it cannot be trusted.
  const load = await loadManifest(root, store);
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
      await persistManifest(
        store,
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
  const drifted = await hasLocalDrift(root, id, entry.localContentHash);
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
  await persistManifest(
    store,
    withoutEntry(load.manifest, id),
    'removed the skill directory but failed to update the manifest',
  );
  return { ok: true };
}

/** Recompute the local-content hash and compare to the recorded value. */
async function hasLocalDrift(root: SkillRoot, id: string, recorded: LocalContentHash): Promise<boolean> {
  const kind = await root.classifySkill(id);
  // Vanished between load and drift check: nothing left to protect.
  if (kind === 'missing') return false;
  // Replaced by a symlink/junction (or a plain file) → local modification.
  if (kind !== 'directory') return true;
  return (await computeLocalContentHash(root.skillDir(id))) !== recorded;
}

async function loadManifest(root: SkillRoot, store: ManifestStore): Promise<ManifestLoadResult> {
  try {
    return await store.load();
  } catch (err) {
    throw toFilesystemError(err, root.path);
  }
}

async function persistManifest(store: ManifestStore, manifest: SkillManifest, failureMessage: string): Promise<void> {
  try {
    await store.save(manifest);
  } catch (err) {
    throw new SkillManagerError('uninstall-partial-failure', failureMessage, {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}

function withoutEntry(manifest: SkillManifest, id: string): SkillManifest {
  const skills = { ...manifest.skills };
  delete skills[id];
  return { version: manifest.version, skills };
}
