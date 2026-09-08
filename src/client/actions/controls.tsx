// Shared presentational pieces for mutation actions (Issue #18). The pending /
// success / error / confirm states are rendered here once so the search and
// managed sections never re-implement the same state cascade or copy — the
// store owns the state, these components only render it.

import type { CSSProperties } from 'react';
import type { ErrorPresentation } from '../copy';

export const actionStyles: Record<string, CSSProperties> = {
  button: { cursor: 'pointer' },
  disabledButton: { cursor: 'default', opacity: 0.6 },
  confirm: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '6px',
    fontSize: '12px',
    maxWidth: '240px',
  },
  confirmText: { margin: 0, fontSize: '12px', opacity: 0.85, textAlign: 'right' },
  confirmButtons: { display: 'flex', gap: '6px' },
  success: { fontSize: '12px', color: '#1e7e34', fontWeight: 600 },
  error: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' },
  errorText: { margin: 0, fontSize: '12px', color: '#b02a37', textAlign: 'right' },
};

/** A disabled, in-progress button for a mutation in flight. */
export function BusyButton({ label }: { label: string }) {
  return (
    <button type="button" style={actionStyles.disabledButton} disabled aria-busy>
      {label}
    </button>
  );
}

/** The scoped success note shown after a mutation settles. */
export function SuccessLabel({ message }: { message: string | null }) {
  return (
    <span role="status" style={actionStyles.success}>
      ✓ {message}
    </span>
  );
}

/** The scoped, non-leaking error note shown after a mutation fails. */
export function ErrorNote({ error }: { error: ErrorPresentation }) {
  return <p style={actionStyles.errorText}>{error.message}</p>;
}

/** An inline destructive-action confirmation (never a modal). */
export function ConfirmPanel({
  ariaLabel,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  ariaLabel: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={actionStyles.confirm} role="group" aria-label={ariaLabel}>
      <p style={actionStyles.confirmText}>{message}</p>
      <div style={actionStyles.confirmButtons}>
        <button type="button" style={actionStyles.button} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" style={actionStyles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
