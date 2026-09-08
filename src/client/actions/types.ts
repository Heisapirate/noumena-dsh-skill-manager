// Framework-agnostic mutation state model (Issue #18). One action at a time per
// target (double-submit prevention), with scoped success/error feedback the
// React renderers display without re-deriving any state.

import type { ErrorPresentation } from '../copy';

/** The three user-invocable mutations. */
export type ActionKind = 'install' | 'update' | 'uninstall';

/** Per-action lifecycle. */
export type ActionStatus = 'idle' | 'pending' | 'success' | 'error';

/** The scoped feedback for one action on one target. */
export interface ActionState {
  status: ActionStatus;
  /** Success copy; present only when `status === 'success'`. */
  message: string | null;
  /** Non-leaking error presentation; present only when `status === 'error'`. */
  error: ErrorPresentation | null;
}

/** The initial state for any action that has never run. */
export const idleActionState: ActionState = { status: 'idle', message: null, error: null };
