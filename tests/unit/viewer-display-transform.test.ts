import { describe, expect, it } from "vitest";

import {
  normalizeQuarterTurns,
  viewerDisplaySize,
  viewerDisplayTransformCss,
} from "../../src/renderer/viewer-display-transform";

describe("viewer display transforms", () => {
  it("wraps repeated clockwise rotations without losing mirror state", () => {
    expect(normalizeQuarterTurns(4)).toBe(0);
    expect(normalizeQuarterTurns(5)).toBe(1);
    expect(normalizeQuarterTurns(-1)).toBe(3);
    expect(viewerDisplayTransformCss({
      quarterTurns: 4,
      flipHorizontal: false,
      flipVertical: false,
    })).toBe("scale(1, 1) rotate(0deg)");
    expect(viewerDisplayTransformCss({
      quarterTurns: 5,
      flipHorizontal: true,
      flipVertical: false,
    })).toBe("scale(-1, 1) rotate(90deg)");
  });

  it("swaps fitted dimensions for quarter turns", () => {
    expect(viewerDisplaySize(1920, 1080, 1)).toEqual({
      width: 1080,
      height: 1920,
    });
    expect(viewerDisplaySize(1920, 1080, 2)).toEqual({
      width: 1920,
      height: 1080,
    });
  });
});
