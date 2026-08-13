import { describe, expect, it } from "vitest";
import {
  estimateMasonryPreviewHeightPx,
  resolveMasonryPreviewStyle,
} from "../../src/renderer/masonry-preview-frame";

describe("estimateMasonryPreviewHeightPx", () => {
  it("preserves landscape natural height", () => {
    expect(estimateMasonryPreviewHeightPx(1920, 1080, 200)).toBeCloseTo(
      200 * (1080 / 1920),
      5,
    );
  });

  it("keeps the natural height for a portrait column (Serpent-5p45)", () => {
    // A fixed max-height with the same full column width creates horizontal
    // letterboxing in the contain-fit preview.
    expect(estimateMasonryPreviewHeightPx(230, 512, 200)).toBeCloseTo(
      200 * (512 / 230),
      5,
    );
  });

  it("falls back when dimensions are missing", () => {
    expect(estimateMasonryPreviewHeightPx(null, null, 160)).toBeCloseTo(
      160 * 0.72,
      5,
    );
  });

  it("never collapses to zero when the column width is unknown", () => {
    expect(estimateMasonryPreviewHeightPx(1920, 1080, 0)).toBe(1);
    expect(estimateMasonryPreviewHeightPx(null, null, 0)).toBe(1);
  });
});

describe("resolveMasonryPreviewStyle", () => {
  it("returns only the natural aspect ratio for known dimensions", () => {
    expect(resolveMasonryPreviewStyle(230, 512)).toEqual({
      aspectRatio: "230 / 512",
      maxHeight: "none",
    });
  });

  it("returns undefined without usable dimensions", () => {
    expect(resolveMasonryPreviewStyle(null, 512)).toBeUndefined();
    expect(resolveMasonryPreviewStyle(0, 100)).toBeUndefined();
  });
});
