import { describe, expect, it } from 'vitest';

import {
  MANAGED_ASSETS_DRAG_TYPE,
  parseManagedAssetDrag,
  resolveCollectionDrop,
  resolveDragDropMode,
  resolveDraggedAssetIds,
  resolveFolderDrop,
  resolveManagedDropEffect,
  resolveTrashDrop,
  supportsManagedAssetDrag,
  type DragAssetFact,
} from '../../src/renderer/asset-drag-drop';

function managed(assetId: string): DragAssetFact {
  return {
    assetId,
    locationKind: 'managed',
    availability: 'available',
    deletedAt: null,
  };
}

function transfer(types: string[], data?: string): DataTransfer {
  return {
    types,
    getData: (type: string) => (type === MANAGED_ASSETS_DRAG_TYPE ? (data ?? '') : ''),
  } as unknown as DataTransfer;
}

describe('resolveDraggedAssetIds (REQ-DND-001)', () => {
  it('moves the whole selection when the dragged card is selected', () => {
    expect(resolveDraggedAssetIds('a', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('moves only the dragged card when it is not in the selection', () => {
    expect(resolveDraggedAssetIds('x', ['a', 'b'])).toEqual(['x']);
  });
});

describe('drag payload helpers', () => {
  it('recognizes the managed-assets type', () => {
    expect(supportsManagedAssetDrag(transfer([MANAGED_ASSETS_DRAG_TYPE]))).toBe(true);
    expect(supportsManagedAssetDrag(transfer(['Files']))).toBe(false);
  });

  it('parses a valid id list and rejects garbage', () => {
    expect(parseManagedAssetDrag(transfer([MANAGED_ASSETS_DRAG_TYPE], '["a","b"]'))).toEqual([
      'a',
      'b',
    ]);
    expect(parseManagedAssetDrag(transfer([MANAGED_ASSETS_DRAG_TYPE], 'not-json'))).toBeNull();
    expect(parseManagedAssetDrag(transfer([MANAGED_ASSETS_DRAG_TYPE], '[1,2]'))).toBeNull();
    expect(parseManagedAssetDrag(transfer([MANAGED_ASSETS_DRAG_TYPE]))).toBeNull();
  });
});

describe('resolveDragDropMode / resolveManagedDropEffect (Serpent-aa3)', () => {
  it('maps Option/Alt to copy and the matching dropEffect', () => {
    expect(resolveDragDropMode({ altKey: true })).toBe('copy');
    expect(resolveDragDropMode({ altKey: false })).toBe('move');
    expect(resolveManagedDropEffect('copy')).toBe('copy');
    expect(resolveManagedDropEffect('move')).toBe('move');
  });
});

describe('resolveFolderDrop (REQ-DND-001)', () => {
  it('rejects dropping onto the current folder (and root onto root scope)', () => {
    expect(
      resolveFolderDrop({
        targetFolderId: 'f1',
        currentFolderId: 'f1',
        assets: [managed('a')],
      }),
    ).toEqual({ kind: 'reject', reason: 'same-folder', skippedCount: 0 });
    expect(
      resolveFolderDrop({
        targetFolderId: null,
        currentFolderId: null,
        assets: [managed('a')],
      }),
    ).toEqual({ kind: 'reject', reason: 'same-folder', skippedCount: 0 });
  });

  it('moves eligible managed assets and skips the rest with a count', () => {
    const assets: DragAssetFact[] = [
      managed('a'),
      { assetId: 'b', locationKind: 'linked', availability: 'available', deletedAt: null },
      { assetId: 'c', locationKind: 'managed', availability: 'missing', deletedAt: null },
      { assetId: 'd', locationKind: 'managed', availability: 'available', deletedAt: '2026-07-17' },
    ];
    expect(
      resolveFolderDrop({ targetFolderId: 'f2', currentFolderId: 'f1', assets }),
    ).toEqual({ kind: 'move', assetIds: ['a'], skippedCount: 3 });
  });

  it('rejects when nothing is eligible', () => {
    const assets: DragAssetFact[] = [
      { assetId: 'b', locationKind: 'linked', availability: 'available', deletedAt: null },
    ];
    expect(
      resolveFolderDrop({ targetFolderId: 'f2', currentFolderId: 'f1', assets }),
    ).toEqual({ kind: 'reject', reason: 'no-eligible-assets', skippedCount: 1 });
  });

  it('refuses copy mode without silently moving (no managed duplicate API)', () => {
    expect(
      resolveFolderDrop({
        targetFolderId: 'f2',
        currentFolderId: 'f1',
        assets: [managed('a')],
        mode: 'copy',
      }),
    ).toEqual({ kind: 'reject', reason: 'copy-unsupported', skippedCount: 0 });
  });
});

describe('resolveCollectionDrop (Serpent-aa3)', () => {
  it('adds membership for both move and copy modes', () => {
    const assets: DragAssetFact[] = [
      managed('a'),
      { assetId: 'b', locationKind: 'linked', availability: 'available', deletedAt: null },
    ];
    expect(resolveCollectionDrop({ assets, mode: 'move' })).toEqual({
      kind: 'add-membership',
      assetIds: ['a', 'b'],
      skippedCount: 0,
      mode: 'move',
    });
    expect(resolveCollectionDrop({ assets, mode: 'copy' })).toEqual({
      kind: 'add-membership',
      assetIds: ['a', 'b'],
      skippedCount: 0,
      mode: 'copy',
    });
  });

  it('skips trashed assets and rejects when none remain', () => {
    const assets: DragAssetFact[] = [
      { assetId: 'd', locationKind: 'managed', availability: 'available', deletedAt: 'x' },
    ];
    expect(resolveCollectionDrop({ assets, mode: 'copy' })).toEqual({
      kind: 'reject',
      reason: 'no-eligible-assets',
      skippedCount: 1,
    });
  });
});

describe('resolveTrashDrop (REQ-DND-002)', () => {
  it('keeps only managed, available, non-trashed assets', () => {
    const assets: DragAssetFact[] = [
      managed('a'),
      managed('b'),
      { assetId: 'c', locationKind: 'linked', availability: 'available', deletedAt: null },
      { assetId: 'd', locationKind: 'managed', availability: 'available', deletedAt: 'x' },
    ];
    expect(resolveTrashDrop(assets)).toEqual({ assetIds: ['a', 'b'], skippedCount: 2 });
  });
});
