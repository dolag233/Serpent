import { describe, expect, it, vi } from "vitest";

import {
  createTaskCompletionSound,
  TASK_COMPLETION_SOUND_VOLUME,
} from "../../src/renderer/task-completion-sound";

describe("task completion sound", () => {
  it("reuses one quiet audio player and rewinds it for every result", async () => {
    const play = vi.fn(() => Promise.resolve());
    const player = { currentTime: 12, volume: 1, play };
    const factory = vi.fn(() => player);
    const playCompletionSound = createTaskCompletionSound(factory);

    playCompletionSound();
    playCompletionSound();
    await Promise.resolve();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(expect.any(String));
    expect(player.volume).toBe(TASK_COMPLETION_SOUND_VOLUME);
    expect(player.currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("swallows platform playback failures", async () => {
    const playCompletionSound = createTaskCompletionSound(() => ({
      currentTime: 0,
      volume: 1,
      play: () => Promise.reject(new Error("autoplay blocked")),
    }));

    expect(() => playCompletionSound()).not.toThrow();
    await Promise.resolve();
  });

  it("does not create or play audio when the preference is disabled", () => {
    const factory = vi.fn(() => ({
      currentTime: 0,
      volume: 1,
      play: vi.fn(),
    }));
    const playCompletionSound = createTaskCompletionSound(factory, () => false);

    playCompletionSound();

    expect(factory).not.toHaveBeenCalled();
  });
});
