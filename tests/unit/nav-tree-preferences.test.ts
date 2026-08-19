import { describe, expect, it } from "vitest";

import {
  DEFAULT_NAV_TREE_PREFERENCES,
  loadNavTreePreferences,
  saveNavTreePreferences,
  withCollapsedCollectionIds,
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

  it("round-trips collapsed collection ids (Serpent-c42eb1)", () => {
    const storage = memoryStorage();
    const prefs = withCollapsedCollectionIds(DEFAULT_NAV_TREE_PREFERENCES, [
      "col-a",
      "col-b",
    ]);
    saveNavTreePreferences(prefs, storage);
    expect(loadNavTreePreferences(storage).collapsedCollectionIds).toEqual([
      "col-a",
      "col-b",
    ]);
    // Folder collapse state is preserved alongside collection collapse.
    expect(loadNavTreePreferences(storage).collapsedFolderIds).toEqual([]);
  });

  it("loads legacy v1 data without collapsedCollectionIds", () => {
    const storage = memoryStorage({
      "serpent.nav-tree-prefs.v1": JSON.stringify({
        version: 1,
        collapsedFolderIds: ["f1"],
      }),
    });
    const loaded = loadNavTreePreferences(storage);
    expect(loaded.collapsedFolderIds).toEqual(["f1"]);
    expect(loaded.collapsedCollectionIds ?? []).toEqual([]);
  });
});
