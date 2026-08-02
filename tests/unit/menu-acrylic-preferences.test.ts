import { describe, expect, it } from "vitest";

import {
  DEFAULT_MENU_ACRYLIC_PREFERENCES,
  MENU_ACRYLIC_PREF_KEY,
  clampMenuAcrylicLevel,
  loadMenuAcrylicPreferences,
  saveMenuAcrylicPreferences,
  setStoredMenuAcrylicLevel,
  type MenuAcrylicPreferencesStorage,
} from "../../src/renderer/menu-acrylic-preferences";

function memoryStorage(
  initial?: Record<string, string>,
): MenuAcrylicPreferencesStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("menu-acrylic-preferences", () => {
  it("defaults to the current low acrylic treatment", () => {
    expect(loadMenuAcrylicPreferences(memoryStorage())).toEqual(
      DEFAULT_MENU_ACRYLIC_PREFERENCES,
    );
    expect(DEFAULT_MENU_ACRYLIC_PREFERENCES.level).toBe(1);
  });

  it("round-trips all four levels", () => {
    const storage = memoryStorage();
    saveMenuAcrylicPreferences({ version: 1, level: 0 }, storage);
    expect(loadMenuAcrylicPreferences(storage).level).toBe(0);
    expect(setStoredMenuAcrylicLevel(3, storage).level).toBe(3);
    expect(storage.data.get(MENU_ACRYLIC_PREF_KEY)).toContain('"level":3');
  });

  it("clamps slider values and falls back on invalid data", () => {
    expect(clampMenuAcrylicLevel(-1)).toBe(0);
    expect(clampMenuAcrylicLevel(1.6)).toBe(2);
    expect(clampMenuAcrylicLevel(99)).toBe(3);
    const storage = memoryStorage({ [MENU_ACRYLIC_PREF_KEY]: "{not-json" });
    expect(loadMenuAcrylicPreferences(storage)).toEqual(
      DEFAULT_MENU_ACRYLIC_PREFERENCES,
    );
  });
});
