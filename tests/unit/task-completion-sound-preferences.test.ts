import { describe, expect, it } from "vitest";

import {
  DEFAULT_TASK_COMPLETION_SOUND_PREFERENCES,
  TASK_COMPLETION_SOUND_PREFERENCES_KEY,
  loadTaskCompletionSoundPreferences,
  saveTaskCompletionSoundPreferences,
  type TaskCompletionSoundPreferencesStorage,
} from "../../src/renderer/task-completion-sound-preferences";

function memoryStorage(
  initial?: Record<string, string>,
): TaskCompletionSoundPreferencesStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial ?? {}));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("task completion sound preferences", () => {
  it("defaults to enabled", () => {
    expect(loadTaskCompletionSoundPreferences(memoryStorage())).toEqual(
      DEFAULT_TASK_COMPLETION_SOUND_PREFERENCES,
    );
  });

  it("round-trips the disabled state", () => {
    const storage = memoryStorage();
    saveTaskCompletionSoundPreferences({ version: 1, enabled: false }, storage);

    expect(loadTaskCompletionSoundPreferences(storage)).toEqual({
      version: 1,
      enabled: false,
    });
    expect(storage.data.get(TASK_COMPLETION_SOUND_PREFERENCES_KEY)).toContain(
      '"enabled":false',
    );
  });

  it("falls back when the stored value is malformed", () => {
    const storage = memoryStorage({
      [TASK_COMPLETION_SOUND_PREFERENCES_KEY]: "not-json",
    });

    expect(loadTaskCompletionSoundPreferences(storage)).toEqual(
      DEFAULT_TASK_COMPLETION_SOUND_PREFERENCES,
    );
  });
});
