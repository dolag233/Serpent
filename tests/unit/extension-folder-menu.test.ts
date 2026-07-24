import { describe, expect, it } from 'vitest';

import {
  pushRecentFolderId,
  sortFoldersForMenu,
  type ExtensionFolderOption,
} from '../../extension/folder-menu';

const folders: ExtensionFolderOption[] = [
  { folderId: 'b', name: 'Beta', relativePath: 'Beta' },
  { folderId: 'a', name: 'Alpha', relativePath: 'Alpha' },
  { folderId: 'c', name: '场景', relativePath: '场景' },
];

describe('sortFoldersForMenu', () => {
  it('puts recent folders first and sorts the rest alphabetically', () => {
    expect(sortFoldersForMenu(folders, ['c', 'missing'])).toEqual([
      folders[2],
      folders[1],
      folders[0],
    ]);
  });

  it('falls back to alphabetical order when there is no recent history', () => {
    const asciiFolders: ExtensionFolderOption[] = [
      { folderId: 'b', name: 'Beta', relativePath: 'Beta' },
      { folderId: 'a', name: 'Alpha', relativePath: 'Alpha' },
    ];
    expect(sortFoldersForMenu(asciiFolders, [])).toEqual([
      asciiFolders[1],
      asciiFolders[0],
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
