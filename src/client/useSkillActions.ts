// Thin React adapter that owns a mutation action store for the lifetime of the
// panel and exposes its run controls + scoped per-action state. All lifecycle,
// double-submit, and refresh-on-success logic lives in the store; this hook only
// bridges store ↔ React and forwards a success callback (managed-list refresh).

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createActionStore } from './actions/store';
import type { ActionKind, ActionState } from './actions/types';
import type { ClientConnection } from './connection';
import { createSkillManagerApi } from './rpc';

export interface SkillActionsController {
  install: (id: string, overwrite?: boolean) => void;
  update: (id: string, discardLocalChanges?: boolean) => void;
  uninstall: (slug: string, options?: { confirm?: boolean; discardLocalChanges?: boolean }) => void;
  stateFor: (kind: ActionKind, target: string) => ActionState;
}

export function useSkillActions(
  connection: ClientConnection,
  onSuccess?: () => void,
): SkillActionsController {
  // Keep the latest success callback without recreating the store.
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const store = useMemo(() => {
    const api = createSkillManagerApi(connection);
    return createActionStore({
      install: (id, overwrite) => api.install(id, overwrite),
      update: (id, discardLocalChanges) => api.update(id, discardLocalChanges),
      uninstall: (id, options) => api.uninstall(id, options),
      onSuccess: () => onSuccessRef.current?.(),
    });
  }, [connection]);

  useEffect(() => () => store.dispose(), [store]);

  // Re-render whenever the immutable snapshot map is replaced.
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return {
    install: (id, overwrite) => store.runInstall(id, overwrite),
    update: (id, discardLocalChanges) => store.runUpdate(id, discardLocalChanges),
    uninstall: (slug, options) => store.runUninstall(slug, options),
    stateFor: (kind, target) => store.stateFor(kind, target),
  };
}
