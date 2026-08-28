import { describe, expect, it } from 'vitest';

import {
  folderBrowseScope,
  folderSearchScope,
} from '../../src/renderer/folder-browse-scope';

describe('folderBrowseScope (REQ-FOLDER-009)', () => {
  it('leaves all-assets without a folder scope', () => {
    expect(folderBrowseScope('all', true)).toBeUndefined();
    expect(folderBrowseScope('all', false)).toBeUndefined();
  });

  it('keeps library root non-recursive', () => {
    expect(folderBrowseScope('root', true)).toEqual({
      kind: 'folder',
      folderId: null,
      recursive: false,
    });
  });

  it('honours the explicit include-subfolders switch for a folder id', () => {
    expect(folderBrowseScope('folder-a', false)).toEqual({
      kind: 'folder',
      folderId: 'folder-a',
      recursive: false,
    });
    expect(folderBrowseScope('folder-a', true)).toEqual({
      kind: 'folder',
      folderId: 'folder-a',
      recursive: true,
    });
  });
});

describe('folderSearchScope', () => {
  it('leaves all-assets unscoped', () => {
    expect(folderSearchScope('all')).toBeUndefined();
  });

  it('searches every managed folder from the library root', () => {
    expect(folderSearchScope('root')).toEqual({
      kind: 'folder',
      folderId: null,
      recursive: true,
    });
  });

  it('always searches descendants of a selected folder', () => {
    expect(folderSearchScope('folder-a')).toEqual({
      kind: 'folder',
      folderId: 'folder-a',
      recursive: true,
    });
  });
});
