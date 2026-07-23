import { describe, expect, it } from 'vitest';

import { trashedFoldersToBrowseEntries } from '../../src/renderer/trashed-folder-entries';

describe('trashedFoldersToBrowseEntries', () => {
  it('maps tombstones to folder browse cards using tombstone id', () => {
    const entries = trashedFoldersToBrowseEntries([
      {
        tombstoneId: 'tomb-photos',
        folderId: 'folder-photos',
        relativePath: 'photos',
        name: 'photos',
        parentRelativePath: null,
        trashedAt: '2026-07-22T00:00:00.000Z',
        assetCount: 0,
        coverArtifactIds: ['art-a'],
      },
      {
        tombstoneId: 'tomb-1',
        folderId: 'folder-1',
        relativePath: 'photos/2024',
        name: '2024',
        parentRelativePath: 'photos',
        trashedAt: '2026-07-22T00:00:00.000Z',
        assetCount: 3,
        coverArtifactIds: ['art-b', 'art-c'],
      },
    ]);

    expect(entries).toContainEqual({
      folderId: 'tomb-1',
      parentFolderId: 'tomb-photos',
      locationKind: 'managed',
      name: '2024',
      relativePath: 'photos/2024',
      status: 'available',
      directAssetCount: 3,
      recursiveAssetCount: 3,
      childFolderCount: 0,
      coverArtifactIds: ['art-b', 'art-c'],
    });
    expect(entries.find((entry) => entry.folderId === 'tomb-photos')).toMatchObject({
      parentFolderId: null,
      childFolderCount: 1,
      coverArtifactIds: ['art-a'],
    });
  });

  it('keeps same-path tombstones from different trash batches distinct', () => {
    const entries = trashedFoldersToBrowseEntries([
      {
        tombstoneId: 'tomb-a',
        folderId: 'folder-a',
        relativePath: 'photos',
        name: 'photos',
        parentRelativePath: null,
        trashedAt: '2026-07-22T00:00:00.000Z',
        assetCount: 1,
        coverArtifactIds: ['art-a'],
      },
      {
        tombstoneId: 'tomb-a-child',
        folderId: 'folder-a-child',
        relativePath: 'photos/nested',
        name: 'nested',
        parentRelativePath: 'photos',
        trashedAt: '2026-07-22T00:00:00.000Z',
        assetCount: 0,
        coverArtifactIds: [],
      },
      {
        tombstoneId: 'tomb-b',
        folderId: 'folder-b',
        relativePath: 'photos',
        name: 'photos',
        parentRelativePath: null,
        trashedAt: '2026-07-23T00:00:00.000Z',
        assetCount: 2,
        coverArtifactIds: ['art-b'],
      },
      {
        tombstoneId: 'tomb-b-child',
        folderId: 'folder-b-child',
        relativePath: 'photos/nested',
        name: 'nested',
        parentRelativePath: 'photos',
        trashedAt: '2026-07-23T00:00:00.000Z',
        assetCount: 0,
        coverArtifactIds: [],
      },
    ]);

    expect(entries.find((entry) => entry.folderId === 'tomb-a-child')).toMatchObject({
      parentFolderId: 'tomb-a',
    });
    expect(entries.find((entry) => entry.folderId === 'tomb-b-child')).toMatchObject({
      parentFolderId: 'tomb-b',
    });
    expect(entries.find((entry) => entry.folderId === 'tomb-a')).toMatchObject({
      childFolderCount: 1,
      coverArtifactIds: ['art-a'],
    });
    expect(entries.find((entry) => entry.folderId === 'tomb-b')).toMatchObject({
      childFolderCount: 1,
      coverArtifactIds: ['art-b'],
    });
  });
});
