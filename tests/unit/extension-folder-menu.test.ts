import { describe, expect, it } from 'vitest';

import {
  filterSavedRecentFolderIds,
  MAX_ITEMS_PER_MENU_LEVEL,
  MAX_TOP_LEVEL_FOLDER_SLOTS,
  pushRecentFolderId,
  sortFoldersForMenu,
  sortFoldersForSaveMenu,
  splitSaveMenuFolders,
  type ExtensionFolderOption,
} from '../../extension/folder-menu';

const folders: ExtensionFolderOption[] = [
  { folderId: 'b', name: 'Beta', relativePath: 'Beta', assetCount: 3 },
  { folderId: 'a', name: 'Alpha', relativePath: 'Alpha', assetCount: 99 },
  { folderId: 'c', name: '场景', relativePath: '场景', assetCount: 12 },
  { folderId: 'd', name: '道具', relativePath: '道具', assetCount: 8 },
  { folderId: 'e', name: '环境', relativePath: '环境', assetCount: 7 },
  { folderId: 'f', name: 'UI', relativePath: 'UI', assetCount: 6 },
  { folderId: 'g', name: '特效', relativePath: '特效', assetCount: 5 },
  { folderId: 'h', name: '音频', relativePath: '音频', assetCount: 4 },
  { folderId: 'i', name: '视频', relativePath: '视频', assetCount: 2 },
];

describe('splitSaveMenuFolders', () => {
  it('merges saved, browsed, then asset-count tiers with at most 7 top-level slots', () => {
    const hints = { savedRecentIds: ['c'], browsedRecentIds: ['b'] };
    const { topLevel, underRoot } = splitSaveMenuFolders(folders, hints);
    expect(topLevel).toHaveLength(MAX_TOP_LEVEL_FOLDER_SLOTS);
    expect(topLevel[0]?.folderId).toBe('c');
    expect(topLevel[1]?.folderId).toBe('b');
    expect(topLevel.slice(2).map((folder) => folder.folderId)).toEqual([
      'a',
      'd',
      'e',
      'f',
      'g',
    ]);
    expect(underRoot.map((folder) => folder.folderId)).toEqual(['h', 'i']);
    expect(topLevel.length + 1).toBeLessThanOrEqual(MAX_ITEMS_PER_MENU_LEVEL);
  });

  it('puts all folders in top level when fewer than the cap', () => {
    const small = folders.slice(0, 3);
    const { topLevel, underRoot } = splitSaveMenuFolders(small, {
      savedRecentIds: [],
      browsedRecentIds: [],
    });
    expect(topLevel).toEqual([small[1], small[2], small[0]]);
    expect(underRoot).toEqual([]);
  });

  it('ignores __root__ in saved recent ids', () => {
    expect(
      filterSavedRecentFolderIds(['__root__', 'c'], new Set(['c', 'a', 'b'])),
    ).toEqual(['c']);
    expect(
      splitSaveMenuFolders(folders, {
        savedRecentIds: ['__root__'],
        browsedRecentIds: ['a'],
      }).topLevel[0]?.folderId,
    ).toBe('a');
  });
});

describe('sortFoldersForSaveMenu', () => {
  it('orders saved, browsed, then asset count', () => {
    expect(
      sortFoldersForSaveMenu(folders.slice(0, 3), {
        savedRecentIds: ['c'],
        browsedRecentIds: ['b'],
      }),
    ).toEqual([folders[2], folders[0], folders[1]]);
  });
});

describe('sortFoldersForMenu', () => {
  it('puts recent folders first and sorts the rest by asset count', () => {
    expect(sortFoldersForMenu(folders.slice(0, 3), ['c', 'missing'])).toEqual([
      folders[2],
      folders[1],
      folders[0],
    ]);
  });
});

describe('pushRecentFolderId', () => {
  it('moves the latest folder to the front and drops unknown ids', () => {
    const valid = new Set(['a', 'b', 'c']);
    expect(pushRecentFolderId(['b'], 'c', valid)).toEqual(['c', 'b']);
    expect(pushRecentFolderId(['b'], null, valid)).toEqual(['__root__', 'b']);
  });
});
