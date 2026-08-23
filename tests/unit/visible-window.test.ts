import { describe, expect, it } from 'vitest';

import {
  MAX_VISIBLE_WINDOW_ASSETS,
  normalizeVisibleWindowAssetIds,
  visibleWindowReportKey,
} from '../../src/renderer/visible-window';

describe('visible-window reporting', () => {
  it('normalizes DOM traversal order into a stable bounded set', () => {
    expect(normalizeVisibleWindowAssetIds(['b', 'a', 'c', 'a'])).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(
      normalizeVisibleWindowAssetIds(
        Array.from({ length: MAX_VISIBLE_WINDOW_ASSETS + 20 }, (_, index) => `asset-${index}`),
      ),
    ).toHaveLength(MAX_VISIBLE_WINDOW_ASSETS);
  });

  it('uses the same report key for equivalent viewport orderings', () => {
    expect(visibleWindowReportKey('library-1', ['asset-b', 'asset-a']))
      .toBe(visibleWindowReportKey('library-1', ['asset-a', 'asset-b']));
    expect(visibleWindowReportKey('library-1', ['asset-a']))
      .not.toBe(visibleWindowReportKey('library-2', ['asset-a']));
  });
});
