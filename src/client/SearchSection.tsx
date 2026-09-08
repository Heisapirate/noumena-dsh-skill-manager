// The production search experience (Issue #13) plus the install action and its
// per-row states (Issue #18). This component only renders the engine's state and
// the mutation store's scoped feedback and forwards input — it owns no
// networking, no endpoint knowledge, and no state algorithm.

import { useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import {
  actionStyles,
  BusyButton,
  ConfirmPanel,
  ErrorNote,
  SuccessLabel,
} from './actions/controls';
import type { ActionKind, ActionState } from './actions/types';
import { SkeletonBar, SkeletonStyle } from './Skeleton';
import { presentError } from './copy';
import { searchRowAction } from './search/view';
import type { SearchResultRow, SearchSnapshot } from './search/types';

interface SearchSectionProps {
  state: SearchSnapshot;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  /** Slugs the plugin already manages, for the duplicate/already-installed state. */
  managedSlugs: ReadonlySet<string>;
  actionState: (kind: ActionKind, target: string) => ActionState;
  onInstall: (id: string, overwrite: boolean) => void;
}

const MIN_QUERY_LENGTH = 2;

const styles: Record<string, CSSProperties> = {
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '12px', fontWeight: 500, opacity: 0.85 },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '8px 10px',
    fontSize: '14px',
  },
  hint: { margin: 0, fontSize: '12px', opacity: 0.6 },
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
  description: { fontSize: '13px', opacity: 0.9 },
  unavailableText: { fontSize: '13px', opacity: 0.55, fontStyle: 'italic' },
  badge: {
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: '999px',
    background: 'rgba(255, 170, 0, 0.15)',
    color: '#b06a00',
    whiteSpace: 'nowrap',
  },
  installedBadge: {
    display: 'inline-block',
    fontSize: '11px',
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: '999px',
    background: 'rgba(40, 167, 69, 0.15)',
    color: '#1e7e34',
    whiteSpace: 'nowrap',
  },
  actions: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 },
  actionRow: { display: 'flex', alignItems: 'center', gap: '6px' },
  message: { margin: 0, fontSize: '13px' },
  errorBox: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' },
  retry: { cursor: 'pointer' },
};

