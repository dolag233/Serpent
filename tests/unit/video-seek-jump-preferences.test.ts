import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIDEO_SEEK_JUMP_PREFERENCES,
  loadVideoSeekJumpPreferences,
  saveVideoSeekJumpPreferences,
  type VideoSeekJumpPreferencesStorage,
} from "../../src/renderer/video-seek-jump-preferences";

function memoryStorage(): VideoSeekJumpPreferencesStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => {
      raw.set(key, value);
    },
  };
}

describe("video seek jump preferences", () => {
  it("defaults to a 2 second jump and keeps 5 percent for the other mode", () => {
    expect(DEFAULT_VIDEO_SEEK_JUMP_PREFERENCES).toEqual({
      version: 1,
      mode: "time",
      seconds: 2,
      percent: 5,
    });
    const storage = memoryStorage();
    expect(loadVideoSeekJumpPreferences(storage)).toEqual(
      DEFAULT_VIDEO_SEEK_JUMP_PREFERENCES,
    );
  });

  it("stores a clamped percent mode without dropping the time value", () => {
    const storage = memoryStorage();
    const saved = saveVideoSeekJumpPreferences({
      version: 1,
      mode: "percent",
      seconds: 4,
      percent: 250,
    }, storage);
    expect(saved).toEqual({ version: 1, mode: "percent", seconds: 4, percent: 100 });
    expect(loadVideoSeekJumpPreferences(storage)).toEqual(saved);
  });
});