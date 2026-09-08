// The production search experience (Issue #13): a debounced, accessible search
// input plus the result list with immediate basic fields and progressive,
// per-row description slots. This component only renders the engine's state and
// forwards input — it owns no networking, no endpoint knowledge, and no
// install/update/uninstall actions (those are #14/#16/#17).

import { useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import type { SearchResultRow, SearchSnapshot } from './search/types';

interface SearchSectionProps {
  state: SearchSnapshot;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
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
  message: { margin: 0, fontSize: '13px' },
  errorBox: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' },
  retry: { cursor: 'pointer' },
};

/** A subtle shimmer skeleton bar for a description slot still loading. */
const SKELETON_CSS = `
.dsh-sm-skeleton {
  display: inline-block;
  height: 1em;
  min-width: 40%;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.25);
  animation: dsh-sm-shimmer 1.4s ease-in-out infinite;
}
@keyframes dsh-sm-shimmer {
  0% { opacity: 0.5; }
  50% { opacity: 1; }
  100% { opacity: 0.5; }
}
`;

export function SearchSection({ state, onQueryChange, onRetry }: SearchSectionProps) {
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
      <style>{SKELETON_CSS}</style>
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
              <ResultRow key={row.id} row={row} />
            ))}
          </ul>
        )}

        {state.status === 'empty' && (
          <p style={styles.message}>No skills found for “{state.query}”.</p>
        )}

        {state.status === 'error' && (
          <div style={styles.errorBox}>
            <p style={styles.message}>{errorCopy(state.error?.code)}</p>
            <button type="button" style={styles.retry} onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultRow({ row }: { row: SearchResultRow }) {
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
      {/* Stable container for the install action (#14); today only the
          installability state lives here. */}
      {!row.installable && <span style={styles.badge}>Unavailable source</span>}
    </li>
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
  return <span className="dsh-sm-skeleton" aria-label="Loading description" role="status" />;
}

function ResultListSkeleton({ rows }: { rows: number }) {
  return (
    <ul style={styles.list} role="list" aria-label="Loading results">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index} style={styles.row} aria-hidden>
          <div style={styles.rowMain}>
            <span className="dsh-sm-skeleton" style={{ minWidth: '50%' }} />
            <span className="dsh-sm-skeleton" style={{ minWidth: '30%' }} />
            <span className="dsh-sm-skeleton" style={{ minWidth: '60%' }} />
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

/** Map a normalized search-failure code to short, non-leaking user copy. */
function errorCopy(code: string | undefined): string {
  switch (code) {
    case 'network-unavailable':
      return 'Could not reach skills.sh. Check your network connection and retry.';
    case 'timeout':
      return 'The search timed out. Please retry.';
    case 'rate-limited':
      return 'skills.sh rate-limited this search. Please wait a moment and retry.';
    case 'registry-unavailable':
    case 'http-error':
    case 'malformed-response':
      return 'skills.sh is temporarily unavailable. Please retry.';
    default:
      return 'Something went wrong while searching. Please retry.';
  }
}
