import { describe, expect, it } from "vitest";

import {
  DEFAULT_FOLDER_SORT_PREFERENCES,
  FOLDER_SORT_PREF_KEY,
  loadFolderSortPreferences,
  saveFolderSortPreferences,
  withFolderSort,
  type FolderSortPreferencesStorage,
} from "../../src/renderer/folder-sort-preferences";

function memoryStorage(initial: Record<string, string> = {}): FolderSortPreferencesStorage & {
  dump(): Record<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    dump: () => Object.fromEntries(data),
  };
}

describe("folder-sort-preferences", () => {
  it("returns the default name sort when unset", () => {
    expect(loadFolderSortPreferences(memoryStorage())).toEqual(
      DEFAULT_FOLDER_SORT_PREFERENCES,
    );
  });

  it("round-trips a chosen sort mode and order through storage", () => {
    const storage = memoryStorage();
    saveFolderSortPreferences(
      withFolderSort(DEFAULT_FOLDER_SORT_PREFERENCES, {
        mode: "count",
        order: "desc",
      }),
      storage,
    );
    expect(loadFolderSortPreferences(storage)).toEqual({
      version: 1,
      mode: "count",
      order: "desc",
    });
    expect(storage.dump()[FOLDER_SORT_PREF_KEY]).toContain('"count"');
    expect(storage.dump()[FOLDER_SORT_PREF_KEY]).toContain('"desc"');
  });

  it("loads a legacy mode-only value with ascending order", () => {
    // Pre-direction builds persisted `{ version: 1, mode }` only.
    expect(
      loadFolderSortPreferences(
        memoryStorage({
          [FOLDER_SORT_PREF_KEY]: JSON.stringify({
            version: 1,
            mode: "count",
          }),
        }),
      ),
    ).toEqual({ version: 1, mode: "count", order: "asc" });
  });

  it("falls back to the default on corrupt or unknown data", () => {
    expect(
      loadFolderSortPreferences(
        memoryStorage({ [FOLDER_SORT_PREF_KEY]: "{not-json" }),
      ),
    ).toEqual(DEFAULT_FOLDER_SORT_PREFERENCES);
    expect(
      loadFolderSortPreferences(
        memoryStorage({
          [FOLDER_SORT_PREF_KEY]: JSON.stringify({
            version: 1,
            mode: "bogus",
          }),
        }),
      ),
    ).toEqual(DEFAULT_FOLDER_SORT_PREFERENCES);
  });
});