export function SearchSection({ state, onQueryChange, onRetry, managedSlugs, actionState, onInstall }: SearchSectionProps) {
  // Local input mirror so the user can type freely (spaces, in-progress text)
  // while the engine debounces and commits trimmed queries.
  const [input, setInput] = useState('');

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setInput(value);
    onQueryChange(value);
  };

  return (
    <div role="search">
      <SkeletonStyle />
      <div style={styles.field}>
        <label htmlFor="skill-manager-search" style={styles.label}>
          Search skills.sh
        </label>
        <input
          id="skill-manager-search"
          type="search"
          style={styles.input}
          value={input}
          onChange={handleChange}
          placeholder="Search skills by keyword (e.g. python)"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="skill-manager-search-hint"
          aria-label="Search skills.sh"
        />
        <p id="skill-manager-search-hint" style={styles.hint}>
          Enter at least {MIN_QUERY_LENGTH} characters to search.
        </p>
      </div>

      <div aria-live="polite" aria-busy={state.status === 'loading'}>
        {state.status === 'idle' && (
          <p style={styles.hint}>Type a keyword to find skills to install.</p>
        )}

        {state.status === 'loading' && <ResultListSkeleton rows={4} />}

        {state.status === 'results' && (
          <ul style={styles.list} role="list">
            {state.results.map((row) => (
              <ResultRow
                key={row.id}
                row={row}
                managedSlugs={managedSlugs}
                action={actionState('install', row.id)}
                onInstall={onInstall}
              />
            ))}
          </ul>
        )}

        {state.status === 'empty' && (
          <p style={styles.message}>No skills found for “{state.query}”.</p>
        )}

        {state.status === 'error' && (
          <div style={styles.errorBox}>
            <p style={styles.message}>{presentError(state.error?.code).message}</p>
            <button type="button" style={styles.retry} onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ResultRowProps {
  row: SearchResultRow;
  managedSlugs: ReadonlySet<string>;
  action: ActionState;
  onInstall: (id: string, overwrite: boolean) => void;
}

function ResultRow({ row, managedSlugs, action, onInstall }: ResultRowProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li style={styles.row} role="listitem">
      <div style={styles.rowMain}>
        <span style={styles.name}>
          <a href={row.pageUrl} target="_blank" rel="noopener noreferrer">
            {row.name}
          </a>
        </span>
        <span style={styles.meta}>
          {row.source} · {formatInstalls(row.installs)} installs
        </span>
        <DescriptionSlot row={row} />
      </div>

      <InstallAction
        row={row}
        managedSlugs={managedSlugs}
        action={action}
        confirming={confirming}
        onStartConfirm={() => setConfirming(true)}
        onCancelConfirm={() => setConfirming(false)}
        onConfirmOverwrite={() => {
          setConfirming(false);
          onInstall(row.id, true);
        }}
        onInstall={() => onInstall(row.id, false)}
      />
    </li>
  );
}

interface InstallActionProps {
  row: SearchResultRow;
  managedSlugs: ReadonlySet<string>;
  action: ActionState;
  confirming: boolean;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirmOverwrite: () => void;
  onInstall: () => void;
}

function InstallAction({
  row,
  managedSlugs,
  action,
  confirming,
  onStartConfirm,
  onCancelConfirm,
  onConfirmOverwrite,
  onInstall,
}: InstallActionProps) {
  const decision = searchRowAction(row, managedSlugs);

  if (decision.kind === 'unavailable') {
    return <span style={styles.badge}>Unavailable source</span>;
  }

  if (action.status === 'pending') {
    return <BusyButton label="Installing…" />;
  }

  if (action.status === 'success') {
    return <SuccessLabel message={action.message} />;
  }

  if (action.status === 'error' && action.error) {
    return <InstallError error={action.error} onReplace={onStartConfirm} onRetryInstall={onInstall} />;
  }

  if (confirming) {
    return (
      <ConfirmPanel
        ariaLabel={`Confirm replace ${row.name}`}
        message="Reinstalling replaces the installed version of this skill."
        confirmLabel="Replace"
        onConfirm={onConfirmOverwrite}
        onCancel={onCancelConfirm}
      />
    );
  }

  if (decision.kind === 'overwrite') {
    return (
      <div style={styles.actionRow}>
        <span style={styles.installedBadge}>Installed</span>
        <button
          type="button"
          style={actionStyles.button}
          onClick={onStartConfirm}
          aria-label={`Replace ${row.name}`}
        >
          Replace
        </button>
      </div>
    );
  }

  return (
    <button type="button" style={actionStyles.button} onClick={onInstall} aria-label={`Install ${row.name}`}>
      Install
    </button>
  );
}

/**
 * The scoped install-error rendering. `confirm` re-opens the overwrite
 * confirmation (defensive duplicate from a stale managed list); `retry` safely
 * re-runs the plain install; `none` renders copy only — a refusal is never
 * presented as retryable (spec §12 "retry / confirm / nothing").
 */
function InstallError({
  error,
  onReplace,
  onRetryInstall,
}: {
  error: { message: string; action: 'retry' | 'confirm' | 'none' };
  onReplace: () => void;
  onRetryInstall: () => void;
}) {
  return (
    <div style={actionStyles.error}>
      <ErrorNote error={error} />
      {error.action === 'confirm' && (
        <button type="button" style={actionStyles.button} onClick={onReplace}>
          Replace
        </button>
      )}
      {error.action === 'retry' && (
        <button type="button" style={actionStyles.button} onClick={onRetryInstall}>
          Retry
        </button>
      )}
    </div>
  );
}

function DescriptionSlot({ row }: { row: SearchResultRow }) {
  const { description } = row;
  if (description.status === 'loaded') {
    const text = description.text?.trim();
    if (!text) return <span style={styles.description}>No description provided.</span>;
    return <span style={styles.description}>{text}</span>;
  }
  if (description.status === 'unavailable') {
    return <span style={styles.unavailableText}>Description unavailable.</span>;
  }
  // `idle` and `loading` both show a skeleton until the description arrives.
  return <SkeletonBar label="Loading description" />;
}

function ResultListSkeleton({ rows }: { rows: number }) {
  return (
    <ul style={styles.list} role="list" aria-label="Loading results">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} style={styles.row} aria-hidden>
          <div style={styles.rowMain}>
            <SkeletonBar minWidth="50%" />
            <SkeletonBar minWidth="30%" />
            <SkeletonBar minWidth="60%" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function formatInstalls(value: number): string {
  try {
    return value.toLocaleString('en-US');
  } catch {
    return String(value);
  }
}
