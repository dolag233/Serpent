import { describe, expect, it } from 'vitest';

import {
  buildSaveMenuFolderHints,
  buildSaveMenuTree,
  EXTENSION_ROOT_FOLDER_KEY,
  filterSavedRecentFolderIds,
  folderMenuId,
  folderMenuItemId,
  folderMenuPathId,
  parseFolderMenuId,
  pushRecentFolderId,
  saveHereMenuId,
  sortFoldersForSaveMenu,
  type ExtensionFolderOption,
  type SaveMenuTreeItem,
} from '../../extension/folder-menu';

const folders: ExtensionFolderOption[] = [
  { folderId: 'a', name: 'Alpha', relativePath: 'Alpha', assetCount: 99 },
  { folderId: 'b', name: 'Beta', relativePath: 'Beta', assetCount: 3 },
  { folderId: 'c', name: '场景', relativePath: '场景', assetCount: 12 },
  { folderId: 'd', name: '概念', relativePath: '概念', assetCount: 8 },
  { folderId: 'd1', name: '角色', relativePath: '概念/角色', assetCount: 4 },
  { folderId: 'd2', name: '服装', relativePath: '概念/服装', assetCount: 2 },
  { folderId: 'd3', name: '武器', relativePath: '概念/角色/武器', assetCount: 1 },
  { folderId: 'e', name: '环境', relativePath: '环境', assetCount: 7 },
];

function ids(items: readonly SaveMenuTreeItem[]): Array<string | '---'> {
  return items.map((item) =>
    item.kind === 'separator'
      ? '---'
      : item.folder.folderId ?? `?${item.folder.path}`,
  );
}

describe('buildSaveMenuTree', () => {
  it('recents → 分割线 → 全部一级目录（排除已在最近区的），子级递归保留', () => {
    const items = buildSaveMenuTree(folders, {
      savedRecentIds: ['c'],
      browsedRecentIds: ['b'],
    });
    expect(ids(items)).toEqual(['c', 'b', '---', 'd', 'e', 'a']);
    const concept = items.find(
      (item): item is Extract<SaveMenuTreeItem, { kind: 'folder' }> =>
        item.kind === 'folder' && item.folder.folderId === 'd',
    );
    expect(concept?.folder.children.map((child) => child.folderId)).toEqual([
      'd2',
      'd1',
    ]);
    const character = concept?.folder.children.find(
      (child) => child.folderId === 'd1',
    );
    expect(character?.children.map((child) => child.folderId)).toEqual(['d3']);
  });

  it('最近项取 4 保存 + 2 浏览（浏览去重已保存的），一级目录排除最近项', () => {
    const many = [
      ...folders,
      { folderId: 'r1', name: 'R1', relativePath: 'R1' },
      { folderId: 'r2', name: 'R2', relativePath: 'R2' },
      { folderId: 'r3', name: 'R3', relativePath: 'R3' },
      { folderId: 'r4', name: 'R4', relativePath: 'R4' },
      { folderId: 'r5', name: 'R5', relativePath: 'R5' },
      { folderId: 'r6', name: 'R6', relativePath: 'R6' },
      { folderId: 'r7', name: 'R7', relativePath: 'R7' },
    ] as const;
    const items = buildSaveMenuTree(many, {
      savedRecentIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
      browsedRecentIds: ['r4', 'r6', 'r7'],
    });
    expect(ids(items)).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
      'r6',
      'r7',
      '---',
      'c',
      'd',
      'e',
      'a',
      'b',
      'r5',
    ]);
  });

  it('无最近项时无分割线，直接展示全部一级目录', () => {
    expect(
      ids(buildSaveMenuTree(folders, { savedRecentIds: [], browsedRecentIds: [] })),
    ).toEqual(['c', 'd', 'e', 'a', 'b']);
  });

  it('全部一级目录都出现在最近区时仅展示最近项（无分割线）', () => {
    expect(
      ids(
        buildSaveMenuTree(folders, {
          savedRecentIds: ['d', 'a', 'b', 'e'],
          browsedRecentIds: ['c'],
        }),
      ),
    ).toEqual(['d', 'a', 'b', 'e', 'c']);
  });

  it('忽略无效/根占位的最近 id', () => {
    const items = buildSaveMenuTree(folders, {
      savedRecentIds: [EXTENSION_ROOT_FOLDER_KEY, 'missing'],
      browsedRecentIds: [],
    });
    expect(ids(items)).toEqual(['c', 'd', 'e', 'a', 'b']);
  });
});

describe('folderMenuItemId / parseFolderMenuId', () => {
  it('有 folderId 的节点用 folderMenuId，解析回原 id', () => {
    const id = folderMenuItemId({
      folderId: 'd1',
      name: '角色',
      path: '概念/角色',
      children: [],
    });
    expect(id).toBe(folderMenuId('d1'));
    expect(parseFolderMenuId(id)).toBe('d1');
  });

  it('纯容器节点（folderId null）用路径 id，解析为 undefined（不可保存）', () => {
    const id = folderMenuItemId({
      folderId: null,
      name: '容器',
      path: '概念',
      children: [],
    });
    expect(id).toBe(folderMenuPathId('概念'));
    expect(parseFolderMenuId(id)).toBeUndefined();
  });

  it('「保存到此文件夹」解析回原 folderId', () => {
    expect(parseFolderMenuId(saveHereMenuId('d1'))).toBe('d1');
  });

  it('「保存至此」解析为 null（根目录），未知 id 为 undefined', () => {
    expect(parseFolderMenuId('serpent-save-root')).toBeNull();
    expect(parseFolderMenuId('serpent-save-whatever')).toBeUndefined();
  });
});

describe('sortFoldersForSaveMenu', () => {
  it('orders saved, browsed, then asset count', () => {
    expect(
      sortFoldersForSaveMenu(folders.slice(0, 3), {
        savedRecentIds: ['c'],
        browsedRecentIds: ['b'],
      }),
    ).toEqual([folders[2], folders[1], folders[0]]);
  });
});

describe('buildSaveMenuFolderHints', () => {
  it('过滤无效 id，__root__ 只出现在 saved 过滤后', () => {
    const hints = buildSaveMenuFolderHints(
      folders,
      [EXTENSION_ROOT_FOLDER_KEY, 'c', 'missing'],
      ['b', 'nope'],
    );
    expect(hints.savedRecentIds).toEqual(['c']);
    expect(hints.browsedRecentIds).toEqual(['b']);
  });
});

describe('filterSavedRecentFolderIds', () => {
  it('ignores __root__ and unknown ids', () => {
    expect(
      filterSavedRecentFolderIds(['__root__', 'c'], new Set(['c', 'a', 'b'])),
    ).toEqual(['c']);
  });
});

describe('pushRecentFolderId', () => {
  it('moves the latest folder to the front and drops unknown ids', () => {
    const valid = new Set(['a', 'b', 'c']);
    expect(pushRecentFolderId(['b'], 'c', valid)).toEqual(['c', 'b']);
    expect(pushRecentFolderId(['b'], null, valid)).toEqual(['__root__', 'b']);
  });
});
