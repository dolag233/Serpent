// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/renderer/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("../../src/renderer/icon-action-attrs", () => ({
  iconActionAttrs: () => ({ "aria-label": "action" }),
}));
vi.mock("../../src/renderer/ViewerVolumeControls", () => ({
  ViewerVolumeControls: () => null,
}));
vi.mock("../../src/renderer/viewer-volume-preferences", () => ({
  applyViewerVolumeToMedia: () => undefined,
}));
vi.mock("../../src/renderer/media-seek-session", () => ({
  createMediaSeekSession: () => ({
    request: () => undefined,
    commit: () => undefined,
    cancel: () => undefined,
    onSeeked: () => undefined,
  }),
}));

import { AudioPlayerControls } from "../../src/renderer/AudioPlayerControls";

// React 19 act() requires the global flag to actually wrap updates; without
// it every act() call warns "not configured to support act(...)".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("AudioPlayerControls trail pump (Serpent-mrsm)", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let rafCallback: FrameRequestCallback | null = null;
  let rafCount = 0;
  let cancelCount = 0;

  beforeEach(() => {
    rafCallback = null;
    rafCount = 0;
    cancelCount = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      rafCount += 1;
      rafCallback = callback;
      return rafCount;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      cancelCount += 1;
    });
  });

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    vi.restoreAllMocks();
  });

  async function renderControls(): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(AudioPlayerControls, {
          muted: false,
          onError: () => undefined,
          onMutedChange: () => undefined,
          onVolumeChange: () => undefined,
          src: "file:///audio.mp3",
          volume: 0.8,
        }),
      );
    });
  }

  /** Drive one pump frame with a fake timestamp; false when nothing was scheduled. */
  async function driveFrame(nowMs: number): Promise<boolean> {
    const callback = rafCallback;
    rafCallback = null;
    if (!callback) return false;
    await act(async () => {
      callback(nowMs);
    });
    return true;
  }

  /** Give the audio element controllable media state + event-driven play/pause. */
  function prepareAudio(): HTMLAudioElement {
    const audio = container!.querySelector("audio")! as HTMLAudioElement;
    let paused = true;
    Object.defineProperty(audio, "paused", {
      configurable: true,
      get: () => paused,
    });
    Object.defineProperty(audio, "ended", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      get: () => 10,
    });
    Object.defineProperty(audio, "duration", {
      configurable: true,
      get: () => 100,
    });
    audio.play = () => {
      paused = false;
      audio.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    audio.pause = () => {
      paused = true;
      audio.dispatchEvent(new Event("pause"));
    };
    return audio;
  }

  it("stops the pump when paused with an empty trail and restarts on play", async () => {
    await renderControls();
    const audio = prepareAudio();

    // Paused from the start with no particles: no frame is ever scheduled.
    expect(rafCount).toBe(0);

    // Playback starts the pump.
    await act(async () => {
      void audio.play();
    });
    expect(rafCount).toBeGreaterThanOrEqual(1);

    // A frame while playing emits a particle and keeps the loop alive.
    await driveFrame(0);
    expect(
      container!.querySelectorAll(".preview-audio-trail-particle").length,
    ).toBe(1);
    expect(rafCount).toBeGreaterThanOrEqual(2);

    // Pause: the trail is still fading, so the pump keeps running.
    await act(async () => {
      audio.pause();
    });
    expect(rafCount).toBeGreaterThanOrEqual(2);

    // A mid-lifetime frame keeps the particle visible…
    await driveFrame(500);
    expect(
      container!.querySelectorAll(".preview-audio-trail-particle").length,
    ).toBe(1);

    // …then the trail fully dissipates and the pump stops scheduling.
    expect(await driveFrame(1000)).toBe(true);
    expect(
      container!.querySelectorAll(".preview-audio-trail-particle").length,
    ).toBe(0);
    const rafAfterFade = rafCount;
    expect(await driveFrame(1001)).toBe(false);
    expect(rafCount).toBe(rafAfterFade);

    // Resuming playback restarts the pump.
    await act(async () => {
      void audio.play();
    });
    expect(rafCount).toBeGreaterThan(rafAfterFade);

    // Unmount cancels the in-flight frame.
    await act(async () => {
      root?.unmount();
      root = undefined;
    });
    expect(cancelCount).toBeGreaterThan(0);
  });
});
