import { describe, expect, it } from "vitest";

import {
  DEFAULT_FEATURE_HINT_PREFERENCES,
  FEATURE_HINT_PREFERENCES_KEY,
  hasFeatureHintBeenShown,
  loadFeatureHintPreferences,
  saveFeatureHintPreferences,
  withFeatureHintShown,
  type FeatureHintPreferencesStorage,
} from "../../src/renderer/feature-hint-preferences";

function memoryStorage(
  initial?: Record<string, string>,
): FeatureHintPreferencesStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("feature hint preferences", () => {
  it("defaults to enabled with no seen hints", () => {
    expect(loadFeatureHintPreferences(memoryStorage())).toEqual(
      DEFAULT_FEATURE_HINT_PREFERENCES,
    );
  });

  it("round-trips the disabled state and keeps seen keys", () => {
    const storage = memoryStorage();
    const seen = withFeatureHintShown(
      { version: 2, enabled: true, seen: {} },
      "recursive-subfolders:lib:folder-a",
    );
    saveFeatureHintPreferences({ version: 2, enabled: false, seen: seen.seen }, storage);

    expect(loadFeatureHintPreferences(storage)).toEqual({
      version: 2,
      enabled: false,
      seen: { "recursive-subfolders:lib:folder-a": true },
    });
  });

  it("falls back when the stored value is malformed", () => {
    const storage = memoryStorage({
      [FEATURE_HINT_PREFERENCES_KEY]: "not-json",
    });

    expect(loadFeatureHintPreferences(storage)).toEqual(
      DEFAULT_FEATURE_HINT_PREFERENCES,
    );
  });

  it("withFeatureHintShown records a key once and is idempotent", () => {
    const base = { version: 2 as const, enabled: true, seen: {} };
    const once = withFeatureHintShown(base, "k");
    const twice = withFeatureHintShown(once, "k");
    expect(hasFeatureHintBeenShown(once, "k")).toBe(true);
    expect(twice).toBe(once);
    expect(hasFeatureHintBeenShown(twice, "other")).toBe(false);
  });
});