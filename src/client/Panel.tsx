// The Skill Manager settings panel. Issue #9 renders the production shell —
// title, explanatory copy, and a live host-connectivity status driven by the
// `/skill-manager` health RPC — plus stable containers that later tickets fill
// with real search and managed-skills UI.

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { ENDPOINT_HEALTH, RPC_CHANNEL } from '../contract';
import type { HealthInfo } from '../types';
import type { ClientConnection } from './connection';
import { ManagedSkillsSection } from './ManagedSkillsSection';
import { presentThrown } from './copy';
import { SearchSection } from './SearchSection';
import { useManagedSkills } from './useManagedSkills';
import { useSkillActions } from './useSkillActions';
import { useSkillSearch } from './useSkillSearch';

export interface SkillManagerPanelProps {
  connection: ClientConnection;
}

type ConnectionState = 'checking' | 'connected' | 'unavailable';

interface ConnectionStatus {
  state: ConnectionState;
  health: HealthInfo | null;
  message: string | null;
}

const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '720px' },
  section: { display: 'flex', flexDirection: 'column', gap: '6px' },
  heading: { fontSize: '13px', fontWeight: 600, margin: 0, textTransform: 'uppercase', letterSpacing: '0.02em' },
  intro: { margin: 0, opacity: 0.85 },
  statusLine: { margin: 0, display: 'flex', alignItems: 'center', gap: '8px' },
  retry: { alignSelf: 'flex-start', cursor: 'pointer' },
};

export function SkillManagerPanel({ connection }: SkillManagerPanelProps) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>({
    state: 'checking',
    health: null,
    message: null,
  });
  const search = useSkillSearch(connection);
  const managed = useManagedSkills(connection);
  const actions = useSkillActions(connection, () => managed.refresh());

  // The slugs this plugin already manages (from the list), used to mark search
  // rows as already-installed. Derived from the host `list` result, never from a
  // directory or a user-entered slug (ADR-0001/0002).
  const managedSlugs = useMemo(
    () => new Set(managed.state.skills.map((skill) => skill.slug)),
    [managed.state.skills],
  );

  useEffect(() => {
    let alive = true;
    setStatus((prev) => ({ ...prev, state: 'checking', message: null }));
    connection.rpc
      .call<HealthInfo>(RPC_CHANNEL, ENDPOINT_HEALTH, {})
      .then((result) => {
        if (!alive) return;
        if (result.ok) {
          setStatus({ state: 'connected', health: result.value, message: null });
        } else {
          setStatus({
            state: 'unavailable',
            health: null,
            message: presentThrown({ code: result.error.code }).message,
          });
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setStatus({
          state: 'unavailable',
          health: null,
          message: presentThrown(err).message,
        });
      });
    return () => {
      alive = false;
    };
  }, [connection, attempt]);

  return (
    <div style={styles.root} role="region" aria-label="DSH Skill Manager">
      <header>
        <h1 style={{ margin: '0 0 4px' }}>DSH Skill Manager</h1>
        <p style={styles.intro}>
          Discover, install, update, and manage skills from skills.sh without leaving DSH.
        </p>
      </header>

      <section style={styles.section} aria-label="Skill search">
        <h2 style={styles.heading}>Search</h2>
        <SearchSection
          state={search.state}
          onQueryChange={search.setQuery}
          onRetry={search.retry}
          managedSlugs={managedSlugs}
          actionState={actions.stateFor}
          onInstall={actions.install}
        />
      </section>

      <section style={styles.section} aria-label="Managed skills">
        <h2 style={styles.heading}>Managed skills</h2>
        <ManagedSkillsSection
          state={managed.state}
          onRefresh={managed.refresh}
          actionState={actions.stateFor}
          onUpdate={actions.update}
          onUninstall={actions.uninstall}
        />
      </section>

      <section style={styles.section} aria-label="Host connection">
        <h2 style={styles.heading}>Host connection</h2>
        {status.state === 'checking' && <p style={styles.statusLine}>Checking host connection…</p>}
        {status.state === 'connected' && status.health && (
          <p style={styles.statusLine}>
            <span aria-hidden>✓</span> Connected — {status.health.plugin} v{status.health.version}
          </p>
        )}
        {status.state === 'unavailable' && (
          <div style={styles.section}>
            <p style={styles.statusLine}>
              <span aria-hidden>✕</span> Host unavailable{status.message ? `: ${status.message}` : ''}
            </p>
            <button type="button" style={styles.retry} onClick={() => setAttempt((a) => a + 1)}>
              Retry
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
