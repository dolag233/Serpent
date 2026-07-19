import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DISK_DELETE_CONFIRM_PREFERENCES,
  DISK_DELETE_CONFIRM_PREF_KEY,
  isDiskDeletePromptEnabled,
  loadDiskDeleteConfirmPreferences,
  setDiskDeletePromptEnabled,
  type DiskDeleteConfirmPreferencesStorage,
} from '../../src/renderer/disk-delete-confirm-preferences';

function memoryStorage(
  initial: Record<string, string> = {},
): DiskDeleteConfirmPreferencesStorage {
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

describe('disk-delete-confirm-preferences', () => {
  it('defaults to prompting enabled', () => {
    const storage = memoryStorage();
    expect(loadDiskDeleteConfirmPreferences(storage)).toEqual(
      DEFAULT_DISK_DELETE_CONFIRM_PREFERENCES,
    );
    expect(isDiskDeletePromptEnabled(storage)).toBe(true);
  });

  it('persists disabling the prompt under the shared key', () => {
    const storage = memoryStorage();
    setDiskDeletePromptEnabled(false, storage);
    expect(isDiskDeletePromptEnabled(storage)).toBe(false);
    expect(storage.getItem(DISK_DELETE_CONFIRM_PREF_KEY)).toContain(
      '"promptEnabled":false',
    );
    setDiskDeletePromptEnabled(true, storage);
    expect(isDiskDeletePromptEnabled(storage)).toBe(true);
  });

  it('falls back to defaults on corrupt storage', () => {
    const storage = memoryStorage({
      [DISK_DELETE_CONFIRM_PREF_KEY]: '{not-json',
    });
    expect(loadDiskDeleteConfirmPreferences(storage)).toEqual(
      DEFAULT_DISK_DELETE_CONFIRM_PREFERENCES,
    );
  });
});
