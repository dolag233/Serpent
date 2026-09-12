import { describe, expect, it } from 'vitest';

import {
  deriveSyncCardStatus,
  isLocalSyncPending,
  overlaySyncCardStatus,
} from '../../src/shared/sync-card-status';

const emptyHash = 'empty-meta';

describe('isLocalSyncPending', () => {
  it('treats missing cache entries as pending', () => {
    expect(isLocalSyncPending({
      hasCacheEntry: false,
      localPath: 'a.png',
      localSize: 12,
      localMetadataHash: emptyHash,
      emptyMetadataHash: emptyHash,
    })).toBe(true);
  });

  it('treats matching path, size, and metadata as synced', () => {
    expect(isLocalSyncPending({
      hasCacheEntry: true,
      localPath: 'folder/a.png',
      cachePath: 'folder/a.png',
      localSize: 12,
      cacheSize: 12,
      localMetadataHash: 'meta-1',
      cacheMetadataHash: 'meta-1',
      emptyMetadataHash: emptyHash,
    })).toBe(false);
  });

  it('detects path moves and size changes without hashing file bytes', () => {
    expect(isLocalSyncPending({
      hasCacheEntry: true,
      localPath: 'b.png',
      cachePath: 'a.png',
      localSize: 12,
      cacheSize: 12,
      localMetadataHash: emptyHash,
      cacheMetadataHash: emptyHash,
      emptyMetadataHash: emptyHash,
    })).toBe(true);
    expect(isLocalSyncPending({
      hasCacheEntry: true,
      localPath: 'a.png',
      cachePath: 'a.png',
      localSize: 20,
      cacheSize: 12,
      localMetadataHash: emptyHash,
      cacheMetadataHash: emptyHash,
      emptyMetadataHash: emptyHash,
    })).toBe(true);
  });

  it('treats unsynced sidecar metadata as pending when cache has no metadataHash', () => {
    expect(isLocalSyncPending({
      hasCacheEntry: true,
      localPath: 'a.png',
      cachePath: 'a.png',
      localSize: 12,
      cacheSize: 12,
      localMetadataHash: 'tags-changed',
      emptyMetadataHash: emptyHash,
    })).toBe(true);
    expect(isLocalSyncPending({
      hasCacheEntry: true,
      localPath: 'a.png',
      cachePath: 'a.png',
      localSize: 12,
      cacheSize: 12,
      localMetadataHash: emptyHash,
      emptyMetadataHash: emptyHash,
    })).toBe(false);
  });
});

describe('deriveSyncCardStatus', () => {
  it('hides synced, linked, and ineligible assets', () => {
    expect(deriveSyncCardStatus({
      eligible: false,
      pending: true,
      syncing: true,
      conflict: true,
    })).toBeNull();
    expect(deriveSyncCardStatus({
      eligible: true,
      pending: false,
      syncing: false,
      conflict: false,
    })).toBeNull();
  });

  it('ranks conflict above syncing above pending', () => {
    expect(deriveSyncCardStatus({
      eligible: true,
      pending: true,
      syncing: true,
      conflict: true,
    })).toBe('conflict');
    expect(deriveSyncCardStatus({
      eligible: true,
      pending: true,
      syncing: true,
      conflict: false,
    })).toBe('syncing');
    expect(deriveSyncCardStatus({
      eligible: true,
      pending: true,
      syncing: false,
      conflict: false,
    })).toBe('pending');
  });
});

describe('overlaySyncCardStatus', () => {
  it('turns pending into syncing while a run is in flight', () => {
    expect(overlaySyncCardStatus('pending', true)).toBe('syncing');
    expect(overlaySyncCardStatus('pending', false)).toBe('pending');
    expect(overlaySyncCardStatus('conflict', true)).toBe('conflict');
    expect(overlaySyncCardStatus(undefined, true)).toBeNull();
  });
});
