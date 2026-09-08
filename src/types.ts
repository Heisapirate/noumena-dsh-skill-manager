// Shared host<->client types for the `/skill-manager` RPC channel.

/**
 * The Connection RPC result shape (mirrors DSH rc.1 `ConnectionRpcResult`).
 * Every endpoint on the `/skill-manager` channel returns one of these.
 */
export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } };

/** Typed response of the `health`/`ping` endpoints. */
export interface HealthInfo {
  ok: true;
  plugin: 'dsh-skill-manager';
  version: string;
  /** Epoch milliseconds of the host clock at answer time. */
  now: number;
}

/**
 * Host-side RPC handler signature (rc.1): `(endpoint, payload, signal)`.
 * `signal` is the Connection-provided abort signal for the request.
 */
export type RpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) => Promise<RpcResult<unknown>>;

// ---------------------------------------------------------------------------
// Update detection + transaction (Issue #16). These DTOs are shared by the
// host and client halves, so they stay free of any Node-only import.
// ---------------------------------------------------------------------------

/**
 * The six update states the UI maps to copy/actions. The machine-readable
 * codes are kebab-case; the client maps them to user-facing wording.
 */
export type UpdateStatus =
  | 'up-to-date'
  | 'update-available'
  | 'locally-modified'
  | 'update-available-and-locally-modified'
  | 'source-unavailable'
  | 'remote-check-failure';

/** A normalized per-skill remote-check failure (RPC-serializable). */
export interface UpdateCheckError {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/** One plugin-managed skill's update-detection report. */
export interface UpdateInfo {
  /** The kebab-case skill name. */
  slug: string;
  /** Derived state combining the remote and local axes (see {@link UpdateStatus}). */
  status: UpdateStatus;
  /** Latest upstream `remoteSourceHash` differs from the recorded one. */
  updateAvailable: boolean;
  /** Alias of {@link updateAvailable} (spec §3 `UpdateInfo.upstreamChanged`). */
  upstreamChanged: boolean;
  /** Recomputed `localContentHash` differs from the recorded one (local drift). */
  localModified: boolean;
  /** The manifest's recorded `remoteSourceHash`. */
  recordedRemoteSourceHash: string;
  /** The manifest's recorded `localContentHash`. */
  recordedLocalContentHash: string;
  /** The freshly observed upstream hash; present when the remote check succeeded. */
  latestRemoteSourceHash?: string;
  /** The freshly recomputed local hash; present when the recompute succeeded. */
  currentLocalContentHash?: string;
  /** Present only for `source-unavailable` / `remote-check-failure`. */
  error?: UpdateCheckError;
}

/** Response of the `checkUpdates` endpoint. */
export interface CheckUpdatesResult {
  updates: UpdateInfo[];
}

/** Payload of the `update` endpoint. */
export interface UpdateInput {
  /** Full skills.sh id: `owner/repo/slug`. */
  id: string;
  /**
   * Explicit consent to discard local modifications. Required (truthy) when the
   * plugin-managed skill has drifted, otherwise the update is refused with
   * `local-modification-conflict` and nothing is overwritten.
   */
  discardLocalChanges?: boolean;
}

/** Success payload of the `update` endpoint. */
export interface UpdateResult {
  /** The kebab-case skill name that was updated. */
  slug: string;
  /** Upstream origin (`owner/repo`). */
  source: string;
  /** New recorded `remoteSourceHash` (the latest upstream fingerprint). */
  remoteSourceHash: string;
  /** New recorded `localContentHash` (computed over the freshly written files). */
  localContentHash: string;
  /** ISO-8601 timestamp of this update. */
  updatedAt: string;
  /** Whether local modifications were discarded during this update. */
  discardedLocalChanges: boolean;
  /**
   * Whether a replacement was applied. `false` means the skill was already up
   * to date and unmodified, so nothing was staged, swapped, or re-recorded.
   */
  applied: boolean;
}
