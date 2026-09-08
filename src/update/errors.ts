// Typed errors + a single error→RPC normalizer for the update transaction
// (Issue #16). Application code branches on `code`, never on raw Error types,
// and every failure crosses the RPC boundary as `{code,message,details}`.

import { PathSafetyError } from '../path-safety';
import { isSkillsShError } from '../skills-sh';

/** Failure codes raised by the update transaction itself. */
export type UpdateErrorCode =
  | 'invalid-request'
  | 'skill-not-found'
  | 'source-unavailable'
  | 'local-modification-conflict'
  | 'invalid-snapshot'
  | 'manifest-corruption'
  | 'update-partial-failure';

/** A normalized, RPC-serializable failure raised by the update transaction. */
export class UpdateError extends Error {
  readonly code: UpdateErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: UpdateErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
    this.details = details;
  }

  toRpcError(): { code: string; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function isUpdateError(err: unknown): err is UpdateError {
  return err instanceof UpdateError;
}

/**
 * Normalize any thrown value to the `{code,message,details}` shape used by the
 * `/skill-manager` RPC boundary. It recognizes the three typed error surfaces —
 * `SkillsShError`, `PathSafetyError`, and `UpdateError` — and folds everything
 * else into a generic `internal` error so no raw throw ever crosses the boundary.
 */
export function toRpcError(err: unknown): {
  code: string;
  message: string;
  details: Record<string, unknown>;
} {
  if (isSkillsShError(err)) {
    const o = err.toObject();
    return { code: o.code, message: o.message, details: o.details };
  }
  if (err instanceof PathSafetyError) return err.toRpcError();
  if (isUpdateError(err)) return err.toRpcError();
  return {
    code: 'internal',
    message: err instanceof Error ? err.message : 'Unknown error',
    details: {},
  };
}
