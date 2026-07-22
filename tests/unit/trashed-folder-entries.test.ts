import { describe, expect, it } from 'vitest';

import { trashedFoldersToBrowseEntries } from '../../src/renderer/trashed-folder-entries';

describe('trashedFoldersToBrowseEntries', () => {
  it('maps tombstones to folder browse cards using tombstone id', () => {
    const entries = trashedFoldersToBrowseEntries([
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

    expect(entries).toEqual([
      {
        folderId: 'tomb-1',
        parentFolderId: null,
        locationKind: 'managed',
        name: '2024',
        relativePath: 'photos/2024',
        status: 'available',
        directAssetCount: 3,
        recursiveAssetCount: 3,
        childFolderCount: 0,
        coverArtifactIds: [],
      },
    ]);
  });
});
