import { z } from 'zod';

// ---------------------------------------------------------------------------
// Per-folder "include subfolders" preference (REQ-FOLDER-009)
//
// Which managed/linked folders recurse into descendants is remembered across
// restarts, keyed by library id + folder id. Only enabled folders are stored
// (absence means direct-children only).
// ---------------------------------------------------------------------------

export interface FolderRecursivePreferences {
  readonly version: 1;
  readonly byLibrary: Readonly<
    Record<string, Readonly<Record<string, true>>>
  >;
}

export interface FolderRecursivePreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const FOLDER_RECURSIVE_PREF_KEY = 'serpent.folder-recursive.v1';

export const DEFAULT_FOLDER_RECURSIVE_PREFERENCES: FolderRecursivePreferences = {
  version: 1,
  byLibrary: {},
};

const folderRecursivePreferencesSchema = z.object({
  version: z.literal(1),
  byLibrary: z.record(z.string(), z.record(z.string(), z.literal(true))),
});

function resolveStorage(
  storage?: FolderRecursivePreferencesStorage,
): FolderRecursivePreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: FolderRecursivePreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      'FolderRecursivePreferences: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return ls;
}

export function loadFolderRecursivePreferences(
  storage?: FolderRecursivePreferencesStorage,
): FolderRecursivePreferences {
  const s = resolveStorage(storage);
  const raw = s.getItem(FOLDER_RECURSIVE_PREF_KEY);
  if (raw === null) return DEFAULT_FOLDER_RECURSIVE_PREFERENCES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_FOLDER_RECURSIVE_PREFERENCES;
  }
  const result = folderRecursivePreferencesSchema.safeParse(parsed);
  return result.success ? result.data : DEFAULT_FOLDER_RECURSIVE_PREFERENCES;
}

export function isFolderRecursiveEnabled(
  prefs: FolderRecursivePreferences,
  libraryId: string,
  folderId: string,
): boolean {
  return prefs.byLibrary[libraryId]?.[folderId] === true;
}

/**
 * Returns a new preferences object with `folderId` enabled or cleared.
 * Disabled folders are omitted so the stored map stays sparse.
 */
export function withFolderRecursiveEnabled(
  prefs: FolderRecursivePreferences,
  libraryId: string,
  folderId: string,
  enabled: boolean,
): FolderRecursivePreferences {
  const libraryMap = { ...(prefs.byLibrary[libraryId] ?? {}) };
  if (enabled) {
    libraryMap[folderId] = true;
  } else {
    delete libraryMap[folderId];
  }
  const byLibrary = { ...prefs.byLibrary };
  if (Object.keys(libraryMap).length === 0) {
    delete byLibrary[libraryId];
  } else {
    byLibrary[libraryId] = libraryMap;
  }
  return { version: 1, byLibrary };
}

export function saveFolderRecursivePreferences(
  prefs: FolderRecursivePreferences,
  storage?: FolderRecursivePreferencesStorage,
): void {
  const s = resolveStorage(storage);
  const cleaned: FolderRecursivePreferences = {
    version: 1,
    byLibrary: prefs.byLibrary,
  };
  s.setItem(FOLDER_RECURSIVE_PREF_KEY, JSON.stringify(cleaned));
}
