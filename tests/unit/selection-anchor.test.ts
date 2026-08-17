import { describe, expect, it } from 'vitest';

import { buildBrowseSelectionOrder, resolveShiftBrowseRange } from '../../src/renderer/browse-selection-order';
import { computeMasonrySelectionAssetIds } from '../../src/renderer/masonry-selection-order';
import {
  assetBrowseAnchor,
  resolveShiftBrowseAnchor,
} from '../../src/renderer/selection-anchor';
import type { AssetSummary } from '../../src/shared/asset-types';

function asset(id: string): AssetSummary {
  return {
    assetId: id,
    locationKind: 'managed',
    managedFolderId: 'folder-1',
    relativeFilePath: `${id}.png`,
    displayName: `${id}.png`,
    currentRevisionId: `rev-${id}`,
    byteSize: 1024,
    modifiedAt: '2026-01-01T00:00:00.000Z',
    availability: 'available',
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: 'ready',
    thumbnailArtifactId: `thumb-${id}`,
    mediaType: 'image',
    width: 800,
    height: 600,
    durationMs: null,
  };
}

describe('resolveShiftBrowseAnchor', () => {
  it('falls back to asset anchor when browse anchor was never set (import reveal)', () => {
    expect(
      resolveShiftBrowseAnchor({
        browseAnchor: null,
        assetAnchorId: 'asset-3',
        folderAnchorId: null,
      }),
    ).toEqual(assetBrowseAnchor('asset-3'));
  });

  it('prefers explicit browse anchor from canvas clicks', () => {
    expect(
      resolveShiftBrowseAnchor({
        browseAnchor: assetBrowseAnchor('asset-2'),
        assetAnchorId: 'asset-9',
        folderAnchorId: null,
      }),
    ).toEqual(assetBrowseAnchor('asset-2'));
  });
});

describe('masonry shift simulation (Serpent-ph3a)', () => {
  const assets = Array.from({ length: 9 }, (_, index) =>
    asset(`card-${index}`),
  );

  it('shift range works after import-style anchor (browse anchor missing)', () => {
    const masonryOrder = computeMasonrySelectionAssetIds(assets, 600, 160, false);
    expect(masonryOrder).toEqual(assets.map((item) => item.assetId));

    const items = buildBrowseSelectionOrder([], masonryOrder);
    const anchor = resolveShiftBrowseAnchor({
      browseAnchor: null,
      assetAnchorId: 'card-8',
      folderAnchorId: null,
    });

    expect(
      resolveShiftBrowseRange({
        items,
        anchor: anchor!,
        target: assetBrowseAnchor('card-0'),
        currentFolderIds: [],
        currentAssetIds: [],
        additive: false,
      })?.assetIds,
    ).toEqual(assets.map((item) => item.assetId));
  });

  it('shift range is row-major LTR-TTB, not column DOM order', () => {
    const masonryOrder = computeMasonrySelectionAssetIds(assets, 600, 160, false);
    const items = buildBrowseSelectionOrder([], masonryOrder);
    const anchor = assetBrowseAnchor('card-1');

    expect(
      resolveShiftBrowseRange({
        items,
        anchor,
        target: assetBrowseAnchor('card-5'),
        currentFolderIds: [],
        currentAssetIds: [],
        additive: false,
      })?.assetIds,
    ).toEqual(['card-1', 'card-2', 'card-3', 'card-4', 'card-5']);
  });
});
