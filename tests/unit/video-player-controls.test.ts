import { describe, expect, it } from "vitest";

import {
  clampScrubTime,
  formatVideoClockTime,
  isEditableKeyboardTarget,
  nextPlaybackIntent,
  parsePlaybackRate,
  scrubRatioFromClientX,
  scrubRatioFromTime,
  scrubTimeFromRatio,
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

describe("scrubRatioFromClientX", () => {
  it("maps a pointer position to a 0..1 ratio along the track", () => {
    expect(
      scrubRatioFromClientX(50, { left: 0, width: 200 }),
    ).toBeCloseTo(0.25);
    expect(
      scrubRatioFromClientX(200, { left: 100, width: 200 }),
    ).toBeCloseTo(0.5);
  });

  it("clamps to the track bounds before and after the ends", () => {
    expect(scrubRatioFromClientX(-50, { left: 0, width: 200 })).toBe(0);
    expect(scrubRatioFromClientX(9999, { left: 0, width: 200 })).toBe(1);
  });

  it("returns 0 for a zero-width or invalid track", () => {
    expect(scrubRatioFromClientX(50, { left: 0, width: 0 })).toBe(0);
    expect(scrubRatioFromClientX(50, { left: 0, width: Number.NaN })).toBe(0);
  });
});

describe("scrubTimeFromRatio", () => {
  it("scales a 0..1 ratio by duration", () => {
    expect(scrubTimeFromRatio(0.5, 100)).toBe(50);
    expect(scrubTimeFromRatio(0, 100)).toBe(0);
    expect(scrubTimeFromRatio(1, 100)).toBe(100);
  });

  it("clamps out-of-range ratios and non-finite durations", () => {
    expect(scrubTimeFromRatio(-1, 100)).toBe(0);
    expect(scrubTimeFromRatio(2, 100)).toBe(100);
    expect(scrubTimeFromRatio(0.5, 0)).toBe(0);
    expect(scrubTimeFromRatio(0.5, Number.NaN)).toBe(0);
  });
});

describe("scrubRatioFromTime", () => {
  it("inverts scrubTimeFromRatio for rendering fill/thumb position", () => {
    expect(scrubRatioFromTime(50, 100)).toBeCloseTo(0.5);
    expect(scrubRatioFromTime(0, 100)).toBe(0);
    expect(scrubRatioFromTime(100, 100)).toBe(1);
  });

  it("is 0 for a zero/invalid duration or non-finite current time", () => {
    expect(scrubRatioFromTime(50, 0)).toBe(0);
    expect(scrubRatioFromTime(Number.NaN, 100)).toBe(0);
  });

  it("clamps past the end of the track (e.g. rounding at the last frame)", () => {
    expect(scrubRatioFromTime(150, 100)).toBe(1);
  });
});

describe("clampScrubTime", () => {
  it("clamps a seek target to [0, duration]", () => {
    expect(clampScrubTime(-5, 100)).toBe(0);
    expect(clampScrubTime(150, 100)).toBe(100);
    expect(clampScrubTime(40, 100)).toBe(40);
  });

  it("returns 0 for a zero/invalid duration or non-finite time", () => {
    expect(clampScrubTime(40, 0)).toBe(0);
    expect(clampScrubTime(Number.NaN, 100)).toBe(0);
  });
});

describe("formatVideoClockTime", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatVideoClockTime(0)).toBe("0:00");
    expect(formatVideoClockTime(5)).toBe("0:05");
    expect(formatVideoClockTime(65)).toBe("1:05");
    expect(formatVideoClockTime(599)).toBe("9:59");
  });

  it("grows to h:mm:ss past one hour", () => {
    expect(formatVideoClockTime(3661)).toBe("1:01:01");
  });

  it("falls back to 0:00 for negative or non-finite input", () => {
    expect(formatVideoClockTime(-1)).toBe("0:00");
    expect(formatVideoClockTime(Number.NaN)).toBe("0:00");
    expect(formatVideoClockTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});
