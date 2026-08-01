import { describe, expect, it } from 'vitest';

import {
  resolveDesktopReveal,
  type DesktopRevealAsset,
} from '../../src/renderer/desktop-browse-reveal';

const assets: DesktopRevealAsset[] = [
  { assetId: 'asset-visible', locationKind: 'managed', managedFolderId: 'folder-a', available: true },
  { assetId: 'asset-other-folder', locationKind: 'managed', managedFolderId: 'folder-b', available: true },
  { assetId: 'asset-linked', locationKind: 'linked', managedFolderId: null, available: true },
];

describe('resolveDesktopReveal', () => {
  it('selects an asset already present in the current folder scope', () => {
    expect(resolveDesktopReveal({
      assetId: 'asset-visible',
      currentBrowseTarget: 'folder',
      currentFolderId: 'folder-a',
      assets,
    })).toEqual({
      status: 'visible',
      assetId: 'asset-visible',
    });
  });

  it('requests a folder switch when the asset belongs to another managed folder', () => {
    expect(resolveDesktopReveal({
      assetId: 'asset-other-folder',
      currentBrowseTarget: 'folder',
      currentFolderId: 'folder-a',
      assets,
    })).toEqual({
      status: 'switch-folder',
      assetId: 'asset-other-folder',
      folderId: 'folder-b',
    });
  });

  it('returns stable reasons for missing or unsupported assets', () => {
    expect(resolveDesktopReveal({
      assetId: 'missing',
      currentBrowseTarget: 'all',
      currentFolderId: null,
      assets,
    })).toEqual({ status: 'not-found', assetId: 'missing' });
    expect(resolveDesktopReveal({
      assetId: 'asset-linked',
      currentBrowseTarget: 'all',
      currentFolderId: null,
      assets,
    })).toEqual({
      status: 'unsupported-scope',
      assetId: 'asset-linked',
    });
  });
});
