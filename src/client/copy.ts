// The single client-side error-code → copy/action mapping (Issue #18, spec §12).
// Every typed code the host can surface across the search, install, update, and
// uninstall endpoints maps here to concise, non-leaking copy plus a safe action
// hint. React renderers depend on this module so the whole UI shares one copy
// universe and never re-implements per-code wording or leaks raw internals.

/** What a user can safely do about a given error. */
export type ErrorAction = 'retry' | 'confirm' | 'none';

/** A user-facing rendering of an error: copy plus the one safe action. */
export interface ErrorPresentation {
  message: string;
  action: ErrorAction;
}

/** The generic fallback; also the only message that suggests retrying blind. */
const GENERIC = 'Something went wrong. Please retry.';

/**
 * Map a normalized host error code to user copy + action. Unknown and future
 * codes fold to the generic message so the UI never shows raw internals.
 */
export function presentError(code: string | undefined): ErrorPresentation {
  switch (code) {
    // --- Search-level network failures (retry is always safe) ---
    case 'network-unavailable':
      return { message: 'Could not reach skills.sh. Check your connection and retry.', action: 'retry' };
    case 'timeout':
      return { message: 'The request timed out. Please retry.', action: 'retry' };
    case 'rate-limited':
      return { message: 'skills.sh rate-limited this request. Please wait a moment and retry.', action: 'retry' };
    case 'registry-unavailable':
    case 'http-error':
    case 'malformed-response':
      return { message: 'skills.sh is temporarily unavailable. Please retry.', action: 'retry' };

    // --- Confirmation gates (surfaced defensively; normally pre-gated in the UI) ---
    case 'duplicate-install':
      return { message: 'This skill is already installed. Confirm to replace it.', action: 'confirm' };
    case 'local-modification-conflict':
      return { message: 'This skill has local changes. Confirm to replace them.', action: 'confirm' };
    case 'confirmation-required':
      return { message: 'Confirm this action to continue.', action: 'confirm' };

    // --- Scoped action failures (no retry: retrying would repeat the same refusal) ---
    case 'source-unavailable':
      return { message: "This skill's source can't be installed or updated from here.", action: 'none' };
    case 'foreign-target':
    case 'foreign-skill':
      return { message: "This skill isn't managed by this plugin, so it was left untouched.", action: 'none' };
    case 'skill-not-found':
      return { message: "This skill isn't installed anymore.", action: 'none' };
    case 'invalid-request':
    case 'invalid-skill-name':
      return { message: "That request couldn't be understood.", action: 'none' };
    case 'malformed-snapshot':
      return { message: "The skill's contents couldn't be validated.", action: 'none' };
    case 'unsafe-path':
    case 'traversal':
    case 'absolute-path':
    case 'drive-letter-path':
    case 'invalid-relative-path':
    case 'symlink-escape':
      return { message: "This skill couldn't be written safely.", action: 'none' };
    case 'filesystem-permission':
    case 'filesystem-error':
      return { message: "The skill manager couldn't write to disk.", action: 'none' };
    case 'manifest-corruption':
      return { message: "The skill manager's records are unreadable.", action: 'none' };
    case 'not-found':
      return { message: "The host didn't understand this request.", action: 'none' };
    case 'cancelled':
      return { message: 'The request was cancelled.', action: 'none' };

    // --- Transaction partial failures: safe to retry, nothing was left broken ---
    case 'install-partial-failure':
    case 'update-partial-failure':
    case 'uninstall-partial-failure':
      return { message: "The operation didn't complete. Nothing was left in a broken state.", action: 'retry' };

    // --- internal + anything unknown ---
    default:
      return { message: GENERIC, action: 'retry' };
  }
}

/** Extract the normalized code from a thrown value, defaulting to `unknown`. */
export function errorCodeOf(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return 'unknown';
}

/** Map a thrown value (RPC error or otherwise) to user copy + action. */
export function presentThrown(err: unknown): ErrorPresentation {
  return presentError(errorCodeOf(err));
}
