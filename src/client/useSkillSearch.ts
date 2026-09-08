// Thin React adapter that owns a search engine for the lifetime of the panel
// and exposes its state + controls. All debounce/cancellation/hydration logic
// lives in the engine; this hook only bridges engine ↔ React. The engine is
// created per effect mount (and disposed on cleanup) so a React dev remount
// always gets a fresh, working engine rather than a disposed one.

import { useEffect, useMemo, useState } from 'react';
import type { ClientConnection } from './connection';
import { createSkillManagerApi } from './rpc';
import { createSearchEngine } from './search/engine';
import type { SearchEngine } from './search/engine';
import type { SearchSnapshot } from './search/types';

export interface SkillSearchController {
  state: SearchSnapshot;
  setQuery: (query: string) => void;
  retry: () => void;
}

const INITIAL_SNAPSHOT: SearchSnapshot = { status: 'idle', query: '', results: [], error: null };

export function useSkillSearch(connection: ClientConnection): SkillSearchController {
  const api = useMemo(() => createSkillManagerApi(connection), [connection]);
  const [engine, setEngine] = useState<SearchEngine | null>(null);
  const [state, setState] = useState<SearchSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    const nextEngine = createSearchEngine({
      search: (query, signal) => api.search(query, signal),
      describe: (id, signal) => api.describe(id, signal),
    });
    setEngine(nextEngine);
    setState(nextEngine.getState());
    const unsubscribe = nextEngine.subscribe(setState);
    return () => {
      unsubscribe();
      nextEngine.dispose();
    };
  }, [api]);

  return {
    state,
    setQuery: (query: string) => engine?.setQuery(query),
    retry: () => engine?.retry(),
  };
}
