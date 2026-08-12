import { describe, expect, it, vi } from 'vitest';

import {
  boundedWriteLibraryId,
  executeBoundedWriteWorkerCommand,
} from '../../src/worker/bounded-write-command';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { LibraryService } from '../../src/worker/library-service';

const libraryId = '11111111-1111-4111-8111-111111111111';

describe('boundedWriteLibraryId', () => {
  it('puts Desktop and Script/MCP metadata writes behind the shared per-library lease', () => {
    expect(boundedWriteLibraryId({
      type: 'asset.rating.set',
      libraryId,
      assetIds: ['22222222-2222-4222-8222-222222222222'],
      rating: 4,
    } satisfies WorkerCommand)).toBe(libraryId);
    expect(boundedWriteLibraryId({
      type: 'tag.create',
      libraryId,
      name: 'Phase-D',
    } satisfies WorkerCommand)).toBe(libraryId);
    expect(boundedWriteLibraryId({
      type: 'tag.assign',
      libraryId,
      assetIds: ['22222222-2222-4222-8222-222222222222'],
      tagIds: ['33333333-3333-4333-8333-333333333333'],
    } satisfies WorkerCommand)).toBe(libraryId);
    expect(boundedWriteLibraryId({
      type: 'tag.remove',
      libraryId,
      assetIds: ['22222222-2222-4222-8222-222222222222'],
      tagIds: ['33333333-3333-4333-8333-333333333333'],
    } satisfies WorkerCommand)).toBe(libraryId);
    expect(boundedWriteLibraryId({
      type: 'folder.create',
      libraryId,
      name: 'Empty',
    } satisfies WorkerCommand)).toBe(libraryId);
    expect(boundedWriteLibraryId({
      type: 'asset.metadata.set',
      libraryId,
      assetId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 0,
      favorite: true,
    } satisfies WorkerCommand)).toBe(libraryId);
    expect(boundedWriteLibraryId({
      type: 'collection.create',
      libraryId,
      name: 'Board',
    } satisfies WorkerCommand)).toBe(libraryId);
    expect(boundedWriteLibraryId({
      type: 'collection.assets.add',
      libraryId,
      collectionId: '44444444-4444-4444-8444-444444444444',
      assetIds: ['22222222-2222-4222-8222-222222222222'],
    } satisfies WorkerCommand)).toBe(libraryId);
    expect(boundedWriteLibraryId({
      type: 'collection.assets.remove',
      libraryId,
      collectionId: '44444444-4444-4444-8444-444444444444',
      assetIds: ['22222222-2222-4222-8222-222222222222'],
    } satisfies WorkerCommand)).toBe(libraryId);
  });

  it('keeps reads and long-running media work outside the bounded command lease', () => {
    expect(boundedWriteLibraryId({
      type: 'asset.search',
      libraryId,
      query: { clauses: [{ field: null, values: ['Ser'], exclude: false }] },
    } satisfies WorkerCommand)).toBeUndefined();
    expect(boundedWriteLibraryId({
      type: 'media.process-thumbnail-queue',
      libraryId,
    } satisfies WorkerCommand)).toBeUndefined();
    expect(boundedWriteLibraryId({
      type: 'ai.enqueue-analysis',
      libraryId,
      assetIds: ['22222222-2222-4222-8222-222222222222'],
    } satisfies WorkerCommand)).toBeUndefined();
  });

  it('maps bounded metadata writes to the normal domain results without parallel mutation paths', () => {
    const setAssetsRating = vi.fn().mockReturnValue({ updatedCount: 2, skipped: ['missing-asset'] });
    const createTag = vi.fn().mockReturnValue({
      tagId: '33333333-3333-4333-8333-333333333333',
      name: 'Phase-D',
      assetCount: 0,
    });
    const assignTags = vi.fn().mockReturnValue({ assignedCount: 1, skipped: [] });
    const removeTags = vi.fn().mockReturnValue({ removedCount: 1, skipped: [] });
    const createManagedFolder = vi.fn().mockReturnValue({
      folderId: '55555555-5555-4555-8555-555555555555',
      parentFolderId: null,
      name: 'Empty',
    });
    const setAssetMetadata = vi.fn().mockReturnValue({
      assetId: '22222222-2222-4222-8222-222222222222',
      description: null,
      rating: 0,
      favorite: true,
      palette: null,
      sourcePageUrl: null,
      author: null,
      entityVersion: 1,
    });
    const createCollection = vi.fn().mockReturnValue({
      collectionId: '44444444-4444-4444-8444-444444444444',
      parentId: null,
      name: 'Board',
      position: 0,
      assetCount: 0,
    });
    const addCollectionAssets = vi.fn().mockReturnValue({
      collectionId: '44444444-4444-4444-8444-444444444444',
    });
    const removeCollectionAssets = vi.fn().mockReturnValue({
      collectionId: '44444444-4444-4444-8444-444444444444',
    });
    const getAssetMetadata = vi.fn().mockReturnValue({
      assetId: '22222222-2222-4222-8222-222222222222',
      description: null,
      rating: 0,
      favorite: false,
      palette: null,
      sourcePageUrl: null,
      author: null,
      entityVersion: 0,
      updatedAt: 'now',
    });
    const getTagHistorySnapshot = vi.fn().mockReturnValue([]);
    const getHumanTagRelations = vi.fn().mockReturnValue([]);
    const getManagedFolderHistorySnapshot = vi.fn().mockReturnValue([]);
    const getCollectionHistorySnapshot = vi.fn().mockReturnValue([]);
    const getCollectionMembershipHistorySnapshot = vi.fn().mockReturnValue([]);
    const getCollectionAssetMemberships = vi.fn().mockReturnValue([]);
    const recordAssetMetadataBatchHistory = vi.fn().mockReturnValue(null);
    const recordAssetMetadataHistory = vi.fn().mockReturnValue({ historyEntryId: 'history' });
    const recordTagSnapshotHistory = vi.fn().mockReturnValue({ historyEntryId: 'history' });
    const recordTagRelationsHistory = vi.fn().mockReturnValue(null);
    const recordManagedFolderSnapshotHistory = vi.fn().mockReturnValue({ historyEntryId: 'history' });
    const recordCollectionSnapshotHistory = vi.fn().mockReturnValue({ historyEntryId: 'history' });
    const recordCollectionMembershipHistory = vi.fn().mockReturnValue(null);
    const libraryService = {
      setAssetsRating,
      createTag,
      assignTags,
      removeTags,
      createManagedFolder,
      setAssetMetadata,
      createCollection,
      addCollectionAssets,
      removeCollectionAssets,
      getAssetMetadata,
      getTagHistorySnapshot,
      getHumanTagRelations,
      getManagedFolderHistorySnapshot,
      getCollectionHistorySnapshot,
      getCollectionMembershipHistorySnapshot,
      getCollectionAssetMemberships,
      recordAssetMetadataBatchHistory,
      recordAssetMetadataHistory,
      recordTagSnapshotHistory,
      recordTagRelationsHistory,
      recordManagedFolderSnapshotHistory,
      recordCollectionSnapshotHistory,
      recordCollectionMembershipHistory,
    } as unknown as LibraryService;

    expect(executeBoundedWriteWorkerCommand(libraryService, {
      type: 'asset.rating.set',
      libraryId,
      assetIds: ['first-asset', 'missing-asset', 'second-asset'],
      rating: 4,
    })).toEqual({
      ok: true,
      type: 'asset.rating.updated',
      updatedCount: 2,
      skipped: ['missing-asset'],
    });
    expect(executeBoundedWriteWorkerCommand(libraryService, {
      type: 'tag.create',
      libraryId,
      name: 'Phase-D',
    })).toEqual({
      ok: true,
      type: 'tag.created',
      tag: {
        tagId: '33333333-3333-4333-8333-333333333333',
        name: 'Phase-D',
        assetCount: 0,
      },
      historyEntryId: 'history',
    });
    expect(executeBoundedWriteWorkerCommand(libraryService, {
      type: 'tag.assign',
      libraryId,
      assetIds: ['22222222-2222-4222-8222-222222222222'],
      tagIds: ['33333333-3333-4333-8333-333333333333'],
    })).toEqual({ ok: true, type: 'tag.assigned', assignedCount: 1, skipped: [] });
    expect(executeBoundedWriteWorkerCommand(libraryService, {
      type: 'tag.remove',
      libraryId,
      assetIds: ['22222222-2222-4222-8222-222222222222'],
      tagIds: ['33333333-3333-4333-8333-333333333333'],
    })).toEqual({ ok: true, type: 'tag.removed', removedCount: 1, skipped: [] });
    expect(executeBoundedWriteWorkerCommand(libraryService, {
      type: 'folder.create',
      libraryId,
      name: 'Empty',
    })).toEqual({
      ok: true,
      type: 'folder.created',
      folder: {
        folderId: '55555555-5555-4555-8555-555555555555',
        parentFolderId: null,
        name: 'Empty',
      },
      historyEntryId: 'history',
    });
    expect(executeBoundedWriteWorkerCommand(libraryService, {
      type: 'asset.metadata.set',
      libraryId,
      assetId: '22222222-2222-4222-8222-222222222222',
      expectedVersion: 0,
      favorite: true,
    })).toMatchObject({ ok: true, type: 'asset.metadata.updated', historyEntryId: 'history' });
    expect(executeBoundedWriteWorkerCommand(libraryService, {
      type: 'collection.create',
      libraryId,
      name: 'Board',
    })).toMatchObject({ ok: true, type: 'collection.created', historyEntryId: 'history' });
    expect(executeBoundedWriteWorkerCommand(libraryService, {
      type: 'collection.assets.add',
      libraryId,
      collectionId: '44444444-4444-4444-8444-444444444444',
      assetIds: ['22222222-2222-4222-8222-222222222222'],
    })).toEqual({
      ok: true,
      type: 'collection.assets.added',
      collectionId: '44444444-4444-4444-8444-444444444444',
    });
    expect(executeBoundedWriteWorkerCommand(libraryService, {
      type: 'collection.assets.remove',
      libraryId,
      collectionId: '44444444-4444-4444-8444-444444444444',
      assetIds: ['22222222-2222-4222-8222-222222222222'],
    })).toEqual({
      ok: true,
      type: 'collection.assets.removed',
      collectionId: '44444444-4444-4444-8444-444444444444',
    });
  });
});
