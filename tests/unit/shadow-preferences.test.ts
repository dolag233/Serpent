import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHADOW_PREFERENCES,
  SHADOW_LEVEL_PRESETS,
  SHADOW_PREF_KEY,
  applyShadowPreferences,
  clampShadowLevel,
  isShadowElevationEnabled,
  loadShadowPreferences,
  saveShadowPreferences,
  setStoredShadowLevel,
  shadowLevelToPreset,
  shadowPreferenceToMultiplier,
  type ShadowPreferencesStorage,
} from "../../src/renderer/shadow-preferences";

function memoryStorage(
  initial?: Record<string, string>,
): ShadowPreferencesStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("shadow-preferences (Serpent-zcyg)", () => {
  it("defaults to level 2 (former more)", () => {
    expect(loadShadowPreferences(memoryStorage())).toEqual(
      DEFAULT_SHADOW_PREFERENCES,
    );
    expect(DEFAULT_SHADOW_PREFERENCES.level).toBe(2);
    expect(isShadowElevationEnabled(0)).toBe(false);
    expect(isShadowElevationEnabled(2)).toBe(true);
    expect(shadowLevelToPreset(2)).toEqual(SHADOW_LEVEL_PRESETS[2]);
  });

  it("round-trips levels 0–3", () => {
    const storage = memoryStorage();
    saveShadowPreferences({ version: 3, level: 0 }, storage);
    expect(loadShadowPreferences(storage).level).toBe(0);
    expect(setStoredShadowLevel(3, storage).level).toBe(3);
    expect(storage.data.get(SHADOW_PREF_KEY)).toContain('"level":3');
  });

  it("migrates v2 more/less and v1 sliders", () => {
    const storage = memoryStorage({
      [SHADOW_PREF_KEY]: JSON.stringify({ version: 2, amount: "less" }),
    });
    expect(loadShadowPreferences(storage).level).toBe(1);

    storage.setItem(
      SHADOW_PREF_KEY,
      JSON.stringify({ version: 2, amount: "more" }),
    );
    expect(loadShadowPreferences(storage).level).toBe(2);

    storage.setItem(
      SHADOW_PREF_KEY,
      JSON.stringify({ version: 1, size: 5, intensity: 0 }),
    );
    expect(loadShadowPreferences(storage).level).toBe(0);
  });

  it("clamps and falls back on corrupt JSON", () => {
    expect(clampShadowLevel(-1)).toBe(0);
    expect(clampShadowLevel(1.6)).toBe(2);
    expect(clampShadowLevel(99)).toBe(3);
    const storage = memoryStorage({ [SHADOW_PREF_KEY]: "{not-json" });
    expect(loadShadowPreferences(storage)).toEqual(DEFAULT_SHADOW_PREFERENCES);
  });

  it("maps preference midpoints to multiplier 1", () => {
    expect(shadowPreferenceToMultiplier(50)).toBe(1);
    expect(shadowPreferenceToMultiplier(0)).toBe(0);
    expect(shadowPreferenceToMultiplier(100)).toBe(2);
  });

  it("no-ops applyShadowPreferences when document is unavailable", () => {
    expect(() =>
      applyShadowPreferences({ version: 3, level: 0 }),
    ).not.toThrow();
  });
});
