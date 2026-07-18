import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FOLDER_RECURSIVE_PREFERENCES,
  isFolderRecursiveEnabled,
  loadFolderRecursivePreferences,
  saveFolderRecursivePreferences,
  withFolderRecursiveEnabled,
  type FolderRecursivePreferencesStorage,
} from '../../src/renderer/folder-recursive-preferences';

function memoryStorage(
  initial: Record<string, string> = {},
): FolderRecursivePreferencesStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('folder-recursive-preferences (REQ-FOLDER-009)', () => {
  it('defaults to disabled for unknown folders', () => {
    expect(
      isFolderRecursiveEnabled(
        DEFAULT_FOLDER_RECURSIVE_PREFERENCES,
        'lib-a',
        'folder-a',
      ),
    ).toBe(false);
  });

  it('persists only enabled folders sparsely', () => {
    const storage = memoryStorage();
    let prefs = withFolderRecursiveEnabled(
      DEFAULT_FOLDER_RECURSIVE_PREFERENCES,
      'lib-a',
      'folder-a',
      true,
    );
    prefs = withFolderRecursiveEnabled(prefs, 'lib-a', 'folder-b', true);
    prefs = withFolderRecursiveEnabled(prefs, 'lib-a', 'folder-b', false);
    saveFolderRecursivePreferences(prefs, storage);

    const loaded = loadFolderRecursivePreferences(storage);
    expect(isFolderRecursiveEnabled(loaded, 'lib-a', 'folder-a')).toBe(true);
    expect(isFolderRecursiveEnabled(loaded, 'lib-a', 'folder-b')).toBe(false);
    expect(loaded.byLibrary['lib-a']).toEqual({ 'folder-a': true });
  });

  it('rejects corrupt storage', () => {
    const storage = memoryStorage({
      'serpent.folder-recursive.v1': '{not-json',
    });
    expect(loadFolderRecursivePreferences(storage)).toEqual(
      DEFAULT_FOLDER_RECURSIVE_PREFERENCES,
    );
  });
});
