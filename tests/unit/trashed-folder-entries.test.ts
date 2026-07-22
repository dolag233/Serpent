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
      },
      {
        tombstoneId: 'tomb-1',
        folderId: 'folder-1',
        relativePath: 'photos/2024',
        name: '2024',
        parentRelativePath: 'photos',
        trashedAt: '2026-07-22T00:00:00.000Z',
        assetCount: 3,
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
      coverArtifactIds: [],
    });
    expect(entries.find((entry) => entry.folderId === 'tomb-photos')).toMatchObject({
      parentFolderId: null,
      childFolderCount: 1,
    });
  });
});
