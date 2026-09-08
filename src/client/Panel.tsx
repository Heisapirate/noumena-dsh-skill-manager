// The Skill Manager settings panel. Issue #9 renders the production shell —
// title, explanatory copy, and a live host-connectivity status driven by the
// `/skill-manager` health RPC — plus stable containers that later tickets fill
// with real search and managed-skills UI.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ENDPOINT_HEALTH, RPC_CHANNEL } from '../contract';
import type { HealthInfo } from '../types';
import type { ClientConnection } from './connection';
import { SearchSection } from './SearchSection';
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
  placeholder: { margin: 0, opacity: 0.6 },
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
          setStatus({ state: 'unavailable', health: null, message: result.error.message });
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setStatus({
          state: 'unavailable',
          health: null,
          message: err instanceof Error ? err.message : String(err),
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
        />
      </section>

      <section style={styles.section} aria-label="Managed skills">
        <h2 style={styles.heading}>Managed skills</h2>
        <p style={styles.placeholder}>The skills this plugin manages will appear here.</p>
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
