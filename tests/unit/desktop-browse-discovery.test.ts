import { describe, expect, it } from 'vitest';

import {
  applyDesktopDiscoveryFilterPatch,
  EMPTY_DESKTOP_DISCOVERY_FILTERS,
  resolveDesktopViewerNeighbor,
} from '../../src/shared/desktop-browse-discovery';

describe('applyDesktopDiscoveryFilterPatch', () => {
  it('applies format, rating, favorite and range patches while clearing with null', () => {
    const next = applyDesktopDiscoveryFilterPatch(EMPTY_DESKTOP_DISCOVERY_FILTERS, {
      formatFilter: 'png, jpg',
      ratingFilter: '4,5',
      favoriteFilter: 'yes',
      widthRange: { min: '100', max: '200' },
    });
    expect(next).toMatchObject({
      formatFilter: 'png,jpg',
      ratingFilter: '4,5',
      favoriteFilter: 'yes',
      widthRange: { min: '100', max: '200', exclude: false },
    });

    const cleared = applyDesktopDiscoveryFilterPatch(next, {
      formatFilter: null,
      favoriteFilter: 'any',
      widthRange: null,
    });
    expect(cleared.formatFilter).toBe('');
    expect(cleared.favoriteFilter).toBe('any');
    expect(cleared.widthRange).toEqual({ min: '', max: '', exclude: false });
    expect(cleared.ratingFilter).toBe('4,5');
  });
});

describe('resolveDesktopViewerNeighbor', () => {
  it('resolves previous and next neighbors and reports closed or boundary states', () => {
    expect(resolveDesktopViewerNeighbor({
      direction: 'next',
      viewerAssetId: null,
      visibleAssetIds: ['a', 'b'],
    })).toEqual({ status: 'viewer-closed' });

    expect(resolveDesktopViewerNeighbor({
      direction: 'next',
      viewerAssetId: 'a',
      visibleAssetIds: ['a', 'b'],
    })).toEqual({ status: 'ok', assetId: 'b' });

    expect(resolveDesktopViewerNeighbor({
      direction: 'previous',
      viewerAssetId: 'a',
      visibleAssetIds: ['a', 'b'],
    })).toEqual({ status: 'boundary' });

    expect(resolveDesktopViewerNeighbor({
      direction: 'next',
      viewerAssetId: 'missing',
      visibleAssetIds: ['a', 'b'],
    })).toEqual({ status: 'viewer-closed' });
  });
});
