import { describe, expect, it } from "vitest";

import {
  clampGifFrameIndex,
  isGifDisplayName,
  nextPlaybackIntent,
  shouldHandleGifSpaceKey,
  stepGifFrameIndex,
} from "../../src/renderer/gif-player-controls";

describe("isGifDisplayName", () => {
  it("detects gif extensions case-insensitively", () => {
    expect(isGifDisplayName("loop.GIF")).toBe(true);
    expect(isGifDisplayName("still.png")).toBe(false);
  });
});

describe("shouldHandleGifSpaceKey", () => {
  it("handles Space when not typing", () => {
    expect(
      shouldHandleGifSpaceKey({
        key: " ",
        code: "Space",
        repeat: false,
        target: { tagName: "DIV" },
      }),
    ).toBe(true);
  });

  it("ignores editable targets and chrome buttons", () => {
    expect(
      shouldHandleGifSpaceKey({
        key: " ",
        repeat: false,
        target: { tagName: "INPUT" },
      }),
    ).toBe(false);
    expect(
      shouldHandleGifSpaceKey({
        key: " ",
        repeat: false,
        target: { tagName: "BUTTON" },
      }),
    ).toBe(false);
  });
});

describe("frame index helpers", () => {
  it("clamps and wraps frame indices", () => {
    expect(clampGifFrameIndex(5, 3)).toBe(2);
    expect(clampGifFrameIndex(-1, 3)).toBe(0);
    expect(stepGifFrameIndex(0, 3, -1)).toBe(2);
    expect(stepGifFrameIndex(2, 3, 1)).toBe(0);
    expect(stepGifFrameIndex(1, 3, 1)).toBe(2);
  });

  it("toggles play intent like video", () => {
    expect(nextPlaybackIntent(true)).toBe("play");
    expect(nextPlaybackIntent(false)).toBe("pause");
  });
});
