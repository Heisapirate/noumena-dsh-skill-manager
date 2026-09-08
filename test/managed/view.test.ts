// View-model mapping for the managed-skills UI (Issue #15). The host returns a
// `ManagedSkill` with the accepted `UpdateStatus`; this module maps it to the
// user-facing copy and badges in exactly one place, so the React renderer stays
// free of status decisions.

import { describe, expect, it } from 'vitest';
import { toManagedSkillViewModel } from '../../src/client/managed/view';
import type { ManagedSkill, UpdateStatus } from '../../src/types';

function skill(overrides: Partial<ManagedSkill> = {}): ManagedSkill {
  return {
    slug: 'find-skills',
    source: 'owner/repo',
    id: 'owner/repo/find-skills',
    remoteSourceHash: 'opaque-v1',
    localContentHash: 'a'.repeat(64),
    installedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    status: 'up-to-date',
    localModified: false,
    updateAvailable: false,
    ...overrides,
  };
}

describe('toManagedSkillViewModel', () => {
  it('preserves provenance and managed identifiers', () => {
    const vm = toManagedSkillViewModel(skill());
    expect(vm).toMatchObject({
      slug: 'find-skills',
      source: 'owner/repo',
      id: 'owner/repo/find-skills',
      installedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('maps up-to-date to a managed badge', () => {
    const vm = toManagedSkillViewModel(skill({ status: 'up-to-date' }));
    expect(vm.statusLabel).toBe('Up to date');
    expect(vm.badges).toEqual([{ label: 'Managed', tone: 'ok' }]);
  });

  it('maps update-available to an update badge', () => {
    const vm = toManagedSkillViewModel(skill({ status: 'update-available', updateAvailable: true }));
    expect(vm.statusLabel).toBe('Update available');
    expect(vm.badges).toEqual([{ label: 'Update available', tone: 'warning' }]);
  });

  it('maps locally-modified to a drift badge', () => {
    const vm = toManagedSkillViewModel(skill({ status: 'locally-modified', localModified: true }));
    expect(vm.statusLabel).toBe('Locally modified');
    expect(vm.badges).toEqual([{ label: 'Locally modified', tone: 'warning' }]);
  });

  it('maps the combined state to two badges', () => {
    const vm = toManagedSkillViewModel(
      skill({ status: 'update-available-and-locally-modified', updateAvailable: true, localModified: true }),
    );
    expect(vm.statusLabel).toBe('Update available · locally modified');
    expect(vm.badges).toEqual([
      { label: 'Update available', tone: 'warning' },
      { label: 'Locally modified', tone: 'warning' },
    ]);
  });

  it('flags an unavailable source as danger', () => {
    const vm = toManagedSkillViewModel(skill({ status: 'source-unavailable' }));
    expect(vm.statusLabel).toBe('Source unavailable');
    expect(vm.badges).toEqual([{ label: 'Source unavailable', tone: 'danger' }]);
  });

  it('maps a remote-check failure to a muted, non-alarming state', () => {
    const vm = toManagedSkillViewModel(skill({ status: 'remote-check-failure' }));
    expect(vm.statusLabel).toBe('Status unavailable');
    expect(vm.badges).toEqual([{ label: 'Status unavailable', tone: 'muted' }]);
  });

  it('degrades an unexpected status to a muted unknown state instead of throwing', () => {
    const vm = toManagedSkillViewModel(skill({ status: 'unexpected-host-status' as UpdateStatus }));
    expect(vm.statusLabel).toBe('Status unknown');
    expect(vm.badges).toEqual([{ label: 'Status unknown', tone: 'muted' }]);
  });
});
