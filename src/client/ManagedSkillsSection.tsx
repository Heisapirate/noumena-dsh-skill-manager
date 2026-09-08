// The managed-skills section (Issue #15). It renders only the view model the
// hook supplies: loading, empty, error, and per-skill rows with provenance and
// status badges. Update/uninstall buttons are stable action seams for the later
// #16/#17/#18 wiring — they are rendered disabled so a click can never perform
// a destructive action from this section today.

import type { CSSProperties } from 'react';
import type { ManagedSkillBadge, ManagedSkillViewModel } from './managed/view';
import { SkeletonBar, SkeletonStyle } from './Skeleton';
import type { ManagedSkillsState } from './useManagedSkills';

interface ManagedSkillsSectionProps {
  state: ManagedSkillsState;
  onRefresh: () => void;
}

const styles: Record<string, CSSProperties> = {
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' },
  refresh: { cursor: 'pointer' },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' },
  row: {
    border: '1px solid rgba(127, 127, 127, 0.25)',
    borderRadius: '6px',
    padding: '10px 12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
  },
  rowMain: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
  name: { fontWeight: 600, fontSize: '14px', overflowWrap: 'anywhere' },
  meta: { fontSize: '12px', opacity: 0.8 },
  status: { fontSize: '13px' },
  badges: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  actions: { display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 },
  action: { cursor: 'not-allowed' },
  message: { margin: 0, fontSize: '13px' },
  errorBox: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' },
  retry: { cursor: 'pointer' },
  empty: { margin: 0, opacity: 0.75, fontSize: '13px' },
};

const BADGE_BACKGROUND: Record<ManagedSkillBadge['tone'], string> = {
  ok: 'rgba(40, 167, 69, 0.15)',
  warning: 'rgba(255, 170, 0, 0.15)',
  danger: 'rgba(220, 53, 69, 0.15)',
  muted: 'rgba(127, 127, 127, 0.15)',
};

const BADGE_COLOR: Record<ManagedSkillBadge['tone'], string> = {
  ok: '#1e7e34',
  warning: '#b06a00',
  danger: '#b02a37',
  muted: '#5a5a5a',
};

export function ManagedSkillsSection({ state, onRefresh }: ManagedSkillsSectionProps) {
  return (
    <div>
      <SkeletonStyle />
      <div style={styles.headerRow}>
        <p style={styles.status}>Skills this plugin has installed and manages.</p>
        <button type="button" style={styles.refresh} onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {state.status === 'loading' && <SkeletonRows rows={2} />}

      {state.status === 'error' && (
        <div style={styles.errorBox}>
          <p style={styles.message}>Could not load managed skills: {state.error}</p>
          <button type="button" style={styles.retry} onClick={onRefresh}>
            Retry
          </button>
        </div>
      )}

      {state.status === 'ready' && state.skills.length === 0 && (
        <p style={styles.empty}>
          This plugin hasn’t installed any skills yet. Skills you install from skills.sh will appear here.
        </p>
      )}

      {state.status === 'ready' && state.skills.length > 0 && (
        <ul style={styles.list} role="list">
          {state.skills.map((skill) => (
            <ManagedSkillRow key={skill.slug} skill={skill} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ManagedSkillRow({ skill }: { skill: ManagedSkillViewModel }) {
  return (
    <li style={styles.row} role="listitem">
      <div style={styles.rowMain}>
        <span style={styles.name}>{skill.slug}</span>
        <span style={styles.meta}>
          {skill.source} · installed {formatTimestamp(skill.installedAt)}
        </span>
        <span style={styles.status}>{skill.statusLabel}</span>
        {skill.badges.length > 0 && (
          <span style={styles.badges} role="list" aria-label="Status">
            {skill.badges.map((badge) => (
              <StatusBadge key={badge.label} badge={badge} />
            ))}
          </span>
        )}
      </div>

      {/* Stable action seams for the later #16/#17/#18 wiring. Disabled so no
          destructive action can fire from this section today; each seam is
          bound to its managed identifier (`id`/`slug`), never a path. */}
      <div style={styles.actions}>
        <button type="button" style={styles.action} disabled aria-label={`Update ${skill.id}`}>
          Update
        </button>
        <button type="button" style={styles.action} disabled aria-label={`Uninstall ${skill.slug}`}>
          Uninstall
        </button>
      </div>
    </li>
  );
}

function StatusBadge({ badge }: { badge: ManagedSkillBadge }) {
  return (
    <span
      role="listitem"
      style={{
        display: 'inline-block',
        fontSize: '11px',
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: '999px',
        background: BADGE_BACKGROUND[badge.tone],
        color: BADGE_COLOR[badge.tone],
        whiteSpace: 'nowrap',
      }}
    >
      {badge.label}
    </span>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <ul style={styles.list} role="list" aria-label="Loading managed skills">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} style={styles.row} aria-hidden>
          <div style={styles.rowMain}>
            <SkeletonBar minWidth="40%" />
            <SkeletonBar minWidth="60%" />
            <SkeletonBar minWidth="30%" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
