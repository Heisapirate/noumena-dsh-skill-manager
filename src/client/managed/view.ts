// Pure view-model mapping for the managed-skills section (Issue #15). The host
// returns a `ManagedSkill` carrying the accepted `UpdateStatus`; this module is
// the single place that maps a status to user-facing copy and badges, so the
// React renderer only displays the view model and never re-derives status.

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
