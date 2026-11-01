import { describe, expect, it } from 'vitest';

import { buildBrowseSelectionOrder, resolveShiftBrowseRange } from '../../src/renderer/browse-selection-order';
import { orderMasonryShiftAssetIds } from '../../src/renderer/masonry-shift-selection';
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

describe('masonry Shift anchor resolution', () => {
  const assets = Array.from({ length: 9 }, (_, index) =>
    asset(`card-${index}`),
  );

  it('shift range works after import-style anchor (browse anchor missing)', () => {
    const assetIds = assets.map((item) => item.assetId);
    const geometry = assetIds.map((id, index) => ({
      id,
      x: index % 3,
      y: Math.floor(index / 3),
      width: 1,
      height: 1,
    }));
    const masonryOrder = orderMasonryShiftAssetIds(assetIds, geometry);

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

  it('uses geometry order rather than asset input order', () => {
    const masonryOrder = orderMasonryShiftAssetIds(
      ['card-0', 'card-1', 'card-2', 'card-3', 'card-4', 'card-5'],
      [
        { id: 'card-0', x: 0, y: 0, width: 100, height: 300 },
        { id: 'card-1', x: 0, y: 314, width: 100, height: 100 },
        { id: 'card-2', x: 114, y: 0, width: 100, height: 100 },
        { id: 'card-3', x: 114, y: 114, width: 100, height: 100 },
        { id: 'card-4', x: 228, y: 0, width: 100, height: 200 },
        { id: 'card-5', x: 228, y: 214, width: 100, height: 100 },
      ],
    );
    const items = buildBrowseSelectionOrder([], masonryOrder);
    const anchor = assetBrowseAnchor('card-0');

    expect(
      resolveShiftBrowseRange({
        items,
        anchor,
        target: assetBrowseAnchor('card-5'),
        currentFolderIds: [],
        currentAssetIds: [],
        additive: false,
      })?.assetIds,
    ).toEqual(['card-0', 'card-2', 'card-4', 'card-3', 'card-5']);
  });
});
