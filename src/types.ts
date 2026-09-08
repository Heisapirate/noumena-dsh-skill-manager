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

/** Payload of the `install` endpoint (`id` = skills.sh `owner/repo/slug`). */
export interface InstallRequest {
  id: string;
  /** Required to overwrite an already plugin-managed skill (see §9). */
  overwrite?: boolean;
}

/**
 * Result of a successful install: the provenance recorded for the skill, with
 * the two hashes as plain strings (the branded host-only types are not sent
 * across the RPC boundary).
 */
export interface InstallResult {
  slug: string;
  source: string;
  remoteSourceHash: string;
  localContentHash: string;
  installedAt: string;
  updatedAt: string;
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
