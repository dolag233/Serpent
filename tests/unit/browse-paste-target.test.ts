import { describe, expect, it } from 'vitest';

import { resolveBrowsePasteDestination } from '../../src/renderer/browse-paste-target';

describe('resolveBrowsePasteDestination', () => {
  it('returns folder id when browsing inside a managed folder', () => {
    expect(
      resolveBrowsePasteDestination({
        libraryOpen: true,
        showTrash: false,
        showTagManagement: false,
        assetScope: 'folder-1',
        selectedFolderId: 'folder-1',
      }),
    ).toBe('folder-1');
  });

  it('returns null for Assets root scopes', () => {
    expect(
      resolveBrowsePasteDestination({
        libraryOpen: true,
        showTrash: false,
        showTagManagement: false,
        assetScope: 'all',
        selectedFolderId: undefined,
      }),
    ).toBeNull();
    expect(
      resolveBrowsePasteDestination({
        libraryOpen: true,
        showTrash: false,
        showTagManagement: false,
        assetScope: 'root',
        selectedFolderId: undefined,
      }),
    ).toBeNull();
  });

  it('returns undefined when paste is unavailable', () => {
    expect(
      resolveBrowsePasteDestination({
        libraryOpen: true,
        showTrash: true,
        showTagManagement: false,
        assetScope: 'all',
        selectedFolderId: undefined,
      }),
    ).toBeUndefined();
    expect(
      resolveBrowsePasteDestination({
        libraryOpen: true,
        showTrash: false,
        showTagManagement: true,
        assetScope: 'all',
        selectedFolderId: undefined,
      }),
    ).toBeUndefined();
  });
});
