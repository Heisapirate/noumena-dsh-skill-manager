// Typed, normalized failures for the SkillsShClient adapter. Application code
// branches on `code`, never on raw fetch errors or response JSON.

export type SkillsShErrorCode =
  | 'network-unavailable'
  | 'timeout'
  | 'http-error'
  | 'rate-limited'
  | 'registry-unavailable'
  | 'malformed-response'
  | 'source-unavailable'
  | 'cancelled';

export interface SkillsShErrorOptions {
  statusCode?: number;
  retryAfterSeconds?: number;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/** A single normalized failure. `toObject()` is the RPC-serializable form. */
export class SkillsShError extends Error {
  readonly code: SkillsShErrorCode;
  readonly statusCode?: number;
  readonly retryAfterSeconds?: number;
  readonly details: Record<string, unknown>;

  constructor(code: SkillsShErrorCode, message: string, options: SkillsShErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'SkillsShError';
    this.code = code;
    this.statusCode = options.statusCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details ?? {};
  }

  /** Serializable form for the RPC boundary (no Error internals). */
  toObject(): { code: SkillsShErrorCode; message: string; details: Record<string, unknown> } {
    const details: Record<string, unknown> = { ...this.details };
    if (this.statusCode != null) details.statusCode = this.statusCode;
    if (this.retryAfterSeconds != null) details.retryAfterSeconds = this.retryAfterSeconds;
    return { code: this.code, message: this.message, details };
  }
}

export function isSkillsShError(err: unknown): err is SkillsShError {
  return err instanceof SkillsShError;
}

/** Build a `cancelled` error (e.g. from an AbortSignal). */
export function cancelledError(cause?: unknown): SkillsShError {
  return new SkillsShError('cancelled', 'request cancelled', { cause });
}

/**
 * Parse a `Retry-After` header into whole seconds. Accepts a delta-seconds
 * integer or an HTTP-date; returns `undefined` when absent or unparseable.
 * `nowMs` is injectable for deterministic tests.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number = Date.now()): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  // Delta-seconds: an integer. Negative values are invalid per RFC 7231.
  if (/^[+-]?\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  }
  const time = Date.parse(trimmed);
  if (!Number.isFinite(time)) return undefined;
  return Math.max(0, Math.ceil((time - nowMs) / 1000));
}
