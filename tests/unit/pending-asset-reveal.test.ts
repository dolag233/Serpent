import { describe, expect, it } from 'vitest';

import type { AssetSummary } from '../../src/shared/asset-types';
import { encodeLinkedVirtualFolderId } from '../../src/shared/linked-folder-tree';
import {
  currentScopeShowsRevealAssets,
  pendingRevealFromAssets,
  presentIdsFromPendingReveal,
  sharedBrowseScopeForAssets,
} from '../../src/renderer/pending-asset-reveal';

function asset(partial: {
  assetId: string;
  managedFolderId: string | null;
  linkedFolderId?: string;
  relativeFilePath?: string;
}): AssetSummary {
  return {
    assetId: partial.assetId,
    locationKind: partial.linkedFolderId ? 'linked' : 'managed',
    managedFolderId: partial.managedFolderId,
    ...(partial.linkedFolderId ? { linkedFolderId: partial.linkedFolderId } : {}),
    relativeFilePath: partial.relativeFilePath ?? `${partial.assetId}.png`,
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

  it('resolves a linked-folder browse scope for linked assets', () => {
    // 链接根资产：scope = 链接根 folderId
    expect(
      sharedBrowseScopeForAssets([
        asset({
          assetId: 'a',
          managedFolderId: null,
          linkedFolderId: 'linked-1',
          relativeFilePath: 'a.png',
        }),
      ]),
    ).toBe('linked-1');
    // 链接子目录资产：scope = 虚拟子目录 id
    expect(
      sharedBrowseScopeForAssets([
        asset({
          assetId: 'b',
          managedFolderId: null,
          linkedFolderId: 'linked-1',
          relativeFilePath: 'sub/b.png',
        }),
      ]),
    ).toBe(encodeLinkedVirtualFolderId('linked-1', 'sub'));
    // 不同链接目录 → 无法共享
    expect(
      sharedBrowseScopeForAssets([
        asset({
          assetId: 'a',
          managedFolderId: null,
          linkedFolderId: 'linked-1',
          relativeFilePath: 'a.png',
        }),
        asset({
          assetId: 'c',
          managedFolderId: null,
          linkedFolderId: 'linked-2',
          relativeFilePath: 'c.png',
        }),
      ]),
    ).toBeNull();
  });

  it('does not navigate to root when the current linked scope shows the reveal', () => {
    const assets = [
      asset({
        assetId: 'a',
        managedFolderId: null,
        linkedFolderId: 'linked-1',
        relativeFilePath: 'a.png',
      }),
    ];
    expect(currentScopeShowsRevealAssets('all', assets)).toBe(true);
    expect(currentScopeShowsRevealAssets('linked-1', assets)).toBe(true);
    expect(currentScopeShowsRevealAssets('root', assets)).toBe(false);
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
