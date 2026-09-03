// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_FONT_SIZE_PREFERENCES,
  FONT_SIZE_INDEX_MAX,
  FONT_SIZE_INDEX_MIN,
  FONT_SIZE_PREFERENCES_KEY,
  FONT_SIZE_SCALES,
  applyFontSizePreferences,
  fontSizePreferenceFromIndex,
  fontSizePreferenceToIndex,
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

  it("persists only the versioned four-tier contract", () => {
    const source = storage();
    const next = setStoredFontSizePreference("large", source);
    expect(next.preference).toBe("large");
    expect(source.getItem(FONT_SIZE_PREFERENCES_KEY)).toBe(
      JSON.stringify({ version: 1, preference: "large" }),
    );
    expect(loadFontSizePreferences(source)).toEqual(next);
    expect(saveFontSizePreferences(DEFAULT_FONT_SIZE_PREFERENCES, source)).toBe(true);
  });

  it("maps slider indices to the four preferences and clamps invalid positions", () => {
    expect(fontSizePreferenceToIndex("compact")).toBe(FONT_SIZE_INDEX_MIN);
    expect(fontSizePreferenceFromIndex(0)).toBe("compact");
    expect(fontSizePreferenceFromIndex(1)).toBe("default");
    expect(fontSizePreferenceFromIndex(2)).toBe("comfortable");
    expect(fontSizePreferenceFromIndex(FONT_SIZE_INDEX_MAX)).toBe("large");
    expect(fontSizePreferenceFromIndex(-1)).toBe("compact");
    expect(fontSizePreferenceFromIndex(99)).toBe("large");
    expect(fontSizePreferenceFromIndex(Number.NaN)).toBe("default");
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
