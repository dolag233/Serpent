import { describe, expect, it } from 'vitest';

import {
  BROWSE_SORT_PREF_KEY,
  DEFAULT_BROWSE_SORT_PREFERENCES,
  loadBrowseSortPreferences,
  saveBrowseSortPreferences,
} from '../../src/renderer/browse-sort-preferences';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('browse sort preferences', () => {
  it('defaults to name ascending', () => {
    expect(DEFAULT_BROWSE_SORT_PREFERENCES).toEqual({
      version: 1,
      field: 'name',
      order: 'asc',
    });
  });

  it('round-trips valid preferences through storage', () => {
    const storage = memoryStorage();
    saveBrowseSortPreferences(
      { version: 1, field: 'modified_at', order: 'desc' },
      storage,
    );
    expect(loadBrowseSortPreferences(storage)).toEqual({
      version: 1,
      field: 'modified_at',
      order: 'desc',
    });
    expect(storage.getItem(BROWSE_SORT_PREF_KEY)).toBe(
      JSON.stringify({ version: 1, field: 'modified_at', order: 'desc' }),
    );
  });

  it('falls back to defaults for corrupt storage', () => {
    const storage = memoryStorage();
    storage.setItem(BROWSE_SORT_PREF_KEY, '{not json');
    expect(loadBrowseSortPreferences(storage)).toEqual(
      DEFAULT_BROWSE_SORT_PREFERENCES,
    );
  });

  it('rejects unknown sort fields on save', () => {
    const storage = memoryStorage();
    expect(() =>
      saveBrowseSortPreferences(
        {
          version: 1,
          field: 'relevance' as 'name',
          order: 'asc',
        },
        storage,
      ),
    ).toThrow();
  });
});
