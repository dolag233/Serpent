import { describe, expect, it } from "vitest";

import { ASSET_GRID_GAP_PX } from "../../src/renderer/asset-grid-layout";
import { masonryCardSlotStyle } from "../../src/renderer/masonry-columns";

function cssVar(
  style: ReturnType<typeof masonryCardSlotStyle>,
  name: string,
): unknown {
  return (style as Record<string, unknown>)[name];
}

describe("masonryCardSlotStyle (Serpent-1s3d)", () => {
  it("locks the slot to the same body height the column window uses", () => {
    const style = masonryCardSlotStyle({
      previewHeightPx: 210,
      bodyHeightPx: 252,
      isLast: false,
    });
    expect(style.height).toBe(252);
    expect(style.flexShrink).toBe(0);
    expect(style.marginBottom).toBe(ASSET_GRID_GAP_PX);
    expect(cssVar(style, "--masonry-preview-height")).toBe("210px");
  });

  it("omits the trailing gap on the last card in the column", () => {
    const style = masonryCardSlotStyle({
      previewHeightPx: 100,
      bodyHeightPx: 142,
      isLast: true,
    });
    expect(style.marginBottom).toBeUndefined();
    expect(style.height).toBe(142);
  });

  it("never collapses a slot to zero", () => {
    const style = masonryCardSlotStyle({
      previewHeightPx: 0,
      bodyHeightPx: 0,
      isLast: true,
    });
    expect(style.height).toBe(1);
    expect(cssVar(style, "--masonry-preview-height")).toBe("1px");
  });
});
