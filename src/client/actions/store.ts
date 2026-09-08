// The mutation action store (Issue #18). A framework-agnostic controller that
// runs install/update/uninstall through the typed RPC layer and owns the
// per-target lifecycle (pending → success | error), double-submit prevention, and
// the refresh-on-success hook. The React hook wraps this store; the React
// components only read `stateFor` and forward a click — no state algorithm lives
// in the components.

import { presentThrown } from '../copy';
import { idleActionState, type ActionKind, type ActionState } from './types';

/** The RPC-bound mutation functions the store runs (one call per kind). */
export interface MutationApi {
  install(id: string, overwrite: boolean): Promise<unknown>;
  update(id: string, discardLocalChanges: boolean): Promise<unknown>;
  uninstall(slug: string, options: { confirm: boolean; discardLocalChanges: boolean }): Promise<unknown>;
}

export interface ActionStoreOptions extends MutationApi {
  /** Called after any successful mutation (the caller refreshes the managed list). */
  onSuccess?: (kind: ActionKind) => void;
}

export interface ActionStore {
  runInstall(id: string, overwrite?: boolean): void;
  runUpdate(id: string, discardLocalChanges?: boolean): void;
  runUninstall(id: string, options?: { confirm?: boolean; discardLocalChanges?: boolean }): void;
  /** The scoped state for one action on one target (id for install/update, slug for uninstall). */
  stateFor(kind: ActionKind, target: string): ActionState;
  /** The immutable snapshot map for `useSyncExternalStore` (reference changes only on update). */
  getSnapshot(): ReadonlyMap<string, ActionState>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

const SUCCESS_MESSAGE: Record<ActionKind, string> = {
  install: 'Installed',
  update: 'Updated',
  uninstall: 'Uninstalled',
};

function keyFor(kind: ActionKind, target: string): string {
  return `${kind}:${target}`;
}

export function createActionStore(options: ActionStoreOptions): ActionStore {
  let states = new Map<string, ActionState>();
  const listeners = new Set<() => void>();
  let disposed = false;

  function set(key: string, state: ActionState): void {
    const next = new Map(states);
    next.set(key, state);
    states = next;
    for (const listener of listeners) listener();
  }

  function run(kind: ActionKind, target: string, invoke: () => Promise<unknown>): void {
    if (disposed) return;
    const key = keyFor(kind, target);
    const current = states.get(key) ?? idleActionState;
    if (current.status === 'pending') return; // double-submit guard
    set(key, { status: 'pending', message: null, error: null });
    void invoke().then(
      () => {
        if (disposed) return;
        set(key, { status: 'success', message: SUCCESS_MESSAGE[kind], error: null });
        options.onSuccess?.(kind);
      },
      (err: unknown) => {
        if (disposed) return;
        set(key, { status: 'error', message: null, error: presentThrown(err) });
      },
    );
  }

  return {
    runInstall(id, overwrite = false) {
      run('install', id, () => options.install(id, overwrite));
    },
    runUpdate(id, discardLocalChanges = false) {
      run('update', id, () => options.update(id, discardLocalChanges));
    },
    runUninstall(slug, optionsArg) {
      run('uninstall', slug, () =>
        options.uninstall(slug, {
          confirm: optionsArg?.confirm ?? false,
          discardLocalChanges: optionsArg?.discardLocalChanges ?? false,
        }),
      );
    },
    stateFor(kind, target) {
      return states.get(keyFor(kind, target)) ?? idleActionState;
    },
    getSnapshot: () => states,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}
