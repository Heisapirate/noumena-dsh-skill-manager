// The production search experience (Issue #13) plus the install action and its
// per-row states (Issue #18). This component only renders the engine's state and
// the mutation store's scoped feedback and forwards input — it owns no
// networking, no endpoint knowledge, and no state algorithm.

import { useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
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
  button: { cursor: 'pointer' },
  disabledButton: { cursor: 'default', opacity: 0.6 },
  confirm: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '6px',
    fontSize: '12px',
    maxWidth: '220px',
  },
  confirmText: { margin: 0, fontSize: '12px', opacity: 0.85, textAlign: 'right' },
  success: { fontSize: '12px', color: '#1e7e34', fontWeight: 600 },
  error: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' },
  errorText: { margin: 0, fontSize: '12px', color: '#b02a37', textAlign: 'right' },
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
  const decision = searchRowAction(row, managedSlugs);

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

      <div style={styles.actions}>
        <InstallAction
          row={row}
          decision={decision}
          action={action}
          confirming={confirming}
          onStartConfirm={() => setConfirming(true)}
          onCancelConfirm={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onInstall(row.id, true);
          }}
          onInstall={() => onInstall(row.id, false)}
        />
      </div>
    </li>
  );
}

interface InstallActionProps {
  row: SearchResultRow;
  decision: ReturnType<typeof searchRowAction>;
  action: ActionState;
  confirming: boolean;
  onStartConfirm: () => void;
  onCancelConfirm: () => void;
  onConfirm: () => void;
  onInstall: () => void;
}

function InstallAction(props: InstallActionProps) {
  const { row, decision, action, confirming, onStartConfirm, onCancelConfirm, onConfirm, onInstall } = props;

  if (decision.kind === 'unavailable') {
    return <span style={styles.badge}>Unavailable source</span>;
  }

  if (action.status === 'pending') {
    return (
      <button type="button" style={styles.disabledButton} disabled aria-busy>
        Installing…
      </button>
    );
  }

  if (action.status === 'success') {
    return (
      <span role="status" style={styles.success}>
        ✓ {action.message}
      </span>
    );
  }

  if (action.status === 'error') {
    const retryOverwrite = decision.kind === 'overwrite' || action.error?.action === 'confirm';
    return (
      <div style={styles.error}>
        <p style={styles.errorText}>{action.error?.message}</p>
        <button
          type="button"
          style={styles.button}
          onClick={() => (retryOverwrite ? onConfirm() : onInstall())}
          aria-label={retryOverwrite ? `Replace ${row.name}` : `Install ${row.name}`}
        >
          {retryOverwrite ? 'Replace' : 'Retry'}
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div style={styles.confirm} role="group" aria-label={`Confirm replace ${row.name}`}>
        <p style={styles.confirmText}>Reinstalling replaces the installed version of this skill.</p>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" style={styles.button} onClick={onConfirm}>
            Replace
          </button>
          <button type="button" style={styles.button} onClick={onCancelConfirm}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (decision.kind === 'overwrite') {
    return (
      <>
        <span style={styles.installedBadge}>Installed</span>
        <button
          type="button"
          style={styles.button}
          onClick={onStartConfirm}
          aria-label={`Replace ${row.name}`}
        >
          Replace
        </button>
      </>
    );
  }

  return (
    <button type="button" style={styles.button} onClick={onInstall} aria-label={`Install ${row.name}`}>
      Install
    </button>
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
