import { z } from 'zod';

/**
 * Shared preference for the irreversible "delete from disk" confirmation
 * (clarification #7). Folder/asset/library delete share this key; the
 * settings toggle (Serpent-5no) re-enables the prompt after "don't show again".
 */

export interface DiskDeleteConfirmPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DISK_DELETE_CONFIRM_PREF_KEY = 'serpent.disk-delete-confirm.v1';

const diskDeleteConfirmPreferencesSchema = z.object({
  version: z.literal(1),
  /** When false, skip the irreversible confirmation dialog. */
  promptEnabled: z.boolean(),
});

export interface DiskDeleteConfirmPreferences {
  readonly version: 1;
  readonly promptEnabled: boolean;
}

export const DEFAULT_DISK_DELETE_CONFIRM_PREFERENCES: DiskDeleteConfirmPreferences =
  {
    version: 1,
    promptEnabled: true,
  };

function resolveStorage(
  storage?: DiskDeleteConfirmPreferencesStorage,
): DiskDeleteConfirmPreferencesStorage {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: DiskDeleteConfirmPreferencesStorage })
    .localStorage;
  if (!ls) {
    throw new Error(
      'DiskDeleteConfirmPreferences: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return ls;
}

export function loadDiskDeleteConfirmPreferences(
  storage?: DiskDeleteConfirmPreferencesStorage,
): DiskDeleteConfirmPreferences {
  const store = resolveStorage(storage);
  const raw = store.getItem(DISK_DELETE_CONFIRM_PREF_KEY);
  if (!raw) return DEFAULT_DISK_DELETE_CONFIRM_PREFERENCES;
  try {
    const parsed = diskDeleteConfirmPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_DISK_DELETE_CONFIRM_PREFERENCES;
  } catch {
    return DEFAULT_DISK_DELETE_CONFIRM_PREFERENCES;
  }
}

export function saveDiskDeleteConfirmPreferences(
  preferences: DiskDeleteConfirmPreferences,
  storage?: DiskDeleteConfirmPreferencesStorage,
): void {
  const store = resolveStorage(storage);
  const parsed = diskDeleteConfirmPreferencesSchema.parse(preferences);
  store.setItem(DISK_DELETE_CONFIRM_PREF_KEY, JSON.stringify(parsed));
}

export function isDiskDeletePromptEnabled(
  storage?: DiskDeleteConfirmPreferencesStorage,
): boolean {
  return loadDiskDeleteConfirmPreferences(storage).promptEnabled;
}

export function setDiskDeletePromptEnabled(
  enabled: boolean,
  storage?: DiskDeleteConfirmPreferencesStorage,
): DiskDeleteConfirmPreferences {
  const next: DiskDeleteConfirmPreferences = {
    version: 1,
    promptEnabled: enabled,
  };
  saveDiskDeleteConfirmPreferences(next, storage);
  return next;
}
