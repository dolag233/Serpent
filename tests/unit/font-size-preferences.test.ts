// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_FONT_SIZE_PREFERENCES,
  FONT_SIZE_PREFERENCES_KEY,
  FONT_SIZE_SCALES,
  applyFontSizePreferences,
  loadFontSizePreferences,
  parseFontSizePreferences,
  saveFontSizePreferences,
  setStoredFontSizePreference,
} from "../../src/renderer/font-size-preferences";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("font-size preferences", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-font-size");
    document.documentElement.style.removeProperty("--ui-font-scale");
  });

  it("falls back safely for missing, malformed, and unknown stored values", () => {
    expect(parseFontSizePreferences(null)).toEqual(DEFAULT_FONT_SIZE_PREFERENCES);
    expect(parseFontSizePreferences("not-json")).toEqual(DEFAULT_FONT_SIZE_PREFERENCES);
    expect(parseFontSizePreferences(JSON.stringify({ version: 1, preference: "huge" })))
      .toEqual(DEFAULT_FONT_SIZE_PREFERENCES);
  });

  it("persists only the versioned three-tier contract", () => {
    const source = storage();
    const next = setStoredFontSizePreference("comfortable", source);
    expect(next.preference).toBe("comfortable");
    expect(source.getItem(FONT_SIZE_PREFERENCES_KEY)).toBe(
      JSON.stringify({ version: 1, preference: "comfortable" }),
    );
    expect(loadFontSizePreferences(source)).toEqual(next);
    expect(saveFontSizePreferences(DEFAULT_FONT_SIZE_PREFERENCES, source)).toBe(true);
  });

  it("applies the app scale without using page zoom", () => {
    applyFontSizePreferences(
      { version: 1, preference: "compact" },
      document.documentElement,
    );
    expect(document.documentElement.dataset.fontSize).toBe("compact");
    expect(document.documentElement.style.getPropertyValue("--ui-font-scale"))
      .toBe(String(FONT_SIZE_SCALES.compact));
    expect(document.documentElement.style.getPropertyValue("zoom")).toBe("");
  });
});
