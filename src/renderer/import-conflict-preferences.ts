import { z } from 'zod';

/**
 * Remembered import conflict decisions (Serpent-9iyi / gf8n / zp8q).
 * Separate prefs for same-folder name conflicts vs content duplicates.
 */

export interface ImportConflictPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const IMPORT_CONFLICT_PREF_KEY = 'serpent.import-conflict.v1';

export type RememberedNameConflictDecision = 'keep-both' | 'replace' | 'skip';
export type RememberedDuplicateDecision = 'skip' | 'merge' | 'create-copy';

const importConflictPreferencesSchema = z.object({
  version: z.literal(1),
  nameConflict: z.enum(['keep-both', 'replace', 'skip']).nullable(),
  duplicate: z.enum(['skip', 'merge', 'create-copy']).nullable(),
});

export interface ImportConflictPreferences {
  readonly version: 1;
  /** null = always ask */
  readonly nameConflict: RememberedNameConflictDecision | null;
  readonly duplicate: RememberedDuplicateDecision | null;
}

export const DEFAULT_IMPORT_CONFLICT_PREFERENCES: ImportConflictPreferences = {
  version: 1,
  nameConflict: null,
  duplicate: null,
};

function resolveStorage(
  storage?: ImportConflictPreferencesStorage,
): ImportConflictPreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: ImportConflictPreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      'ImportConflictPreferences: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return ls;
}

export function loadImportConflictPreferences(
  storage?: ImportConflictPreferencesStorage,
): ImportConflictPreferences {
  const store = resolveStorage(storage);
  const raw = store.getItem(IMPORT_CONFLICT_PREF_KEY);
  if (!raw) return DEFAULT_IMPORT_CONFLICT_PREFERENCES;
  try {
    const parsed = importConflictPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_IMPORT_CONFLICT_PREFERENCES;
  } catch {
    return DEFAULT_IMPORT_CONFLICT_PREFERENCES;
  }
}

export function saveImportConflictPreferences(
  preferences: ImportConflictPreferences,
  storage?: ImportConflictPreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const parsed = importConflictPreferencesSchema.parse(preferences);
  store.setItem(IMPORT_CONFLICT_PREF_KEY, JSON.stringify(parsed));
}

export function rememberNameConflictDecision(
  decision: RememberedNameConflictDecision,
  storage?: ImportConflictPreferencesStorage,
): ImportConflictPreferences {
  const current = loadImportConflictPreferences(storage);
  const next: ImportConflictPreferences = {
    ...current,
    nameConflict: decision,
  };
  saveImportConflictPreferences(next, storage);
  return next;
}

export function rememberDuplicateDecision(
  decision: RememberedDuplicateDecision,
  storage?: ImportConflictPreferencesStorage,
): ImportConflictPreferences {
  const current = loadImportConflictPreferences(storage);
  const next: ImportConflictPreferences = {
    ...current,
    duplicate: decision,
  };
  saveImportConflictPreferences(next, storage);
  return next;
}

export function clearImportConflictPreferences(
  storage?: ImportConflictPreferencesStorage,
): ImportConflictPreferences {
  saveImportConflictPreferences(DEFAULT_IMPORT_CONFLICT_PREFERENCES, storage);
  return DEFAULT_IMPORT_CONFLICT_PREFERENCES;
}

export function hasRememberedImportConflictPreferences(
  storage?: ImportConflictPreferencesStorage,
): boolean {
  const prefs = loadImportConflictPreferences(storage);
  return prefs.nameConflict !== null || prefs.duplicate !== null;
}
