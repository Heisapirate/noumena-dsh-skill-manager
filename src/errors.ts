// Typed host-service errors, normalized to the `/skill-manager` RPC error shape
// by the RPC layer (spec §12). These are the business-logic failures the
// uninstall transaction can surface; path-safety failures use `PathSafetyError`
// (which exposes the same `toRpcError` shape) and flow through unchanged.

export type SkillManagerErrorCode =
  | 'foreign-skill'
  | 'skill-not-found'
  | 'manifest-corruption'
  | 'local-modification-conflict'
  | 'confirmation-required'
  | 'uninstall-partial-failure'
  | 'invalid-request'
  | 'filesystem-permission'
  | 'filesystem-error';

export class SkillManagerError extends Error {
  readonly code: SkillManagerErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: SkillManagerErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'SkillManagerError';
    this.code = code;
    this.details = details;
  }

  /** Normalize to the RPC error shape; later layers map `code` to user-facing copy. */
  toRpcError(): { code: string; message: string; details: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** True when a Node filesystem error is a permission/read-only denial. */
export function isPermissionErrno(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
}

/**
 * Map a raw Node filesystem error to a typed `SkillManagerError`, so filesystem
 * failures outside the safe-path boundary (manifest reads, hash recomputation)
 * surface as `filesystem-permission` / `filesystem-error` rather than a raw
 * internal error.
 */
export function toFilesystemError(err: unknown, path: string): SkillManagerError {
  if (isPermissionErrno(err)) {
    return new SkillManagerError('filesystem-permission', `permission denied on ${path}`, { path });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new SkillManagerError('filesystem-error', `filesystem error on ${path}: ${message}`, { path });
}
