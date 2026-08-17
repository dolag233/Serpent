import { describe, expect, it } from "vitest";

import {
  DEFAULT_INSPECTOR_CARD_FEEL_PREFERENCES,
  INSPECTOR_CARD_FEEL_PREF_KEY,
  isInspectorCardFeelEnabled,
  loadInspectorCardFeelPreferences,
  setInspectorCardFeelEnabled,
  type InspectorCardFeelPreferencesStorage,
} from "../../src/renderer/inspector-card-feel-preferences";

function memoryStorage(
  initial: Record<string, string> = {},
): InspectorCardFeelPreferencesStorage {
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

describe("inspector-card-feel-preferences", () => {
  it("defaults to enabled", () => {
    const storage = memoryStorage();
    expect(loadInspectorCardFeelPreferences(storage)).toEqual(
      DEFAULT_INSPECTOR_CARD_FEEL_PREFERENCES,
    );
    expect(isInspectorCardFeelEnabled(storage)).toBe(true);
  });

  it("persists disabling the effect", () => {
    const storage = memoryStorage();
    setInspectorCardFeelEnabled(false, storage);
    expect(isInspectorCardFeelEnabled(storage)).toBe(false);
    expect(storage.getItem(INSPECTOR_CARD_FEEL_PREF_KEY)).toContain(
      '"enabled":false',
    );
    setInspectorCardFeelEnabled(true, storage);
    expect(isInspectorCardFeelEnabled(storage)).toBe(true);
  });

  it("falls back to defaults on corrupt storage", () => {
    const storage = memoryStorage({
      [INSPECTOR_CARD_FEEL_PREF_KEY]: "{not-json",
    });
    expect(loadInspectorCardFeelPreferences(storage)).toEqual(
      DEFAULT_INSPECTOR_CARD_FEEL_PREFERENCES,
    );
  });
});
