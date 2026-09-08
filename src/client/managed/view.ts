// Pure view-model mapping for the managed-skills section (Issue #15, #18). The
// host returns a `ManagedSkill` carrying the accepted `UpdateStatus` plus the
// two independent change flags; this module is the single place that maps a
// status to user-facing copy, badges, and action availability, so the React
// renderer only displays the view model and never re-derives status or gating.

import type { ManagedSkill, UpdateStatus } from '../../types';

/** Visual tone for a status badge; `danger` is reserved for source-unavailable. */
export type ManagedBadgeTone = 'ok' | 'warning' | 'danger' | 'muted';

/** A single user-facing badge on a managed-skill row. */
export interface ManagedSkillBadge {
  label: string;
  tone: ManagedBadgeTone;
}

/** The ready-to-render view of one managed skill. */
export interface ManagedSkillViewModel {
  /** The kebab-case skill name (manifest key; the uninstall identifier). */
  slug: string;
  /** Provenance (`owner/repo`). */
  source: string;
  /** Full skills.sh id (`owner/repo/slug`; the update identifier). */
  id: string;
  /** ISO-8601 original install time. */
  installedAt: string;
  /** Short human-readable status line. */
  statusLabel: string;
  /** Badges to render; may be empty. */
  badges: ManagedSkillBadge[];
  /** Recomputed `localContentHash` differs from the recorded one (local drift). */
  localModified: boolean;
  /** Whether an update action is offered (only for update-available states). */
  canUpdate: boolean;
}

/** A destructive-action confirmation, derived once and rendered as inline UI. */
export interface ManagedActionConfirmation {
  /** One-sentence consequence of confirming. */
  message: string;
  /** Label for the confirming button. */
  confirmLabel: string;
  /** Whether confirming discards local modifications (extra acknowledgment). */
  discardsLocalChanges: boolean;
}

/** Map a host `ManagedSkill` to its user-facing view model. */
export function toManagedSkillViewModel(skill: ManagedSkill): ManagedSkillViewModel {
  const presentation = statusPresentation(skill.status);
  return {
    slug: skill.slug,
    source: skill.source,
    id: skill.id,
    installedAt: skill.installedAt,
    statusLabel: presentation.label,
    badges: presentation.badges,
    localModified: skill.localModified,
    canUpdate: skill.updateAvailable,
  };
}

/** The confirmation shown before an update replaces a managed skill's files. */
export function updateConfirmation(vm: ManagedSkillViewModel): ManagedActionConfirmation {
  return {
    message: vm.localModified
      ? 'Updating will replace this skill and discard your local changes.'
      : 'Updating will replace this skill with the latest version.',
    confirmLabel: vm.localModified ? 'Update & discard changes' : 'Update',
    discardsLocalChanges: vm.localModified,
  };
}

/** The confirmation shown before an uninstall removes a managed skill. */
export function uninstallConfirmation(vm: ManagedSkillViewModel): ManagedActionConfirmation {
  return {
    message: vm.localModified
      ? 'Uninstalling will remove this skill and discard your local changes.'
      : 'Uninstalling will remove this skill from this machine.',
    confirmLabel: vm.localModified ? 'Uninstall & discard changes' : 'Uninstall',
    discardsLocalChanges: vm.localModified,
  };
}

function statusPresentation(status: UpdateStatus): { label: string; badges: ManagedSkillBadge[] } {
  switch (status) {
    case 'up-to-date':
      return { label: 'Up to date', badges: [{ label: 'Managed', tone: 'ok' }] };
    case 'update-available':
      return { label: 'Update available', badges: [{ label: 'Update available', tone: 'warning' }] };
    case 'locally-modified':
      return { label: 'Locally modified', badges: [{ label: 'Locally modified', tone: 'warning' }] };
    case 'update-available-and-locally-modified':
      return {
        label: 'Update available · locally modified',
        badges: [
          { label: 'Update available', tone: 'warning' },
          { label: 'Locally modified', tone: 'warning' },
        ],
      };
    case 'source-unavailable':
      return { label: 'Source unavailable', badges: [{ label: 'Source unavailable', tone: 'danger' }] };
    case 'remote-check-failure':
      return { label: 'Status unavailable', badges: [{ label: 'Status unavailable', tone: 'muted' }] };
    default:
      // Defensive: an unexpected host status must degrade this one row, never
      // crash the whole section (spec §13 per-item degradation).
      return { label: 'Status unknown', badges: [{ label: 'Status unknown', tone: 'muted' }] };
  }
}
