import { describe, expect, it } from 'vitest';

import {
  buildBrowseSelectionOrder,
  resolveShiftBrowseRange,
} from '../../src/renderer/browse-selection-order';

describe('browse-selection-order', () => {
  const items = buildBrowseSelectionOrder(['f1', 'f2'], ['a1', 'a2', 'a3']);

  it('orders folders before assets', () => {
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'folder:f1',
      'folder:f2',
      'asset:a1',
      'asset:a2',
      'asset:a3',
    ]);
  });

  it('deduplicates repeated folder and asset ids without changing their first position', () => {
    expect(
      buildBrowseSelectionOrder(['f1', 'f1', 'f2'], ['a1', 'a2', 'a1']).map(
        (item) => `${item.kind}:${item.id}`,
      ),
    ).toEqual(['folder:f1', 'folder:f2', 'asset:a1', 'asset:a2']);
  });

  it('selects a cross-kind Shift range', () => {
    expect(
      resolveShiftBrowseRange({
        items,
        anchor: { kind: 'folder', id: 'f2' },
        target: { kind: 'asset', id: 'a2' },
        currentFolderIds: [],
        currentAssetIds: [],
        additive: false,
      }),
    ).toEqual({
      folderIds: ['f2'],
      assetIds: ['a1', 'a2'],
      anchor: { kind: 'folder', id: 'f2' },
    });
  });

  it('unions ranges when additive', () => {
    expect(
      resolveShiftBrowseRange({
        items,
        anchor: { kind: 'asset', id: 'a1' },
        target: { kind: 'asset', id: 'a3' },
        currentFolderIds: ['f1'],
        currentAssetIds: [],
        additive: true,
      }),
    ).toEqual({
      folderIds: ['f1'],
      assetIds: ['a1', 'a2', 'a3'],
      anchor: { kind: 'asset', id: 'a1' },
    });
  });

  it('keeps the same inclusive range when the click direction is reversed', () => {
    const forward = resolveShiftBrowseRange({
      items,
      anchor: { kind: 'asset', id: 'a1' },
      target: { kind: 'asset', id: 'a3' },
      currentFolderIds: [],
      currentAssetIds: [],
      additive: false,
    });
    const reverse = resolveShiftBrowseRange({
      items,
      anchor: { kind: 'asset', id: 'a3' },
      target: { kind: 'asset', id: 'a1' },
      currentFolderIds: [],
      currentAssetIds: [],
      additive: false,
    });

    expect(reverse?.assetIds).toEqual(forward?.assetIds);
  });
});
