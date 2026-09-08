// Typed errors raised by the update transaction (Issue #16). Application code
// branches on `code`, never on raw Error types. `toRpcError` (the shared RPC
// normalizer) lives in `src/rpc-error.ts` so install and update normalize
// identically.

/** Failure codes raised by the update transaction itself. */
export type UpdateErrorCode =
  | 'invalid-request'
  | 'skill-not-found'
  | 'source-unavailable'
  | 'local-modification-conflict'
  | 'malformed-snapshot'
  | 'unsafe-path'
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
