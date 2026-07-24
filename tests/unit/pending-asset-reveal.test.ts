import { describe, expect, it } from 'vitest';

import type { AssetSummary } from '../../src/shared/asset-types';
import {
  currentScopeShowsRevealAssets,
  pendingRevealFromAssets,
  presentIdsFromPendingReveal,
  sharedBrowseScopeForAssets,
} from '../../src/renderer/pending-asset-reveal';

function asset(partial: {
  assetId: string;
  managedFolderId: string | null;
}): AssetSummary {
  return {
    assetId: partial.assetId,
    locationKind: 'managed',
    managedFolderId: partial.managedFolderId,
    relativeFilePath: `${partial.assetId}.png`,
    displayName: `${partial.assetId}.png`,
    currentRevisionId: 'rev',
    byteSize: 1,
    modifiedAt: '2026-07-24T00:00:00.000Z',
    availability: 'available',
    rating: 0,
    favorite: false,
    deletedAt: null,
  } as AssetSummary;
}

describe('pending asset reveal helpers', () => {
  it('builds a reveal from imported assets', () => {
    expect(
      pendingRevealFromAssets([
        asset({ assetId: 'a', managedFolderId: 'folder-1' }),
        asset({ assetId: 'b', managedFolderId: 'folder-1' }),
      ]),
    ).toEqual({
      assetIds: ['a', 'b'],
      focusAssetId: 'a',
    });
    expect(pendingRevealFromAssets([])).toBeNull();
  });

  it('resolves a shared browse scope when all assets share a folder', () => {
    expect(
      sharedBrowseScopeForAssets([
        asset({ assetId: 'a', managedFolderId: null }),
      ]),
    ).toBe('root');
    expect(
      sharedBrowseScopeForAssets([
        asset({ assetId: 'a', managedFolderId: 'folder-1' }),
        asset({ assetId: 'b', managedFolderId: 'folder-1' }),
      ]),
    ).toBe('folder-1');
    expect(
      sharedBrowseScopeForAssets([
        asset({ assetId: 'a', managedFolderId: 'folder-1' }),
        asset({ assetId: 'b', managedFolderId: 'folder-2' }),
      ]),
    ).toBeNull();
  });

  it('keeps the all-assets scope without navigating', () => {
    const assets = [asset({ assetId: 'a', managedFolderId: 'folder-1' })];
    expect(currentScopeShowsRevealAssets('all', assets)).toBe(true);
    expect(currentScopeShowsRevealAssets('folder-1', assets)).toBe(true);
    expect(currentScopeShowsRevealAssets('root', assets)).toBe(false);
    expect(currentScopeShowsRevealAssets('folder-2', assets)).toBe(false);
  });

  it('filters pending ids to assets currently in the list', () => {
    expect(
      presentIdsFromPendingReveal(
        { assetIds: ['a', 'b', 'c'], focusAssetId: 'a' },
        [asset({ assetId: 'b', managedFolderId: null })],
      ),
    ).toEqual(['b']);
  });
});
