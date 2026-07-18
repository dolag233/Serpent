import { describe, expect, it } from "vitest";

import {
  buildGifExtractedMetadata,
  computeGifDurationMs,
  GIF_DEFAULT_FRAME_DELAY_MS,
  normalizeGifFrameDelayMs,
} from "../../src/worker/gif-metadata";

describe("normalizeGifFrameDelayMs", () => {
  it("maps non-positive delays to the browser default", () => {
    expect(normalizeGifFrameDelayMs(0)).toBe(GIF_DEFAULT_FRAME_DELAY_MS);
    expect(normalizeGifFrameDelayMs(-1)).toBe(GIF_DEFAULT_FRAME_DELAY_MS);
    expect(normalizeGifFrameDelayMs(Number.NaN)).toBe(GIF_DEFAULT_FRAME_DELAY_MS);
  });

  it("keeps positive delays", () => {
    expect(normalizeGifFrameDelayMs(40)).toBe(40);
    expect(normalizeGifFrameDelayMs(100.6)).toBe(101);
  });
});

describe("computeGifDurationMs", () => {
  it("sums per-frame delays", () => {
    expect(computeGifDurationMs([100, 200, 50], 3)).toBe(350);
  });

  it("fills missing delays with the last value or default", () => {
    expect(computeGifDurationMs([40], 3)).toBe(120);
    expect(computeGifDurationMs(undefined, 2)).toBe(
      2 * GIF_DEFAULT_FRAME_DELAY_MS,
    );
  });
});

describe("buildGifExtractedMetadata", () => {
  it("builds duration and frame count for Inspector / card projection", () => {
    expect(
      buildGifExtractedMetadata({
        width: 320,
        height: 240,
        pages: 4,
        delay: [50, 50, 50, 50],
      }),
    ).toEqual({
      container: "gif",
      durationMs: 200,
      frameCount: 4,
      width: 320,
      height: 240,
    });
  });

  it("zeros duration for single-frame still GIFs", () => {
    expect(
      buildGifExtractedMetadata({
        width: 10,
        height: 10,
        pages: 1,
        delay: [100],
      }).durationMs,
    ).toBe(0);
  });
});
