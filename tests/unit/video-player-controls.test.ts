import { describe, expect, it } from "vitest";

import {
  isEditableKeyboardTarget,
  nextPlaybackIntent,
  parsePlaybackRate,
  shouldHandleVideoSpaceKey,
  VIDEO_PLAYBACK_RATES,
} from "../../src/renderer/video-player-controls";

describe("VIDEO_PLAYBACK_RATES", () => {
  it("includes the required 0.5x / 1x / 1.5x / 2x rates", () => {
    expect(VIDEO_PLAYBACK_RATES).toEqual(
      expect.arrayContaining([0.5, 1, 1.5, 2]),
    );
  });
});

describe("nextPlaybackIntent", () => {
  it("plays when paused and pauses when playing", () => {
    expect(nextPlaybackIntent(true)).toBe("play");
    expect(nextPlaybackIntent(false)).toBe("pause");
  });
});

describe("parsePlaybackRate", () => {
  it("accepts known rates and falls back to 1", () => {
    expect(parsePlaybackRate("1.5")).toBe(1.5);
    expect(parsePlaybackRate("0.5")).toBe(0.5);
    expect(parsePlaybackRate("9")).toBe(1);
    expect(parsePlaybackRate("nope")).toBe(1);
  });
});

describe("isEditableKeyboardTarget", () => {
  it("detects input, textarea, select, and contenteditable", () => {
    expect(isEditableKeyboardTarget({ tagName: "INPUT" })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "SELECT" })).toBe(true);
    expect(isEditableKeyboardTarget({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
    expect(isEditableKeyboardTarget({ tagName: "DIV" })).toBe(false);
    expect(isEditableKeyboardTarget(null)).toBe(false);
  });

  it("treats targets inside a dialog as editable", () => {
    expect(
      isEditableKeyboardTarget({
        tagName: "DIV",
        closest: (selector) =>
          selector === '[role="dialog"]' ? {} : null,
      }),
    ).toBe(true);
  });
});

describe("shouldHandleVideoSpaceKey", () => {
  it("handles Space when not typing and not repeating", () => {
    expect(
      shouldHandleVideoSpaceKey({
        key: " ",
        code: "Space",
        repeat: false,
        target: { tagName: "DIV" },
      }),
    ).toBe(true);
  });

  it("ignores repeats, non-space keys, and editable targets", () => {
    expect(
      shouldHandleVideoSpaceKey({
        key: " ",
        repeat: true,
        target: { tagName: "DIV" },
      }),
    ).toBe(false);
    expect(
      shouldHandleVideoSpaceKey({
        key: "Enter",
        repeat: false,
        target: { tagName: "DIV" },
      }),
    ).toBe(false);
    expect(
      shouldHandleVideoSpaceKey({
        key: " ",
        repeat: false,
        target: { tagName: "INPUT" },
      }),
    ).toBe(false);
  });

  it("does not steal Space from focused chrome buttons", () => {
    expect(
      shouldHandleVideoSpaceKey({
        key: " ",
        repeat: false,
        target: { tagName: "BUTTON" },
      }),
    ).toBe(false);
  });
});
