// Thin React adapter that loads the plugin-managed skills from the host `list`
// endpoint and exposes the list state + a refresh control. All status mapping
// lives in `managed/view.ts`; this hook only bridges host → view model → React.

import { useEffect, useMemo, useState } from 'react';
import type { ClientConnection } from './connection';
import { presentThrown } from './copy';
import type { ErrorPresentation } from './copy';
import { toManagedSkillViewModel } from './managed/view';
import type { ManagedSkillViewModel } from './managed/view';
import { createSkillManagerApi } from './rpc';

export type ManagedSkillsState =
  | { status: 'loading'; skills: ManagedSkillViewModel[]; error: null }
  | { status: 'ready'; skills: ManagedSkillViewModel[]; error: null }
  | { status: 'error'; skills: ManagedSkillViewModel[]; error: ErrorPresentation };

export interface ManagedSkillsController {
  state: ManagedSkillsState;
  refresh: () => void;
}

export function useManagedSkills(connection: ClientConnection): ManagedSkillsController {
  const api = useMemo(() => createSkillManagerApi(connection), [connection]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ManagedSkillsState>({ status: 'loading', skills: [], error: null });

  useEffect(() => {
    let alive = true;
    // Keep the previous rows visible during a refresh to avoid a flash.
    setState((prev) => ({ status: 'loading', skills: prev.skills, error: null }));
    api
      .list()
      .then((skills) => {
        if (!alive) return;
        setState({ status: 'ready', skills: skills.map(toManagedSkillViewModel), error: null });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState({
          status: 'error',
          skills: [],
          // Map to non-leaking copy (spec §12): no raw host error crosses into the UI.
          error: presentThrown(err),
        });
      });
    return () => {
      alive = false;
    };
  }, [api, attempt]);

  return {
    state,
    refresh: () => setAttempt((a) => a + 1),
  };
}
