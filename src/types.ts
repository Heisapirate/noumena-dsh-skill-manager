// Shared host<->client types for the `/skill-manager` RPC channel.

import type { SkillSearchResult } from './skills-sh/types';

// The search result DTO crosses the RPC boundary; re-exporting the adapter's
// normalized type (ADR-0003) keeps the contract single-sourced while the
// browser never sees skills.sh endpoint shapes. Type-only, so the client bundle
// carries no host code.
export type { SkillSearchResult };

/**
 * The Connection RPC result shape (mirrors DSH rc.1 `ConnectionRpcResult`).
 * Every endpoint on the `/skill-manager` channel returns one of these.
 */
export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } };

/** Payload for the `search` endpoint. */
export interface SearchRequest {
  query: string;
}

/** Response of the `search` endpoint: basic results only (no descriptions). */
export interface SearchResponse {
  results: SkillSearchResult[];
  /** Whether the server returned the complete result set (no truncation). */
  complete: boolean;
}

/** Payload for the `describe` endpoint. */
export interface DescribeRequest {
  /** Full skills.sh id (`owner/repo/slug`). */
  id: string;
}

/** Response of the `describe` endpoint: one skill's hydrated description. */
export interface DescribeResponse {
  /** `null` when the skill has no description (not a failure). */
  description: string | null;
}

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
