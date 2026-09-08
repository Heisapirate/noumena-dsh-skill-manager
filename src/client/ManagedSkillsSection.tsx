// The managed-skills section (Issue #15) with actionable update/uninstall
// (Issue #18). It renders only the view model the hook supplies plus the
// mutation store's scoped feedback; confirmation copy and action availability
// come from `managed/view.ts`, so no status/gating decision lives here.

import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  actionStyles,
  BusyButton,
  ConfirmPanel,
  ErrorNote,
  SuccessLabel,
} from './actions/controls';
import type { ActionKind, ActionState } from './actions/types';
import type { ManagedSkillBadge, ManagedSkillViewModel } from './managed/view';
import { uninstallConfirmation, updateConfirmation } from './managed/view';
import { SkeletonBar, SkeletonStyle } from './Skeleton';
import type { ManagedSkillsState } from './useManagedSkills';

interface ManagedSkillsSectionProps {
  state: ManagedSkillsState;
  onRefresh: () => void;
  actionState: (kind: ActionKind, target: string) => ActionState;
  onUpdate: (id: string, discardLocalChanges?: boolean) => void;
  onUninstall: (slug: string, options?: { confirm?: boolean; discardLocalChanges?: boolean }) => void;
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
  actions: { display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, alignItems: 'flex-end' },
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

export function ManagedSkillsSection({ state, onRefresh, actionState, onUpdate, onUninstall }: ManagedSkillsSectionProps) {
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
        <div style={styles.errorBox} role="alert">
          <p style={styles.message}>Could not load managed skills: {state.error.message}</p>
          {state.error.action === 'retry' && (
            <button type="button" style={styles.retry} onClick={onRefresh}>
              Retry
            </button>
          )}
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
            <ManagedSkillRow
              key={skill.slug}
              skill={skill}
              updateAction={actionState('update', skill.id)}
              uninstallAction={actionState('uninstall', skill.slug)}
              onUpdate={onUpdate}
              onUninstall={onUninstall}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface ManagedSkillRowProps {
  skill: ManagedSkillViewModel;
  updateAction: ActionState;
  uninstallAction: ActionState;
  onUpdate: (id: string, discardLocalChanges?: boolean) => void;
  onUninstall: (slug: string, options?: { confirm?: boolean; discardLocalChanges?: boolean }) => void;
}

function ManagedSkillRow({ skill, updateAction, uninstallAction, onUpdate, onUninstall }: ManagedSkillRowProps) {
  const [confirming, setConfirming] = useState<'update' | 'uninstall' | null>(null);

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

      <div style={styles.actions}>
        <ManagedAction
          kind="update"
          skill={skill}
          action={updateAction}
          confirming={confirming === 'update'}
          onStart={() => setConfirming('update')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            onUpdate(skill.id, updateConfirmation(skill).discardsLocalChanges);
          }}
        />
        <ManagedAction
          kind="uninstall"
          skill={skill}
          action={uninstallAction}
          confirming={confirming === 'uninstall'}
          onStart={() => setConfirming('uninstall')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            onUninstall(skill.slug, {
              confirm: true,
              discardLocalChanges: uninstallConfirmation(skill).discardsLocalChanges,
            });
          }}
        />
      </div>
    </li>
  );
}

type ManagedActionKind = 'update' | 'uninstall';

interface ManagedActionProps {
  kind: ManagedActionKind;
  skill: ManagedSkillViewModel;
  action: ActionState;
  confirming: boolean;
  onStart: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** One mutation button (update or uninstall) with its shared state cascade. */
function ManagedAction({ kind, skill, action, confirming, onStart, onCancel, onConfirm }: ManagedActionProps) {
  const isUpdate = kind === 'update';
  const confirmation = isUpdate ? updateConfirmation(skill) : uninstallConfirmation(skill);
  const busyLabel = isUpdate ? 'Updating…' : 'Uninstalling…';
  const primaryLabel = isUpdate ? 'Update' : 'Uninstall';
  const ariaLabel = isUpdate ? `Update ${skill.slug}` : `Uninstall ${skill.slug}`;
  const confirmAria = isUpdate ? `Confirm update ${skill.slug}` : `Confirm uninstall ${skill.slug}`;
  const disabled = isUpdate && !skill.canUpdate;

  if (action.status === 'pending') {
    return <BusyButton label={busyLabel} />;
  }
  if (confirming) {
    return (
      <ConfirmPanel
        ariaLabel={confirmAria}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  }
  if (action.status === 'success') {
    return <SuccessLabel message={action.message} />;
  }
  if (action.status === 'error' && action.error) {
    return (
      <div style={actionStyles.error}>
        <ErrorNote error={action.error} />
        {action.error.action === 'retry' && (
          <button type="button" style={actionStyles.button} onClick={onStart} aria-label={`Retry ${ariaLabel}`}>
            Retry
          </button>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      style={disabled ? actionStyles.disabledButton : actionStyles.button}
      disabled={disabled}
      onClick={onStart}
      aria-label={ariaLabel}
    >
      {primaryLabel}
    </button>
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
