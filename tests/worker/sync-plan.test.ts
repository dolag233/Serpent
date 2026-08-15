import { describe, expect, it } from 'vitest';

import { createEmptyManifest, type SyncManifestEntry } from '../../src/worker/sync/manifest';
import { planSyncActions, type LocalAssetSnapshotEntry } from '../../src/worker/sync/sync-plan';

function manifest(): ReturnType<typeof createEmptyManifest> {
  return createEmptyManifest({ libraryId: 'lib-1', displayName: '库', directoryName: '库' });
}

function entry(overrides: Partial<SyncManifestEntry> = {}): SyncManifestEntry {
  return {
    path: 'a/b.png',
    contentHash: 'hash-1',
    size: 10,
    version: 1,
    deviceId: 'dev-1',
    modifiedAt: '2026-08-15T10:00:00Z',
    metadataVersion: 1,
    ...overrides,
  };
}

function asset(hash = 'hash-1', size = 10): LocalAssetSnapshotEntry {
  return { contentHash: hash, size, modifiedAt: '2026-08-15T10:00:00Z' };
}

describe('planSyncActions (Serpent-xffq)', () => {
  it('plans upload for a brand-new local asset', () => {
    const localManifest = manifest();
    const remoteManifest = manifest();
    const actions = planSyncActions({
      localAssets: new Map([['a1', asset()]]),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(),
    });
    expect(actions).toEqual([
      expect.objectContaining({ type: 'upload', assetId: 'a1' }),
    ]);
  });

  it('plans download for a remote-only asset (new device)', () => {
    const remoteManifest = manifest();
    remoteManifest.entries.a1 = entry({});
    const actions = planSyncActions({
      localAssets: new Map(),
      localManifest: manifest(),
      remoteManifest,
      remoteTombstones: new Set(),
    });
    expect(actions).toEqual([
      expect.objectContaining({ type: 'download', assetId: 'a1' }),
    ]);
  });

  it('plans upload when only the local side changed', () => {
    const localManifest = manifest();
    localManifest.entries.a1 = entry({ contentHash: 'hash-1' });
    const remoteManifest = manifest();
    remoteManifest.entries.a1 = entry({ contentHash: 'hash-1' });
    const actions = planSyncActions({
      localAssets: new Map([['a1', asset('hash-2')]]),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(),
    });
    expect(actions).toEqual([
      expect.objectContaining({ type: 'upload', assetId: 'a1', entry: expect.objectContaining({ contentHash: 'hash-2', version: 2 }) }),
    ]);
  });

  it('plans download when only the remote side changed', () => {
    const localManifest = manifest();
    localManifest.entries.a1 = entry({ contentHash: 'hash-1' });
    const remoteManifest = manifest();
    remoteManifest.entries.a1 = entry({ contentHash: 'hash-2', version: 2 });
    const actions = planSyncActions({
      localAssets: new Map([['a1', asset('hash-1')]]),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(),
    });
    expect(actions).toEqual([
      expect.objectContaining({ type: 'download', assetId: 'a1' }),
    ]);
  });

  it('detects a true conflict when both sides changed differently', () => {
    const localManifest = manifest();
    localManifest.entries.a1 = entry({ contentHash: 'hash-1' });
    const remoteManifest = manifest();
    remoteManifest.entries.a1 = entry({ contentHash: 'hash-1' });
    const actions = planSyncActions({
      localAssets: new Map([['a1', asset('hash-local', 20)]]),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(),
    });
    // 远端也改了：把远端 manifest 变为 hash-2。
    const actionsWithRemoteChange = planSyncActions({
      localAssets: new Map([['a1', asset('hash-local', 20)]]),
      localManifest,
      remoteManifest: (() => {
        const remote = manifest();
        remote.entries.a1 = entry({ contentHash: 'hash-remote', version: 5, modifiedAt: '2026-08-15T12:00:00Z' });
        return remote;
      })(),
      remoteTombstones: new Set(),
    });
    expect(actionsWithRemoteChange).toEqual([
      expect.objectContaining({ type: 'conflict', assetId: 'a1', winner: 'remote' }),
    ]);
    expect(actions).toEqual([
      expect.objectContaining({ type: 'upload', assetId: 'a1' }),
    ]);
  });

  it('plans remote delete + tombstone upload for a local deletion', () => {
    const localManifest = manifest();
    localManifest.entries.a1 = entry({});
    const remoteManifest = manifest();
    remoteManifest.entries.a1 = entry({});
    const actions = planSyncActions({
      localAssets: new Map(),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(),
    });
    expect(actions).toEqual([
      expect.objectContaining({ type: 'delete-remote', assetId: 'a1' }),
      expect.objectContaining({ type: 'tombstone-upload', assetId: 'a1' }),
    ]);
  });

  it('plans local recycle for a remote tombstone', () => {
    const localManifest = manifest();
    localManifest.entries.a1 = entry({});
    const remoteManifest = manifest();
    remoteManifest.entries.a1 = entry({});
    const actions = planSyncActions({
      localAssets: new Map([['a1', asset()]]),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(['a1']),
    });
    expect(actions).toEqual([
      expect.objectContaining({ type: 'delete-local', assetId: 'a1' }),
    ]);
  });

  it('plans nothing when both sides are unchanged and consistent', () => {
    const localManifest = manifest();
    localManifest.entries.a1 = entry({});
    const remoteManifest = manifest();
    remoteManifest.entries.a1 = entry({});
    const actions = planSyncActions({
      localAssets: new Map([['a1', asset()]]),
      localManifest,
      remoteManifest,
      remoteTombstones: new Set(),
    });
    expect(actions).toEqual([]);
  });
});
