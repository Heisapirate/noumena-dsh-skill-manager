// Pure update-status derivation (Issue #16). No filesystem or network access:
// the caller supplies the recorded hashes and the freshly observed values, and
// this module computes the single status the UI maps to copy/actions.
//
// Invariant (spec §7): `remoteSourceHash` is compared only to the previously
// recorded `remoteSourceHash`; `localContentHash` is compared only to the
// previously recorded `localContentHash`. The two are never compared to each
// other — the branded manifest types make accidental cross-assignment a type
// error, and this module keeps them in separate inputs for the same reason.

import type { LocalContentHash, RemoteSourceHash, SkillManifestEntry } from '../manifest';
import type { UpdateCheckError, UpdateInfo, UpdateStatus } from '../types';

/** The recorded + freshly observed values needed to resolve a skill's status. */
export interface StatusInput {
  recordedRemoteSourceHash: RemoteSourceHash;
  latestRemoteSourceHash: RemoteSourceHash | null;
  recordedLocalContentHash: LocalContentHash;
  currentLocalContentHash: LocalContentHash | null;
  remoteError?: { code: string };
}

/** The derived status plus the two independent change flags. */
export interface StatusResolution {
  status: UpdateStatus;
  updateAvailable: boolean;
  localModified: boolean;
}

/**
 * Resolve a skill's update status and change flags in one pass. Remote-check
 * failures take precedence over drift so an unavailable or unreachable source
 * is never misreported as "up to date" or "update available"; `source-unavailable`
 * (404/snapshot missing) is distinguished from other remote failures (§10).
 */
export function resolveStatus(input: StatusInput): StatusResolution {
  const updateAvailable =
    input.latestRemoteSourceHash !== null &&
    input.latestRemoteSourceHash !== input.recordedRemoteSourceHash;
  const localModified =
    input.currentLocalContentHash !== null &&
    input.currentLocalContentHash !== input.recordedLocalContentHash;

  let status: UpdateStatus;
  if (input.remoteError) {
    status =
      input.remoteError.code === 'source-unavailable' ? 'source-unavailable' : 'remote-check-failure';
  } else if (updateAvailable && localModified) {
    status = 'update-available-and-locally-modified';
  } else if (updateAvailable) {
    status = 'update-available';
  } else if (localModified) {
    status = 'locally-modified';
  } else {
    status = 'up-to-date';
  }
  return { status, updateAvailable, localModified };
}

/** The single update status for a skill (see {@link resolveStatus}). */
export function deriveUpdateStatus(input: StatusInput): UpdateStatus {
  return resolveStatus(input).status;
}

export interface UpdateInfoInput {
  slug: string;
  entry: SkillManifestEntry;
  latestRemoteSourceHash: RemoteSourceHash | null;
  currentLocalContentHash: LocalContentHash | null;
  remoteError?: UpdateCheckError;
}

/** Build the full {@link UpdateInfo} DTO for one skill. */
export function buildUpdateInfo(input: UpdateInfoInput): UpdateInfo {
  const { status, updateAvailable, localModified } = resolveStatus({
    recordedRemoteSourceHash: input.entry.remoteSourceHash,
    latestRemoteSourceHash: input.latestRemoteSourceHash,
    recordedLocalContentHash: input.entry.localContentHash,
    currentLocalContentHash: input.currentLocalContentHash,
    remoteError: input.remoteError,
  });

  const info: UpdateInfo = {
    slug: input.slug,
    status,
    updateAvailable,
    upstreamChanged: updateAvailable,
    localModified,
    recordedRemoteSourceHash: input.entry.remoteSourceHash,
    recordedLocalContentHash: input.entry.localContentHash,
  };
  if (input.latestRemoteSourceHash !== null) {
    info.latestRemoteSourceHash = input.latestRemoteSourceHash;
  }
  if (input.currentLocalContentHash !== null) {
    info.currentLocalContentHash = input.currentLocalContentHash;
  }
  if (input.remoteError) info.error = input.remoteError;
  return info;
}
