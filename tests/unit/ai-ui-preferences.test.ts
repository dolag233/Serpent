import { describe, expect, it } from "vitest";

import {
  AI_UI_PREF_KEY,
  DEFAULT_AI_UI_PREFERENCES,
  loadAiUiPreferences,
  saveAiUiPreferences,
  type AiUiPreferencesStorage,
} from "../../src/renderer/ai-ui-preferences";

function memoryStorage(
  initial?: Record<string, string>,
): AiUiPreferencesStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe("ai-ui-preferences (Serpent-t8sw)", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadAiUiPreferences(memoryStorage())).toEqual(
      DEFAULT_AI_UI_PREFERENCES,
    );
  });

  it("round-trips showAiBadges through storage", () => {
    const storage = memoryStorage();
    saveAiUiPreferences({ version: 1, showAiBadges: false }, storage);
    expect(loadAiUiPreferences(storage)).toEqual({
      version: 1,
      showAiBadges: false,
    });
    expect(storage.data.get(AI_UI_PREF_KEY)).toContain('"showAiBadges":false');
  });

  it("falls back on corrupt JSON", () => {
    const storage = memoryStorage({ [AI_UI_PREF_KEY]: "{not-json" });
    expect(loadAiUiPreferences(storage)).toEqual(DEFAULT_AI_UI_PREFERENCES);
  });
});
