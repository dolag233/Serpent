import { describe, expect, it } from "vitest";

import { ASSET_GRID_GAP_PX } from "../../src/renderer/asset-grid-layout";
import { cardSizeFillingColumns } from "../../src/renderer/card-size-stops";
import { masonryAlignedFolderWidthPx } from "../../src/renderer/folder-card-width";

describe("masonryAlignedFolderWidthPx (Serpent-l67w)", () => {
  it("matches the flush masonry column width for the preferred card size", () => {
    const available = 900;
    const preferred = 160;
    const aligned = masonryAlignedFolderWidthPx(available, preferred);
    const columns = Math.floor(
      (available + ASSET_GRID_GAP_PX) / (preferred + ASSET_GRID_GAP_PX),
    );
    expect(aligned).toBe(cardSizeFillingColumns(available, columns));
    expect(aligned).toBeGreaterThanOrEqual(preferred);
  });

  it("falls back to the preferred size when width is unknown", () => {
    expect(masonryAlignedFolderWidthPx(0, 160)).toBe(160);
  });
});
