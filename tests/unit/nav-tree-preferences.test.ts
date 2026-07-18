import { describe, expect, it } from "vitest";

import {
  DEFAULT_NAV_TREE_PREFERENCES,
  loadNavTreePreferences,
  saveNavTreePreferences,
  withCollapsedFolderIds,
  type NavTreePreferencesStorage,
} from "../../src/renderer/nav-tree-preferences";

function memoryStorage(
  initial: Record<string, string> = {},
): NavTreePreferencesStorage {
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

describe("nav-tree-preferences", () => {
  it("defaults to fully expanded", () => {
    expect(loadNavTreePreferences(memoryStorage())).toEqual(
      DEFAULT_NAV_TREE_PREFERENCES,
    );
  });

  it("round-trips collapsed folder ids", () => {
    const storage = memoryStorage();
    const prefs = withCollapsedFolderIds(DEFAULT_NAV_TREE_PREFERENCES, [
      "a",
      "b",
    ]);
    saveNavTreePreferences(prefs, storage);
    expect(loadNavTreePreferences(storage).collapsedFolderIds).toEqual([
      "a",
      "b",
    ]);
  });
});
