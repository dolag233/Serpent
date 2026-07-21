import { describe, expect, it } from "vitest";
import {
  MASONRY_PREVIEW_MAX_HEIGHT_PX,
  estimateMasonryPreviewHeightPx,
  resolveMasonryPreviewStyle,
} from "../../src/renderer/masonry-preview-frame";

describe("estimateMasonryPreviewHeightPx", () => {
  it("preserves landscape height under the cap", () => {
    expect(estimateMasonryPreviewHeightPx(1920, 1080, 200)).toBeCloseTo(
      200 * (1080 / 1920),
      5,
    );
  });

  it("caps extreme portrait height (Serpent-woa)", () => {
    // 230×512 in a 200px column → ~445px uncapped; must hit the max.
    const uncapped = 200 * (512 / 230);
    expect(uncapped).toBeGreaterThan(MASONRY_PREVIEW_MAX_HEIGHT_PX);
    expect(estimateMasonryPreviewHeightPx(230, 512, 200)).toBe(
      MASONRY_PREVIEW_MAX_HEIGHT_PX,
    );
  });

  it("falls back when dimensions are missing", () => {
    expect(estimateMasonryPreviewHeightPx(null, null, 160)).toBeCloseTo(
      160 * 0.72,
      5,
    );
  });
});

describe("resolveMasonryPreviewStyle", () => {
  it("returns aspect-ratio + maxHeight for known dimensions", () => {
    expect(resolveMasonryPreviewStyle(230, 512)).toEqual({
      aspectRatio: "230 / 512",
      maxHeight: MASONRY_PREVIEW_MAX_HEIGHT_PX,
    });
  });

  it("returns undefined without usable dimensions", () => {
    expect(resolveMasonryPreviewStyle(null, 512)).toBeUndefined();
    expect(resolveMasonryPreviewStyle(0, 100)).toBeUndefined();
  });
});
