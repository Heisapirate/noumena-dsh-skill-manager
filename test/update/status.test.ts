import { describe, expect, it } from 'vitest';
import type { RemoteSourceHash, LocalContentHash, SkillManifestEntry } from '../../src/manifest';
import { buildUpdateInfo, deriveUpdateStatus } from '../../src/update/status';

const remote = (s: string): RemoteSourceHash => s as RemoteSourceHash;
const local = (s: string): LocalContentHash => s as LocalContentHash;

function entry(overrides: Partial<SkillManifestEntry> = {}): SkillManifestEntry {
  return {
    source: 'owner/repo',
    slug: 'find-skills',
    remoteSourceHash: remote('opaque-v1'),
    localContentHash: local('a'.repeat(64)),
    installedAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveUpdateStatus', () => {
  it('reports up-to-date when both hashes match', () => {
    expect(
      deriveUpdateStatus({
        recordedRemoteSourceHash: 'opaque-v1',
        latestRemoteSourceHash: 'opaque-v1',
        recordedLocalContentHash: 'a'.repeat(64),
        currentLocalContentHash: 'a'.repeat(64),
      }),
    ).toBe('up-to-date');
  });

  it('reports update-available when only the remote hash changed', () => {
    expect(
      deriveUpdateStatus({
        recordedRemoteSourceHash: 'opaque-v1',
        latestRemoteSourceHash: 'opaque-v2',
        recordedLocalContentHash: 'a'.repeat(64),
        currentLocalContentHash: 'a'.repeat(64),
      }),
    ).toBe('update-available');
  });

  it('reports locally-modified when only the local content drifted', () => {
    expect(
      deriveUpdateStatus({
        recordedRemoteSourceHash: 'opaque-v1',
        latestRemoteSourceHash: 'opaque-v1',
        recordedLocalContentHash: 'a'.repeat(64),
        currentLocalContentHash: 'b'.repeat(64),
      }),
    ).toBe('locally-modified');
  });

  it('reports update-available-and-locally-modified when both axes differ', () => {
    expect(
      deriveUpdateStatus({
        recordedRemoteSourceHash: 'opaque-v1',
        latestRemoteSourceHash: 'opaque-v2',
        recordedLocalContentHash: 'a'.repeat(64),
        currentLocalContentHash: 'b'.repeat(64),
      }),
    ).toBe('update-available-and-locally-modified');
  });

  it('reports source-unavailable when the remote check returned source-unavailable', () => {
    expect(
      deriveUpdateStatus({
        recordedRemoteSourceHash: 'opaque-v1',
        latestRemoteSourceHash: null,
        recordedLocalContentHash: 'a'.repeat(64),
        currentLocalContentHash: 'a'.repeat(64),
        remoteError: { code: 'source-unavailable' },
      }),
    ).toBe('source-unavailable');
  });

  it('reports remote-check-failure for any other remote failure', () => {
    expect(
      deriveUpdateStatus({
        recordedRemoteSourceHash: 'opaque-v1',
        latestRemoteSourceHash: null,
        recordedLocalContentHash: 'a'.repeat(64),
        currentLocalContentHash: 'a'.repeat(64),
        remoteError: { code: 'network-unavailable' },
      }),
    ).toBe('remote-check-failure');
  });

  it('never lets a matching remote hash mask remote failure', () => {
    // A failed check must not be reported as up-to-date even if the caller
    // passed a stale "latest" value alongside the error.
    expect(
      deriveUpdateStatus({
        recordedRemoteSourceHash: 'opaque-v1',
        latestRemoteSourceHash: 'opaque-v1',
        recordedLocalContentHash: 'a'.repeat(64),
        currentLocalContentHash: 'a'.repeat(64),
        remoteError: { code: 'timeout' },
      }),
    ).toBe('remote-check-failure');
  });
});

describe('buildUpdateInfo', () => {
  it('derives status and booleans without cross-comparing the two hashes', () => {
    const info = buildUpdateInfo({
      slug: 'find-skills',
      entry: entry({ remoteSourceHash: remote('opaque-v1') }),
      latestRemoteSourceHash: 'opaque-v2',
      currentLocalContentHash: 'b'.repeat(64),
    });

    expect(info).toEqual({
      slug: 'find-skills',
      status: 'update-available-and-locally-modified',
      updateAvailable: true,
      upstreamChanged: true,
      localModified: true,
      recordedRemoteSourceHash: 'opaque-v1',
      recordedLocalContentHash: 'a'.repeat(64),
      latestRemoteSourceHash: 'opaque-v2',
      currentLocalContentHash: 'b'.repeat(64),
    });
  });

  it('omits the observed fields when a check did not succeed', () => {
    const info = buildUpdateInfo({
      slug: 'find-skills',
      entry: entry(),
      latestRemoteSourceHash: null,
      currentLocalContentHash: null,
      remoteError: { code: 'network-unavailable', message: 'offline', details: {} },
    });

    expect(info).toEqual({
      slug: 'find-skills',
      status: 'remote-check-failure',
      updateAvailable: false,
      upstreamChanged: false,
      localModified: false,
      recordedRemoteSourceHash: 'opaque-v1',
      recordedLocalContentHash: 'a'.repeat(64),
      error: { code: 'network-unavailable', message: 'offline', details: {} },
    });
  });
});
