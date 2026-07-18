import { describe, expect, it } from 'vitest';

import { folderBrowseScope } from '../../src/renderer/folder-browse-scope';

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
