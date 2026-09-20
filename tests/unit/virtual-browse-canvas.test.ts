import { describe, expect, it } from "vitest";

import { createCaptionBandResolver } from "../../src/renderer/asset-caption-band";
import {
  MASONRY_CAPTION_BAND_PX,
  MASONRY_DIMENSIONS_CAPTION_BAND_PX,
} from "../../src/renderer/canvas-asset-layout";
import { estimateMasonryPreviewHeightPx } from "../../src/renderer/masonry-preview-frame";
import {
  buildChunkedJustifiedGeometry,
  buildChunkedMasonryGeometry,
  buildJustifiedGeometry,
  buildMasonryGeometry,
  variableWindow,
  virtualJustifiedRowStyle,
} from "../../src/renderer/browse/virtual-browse-canvas";

function entry(assetId: string, width: number | null, height: number | null) {
  return { assetId, width, height };
}

const CAPTION_FIELDS = {
  name: true,
  size: true,
  date: true,
  dimensions: true,
} as const;

/** Visual asset whose pixel size was never decoded (undecoded raw…). */
function unsizedEntry(assetId: string) {
  return { assetId, width: null, height: null, mediaType: "image" as const };
}

function sizedEntry(assetId: string, width = 100, height = 100) {
  return { assetId, width, height, mediaType: "image" as const };
}

describe("virtual browse canvas geometry", () => {
  it("uses sparse real dimensions to correct masonry offsets", () => {
    const geometry = buildMasonryGeometry({
      total: 4,
      columnCount: 2,
      columnWidth: 200,
      showCaption: false,
      captionBand: 0,
      entryAt: (index) => index === 0
        ? entry("portrait", 100, 200)
        : entry(`asset-${index}`, 200, 100),
    });

    const firstColumn = geometry[0];
    const secondColumn = geometry[1];
    if (!firstColumn || !secondColumn) throw new Error("expected two columns");
    const firstHeight = firstColumn.heights[0] ?? 0;
    expect(firstHeight).toBeGreaterThan(secondColumn.heights[0] ?? 0);
    expect(firstColumn.offsets[1]).toBe(firstHeight + 14);
    expect(firstColumn.totalHeight).toBeGreaterThan(secondColumn.totalHeight);
  });

  it("returns a bounded variable-height window with exact spacers", () => {
    const window = variableWindow({
      heights: [100, 200, 50],
      offsets: [0, 114, 328],
      totalHeight: 378,
      viewStart: 120,
      viewEnd: 200,
    });

    expect(window).toEqual({
      start: 1,
      end: 2,
      spacerBefore: 114,
      spacerAfter: 50,
      totalHeight: 378,
    });
  });

  it("corrects justified row height and widths from loaded aspect ratios", () => {
    const geometry = buildJustifiedGeometry({
      total: 3,
      itemsPerRow: 2,
      availableWidth: 800,
      targetHeight: 200,
      captionBand: 40,
      entryAt: (index) => index === 0
        ? entry("wide", 400, 100)
        : entry(`asset-${index}`, 100, 100),
    });

    expect(geometry).toHaveLength(2);
    const firstRow = geometry[0];
    const lastRow = geometry[1];
    if (!firstRow || !lastRow) throw new Error("expected two rows");
    expect(firstRow.widths.reduce((sum, width) => sum + width, 0)).toBe(786);
    expect(firstRow.previewHeight).toBeLessThan(200);
    expect(firstRow.bodyHeight).toBe(firstRow.previewHeight + 40);
    expect(lastRow.offset).toBe(firstRow.bodyHeight + 14);
  });

  it("keeps 100k masonry geometry sparse while preserving distant overrides", () => {
    const columns = buildChunkedMasonryGeometry({
      total: 100_000,
      columnCount: 4,
      columnWidth: 200,
      showCaption: false,
      captionBand: 0,
      geometryEntries: new Map([
        [0, entry("portrait", 100, 200)],
        [50_000, entry("landscape", 400, 100)],
      ]),
    });

    const firstColumn = columns[0];
    if (!firstColumn) throw new Error("expected first column");
    expect(firstColumn.count).toBe(25_000);
    expect(firstColumn.heights).toHaveLength(0);
    expect(firstColumn.offsets).toHaveLength(0);
    expect(firstColumn.heightAt(0)).toBeGreaterThan(firstColumn.heightAt(1));
    expect(firstColumn.offsetAt(25_000)).toBe(firstColumn.totalHeight);
    expect(firstColumn.offsetAt(12_501)).toBeGreaterThan(firstColumn.offsetAt(12_500));
  });

  it("keeps 100k justified geometry block-addressable", () => {
    const geometry = buildChunkedJustifiedGeometry({
      total: 100_000,
      itemsPerRow: 4,
      availableWidth: 800,
      targetHeight: 200,
      captionBand: 40,
      geometryEntries: new Map([
        [0, entry("wide", 400, 100)],
        [1, entry("square", 100, 100)],
        [50_001, entry("portrait", 100, 200)],
      ]),
    });

    expect(geometry.count).toBe(25_000);
    expect(geometry.rowAt(0).widths).toHaveLength(4);
    expect(geometry.rowAt(12_500).widths).toHaveLength(4);
    expect(geometry.rowAt(24_999).widths).toHaveLength(4);
    expect(geometry.offsetAt(25_000)).toBe(geometry.totalHeight);
    expect(geometry.rowAt(0).previewHeight).not.toBe(geometry.rowAt(1).previewHeight);
    expect(geometry.offsetAt(12_501)).toBeGreaterThan(geometry.offsetAt(12_500));
  });

  it("locks justified row used height to the geometry body (Serpent-614293)", () => {
    const style = virtualJustifiedRowStyle({ bodyHeightPx: 258, isLast: false });
    expect(style.height).toBe(258);
    expect(style.flexShrink).toBe(0);
    expect(style.overflow).toBe("visible");
    expect(style.marginBottom).toBe(14);
    expect(virtualJustifiedRowStyle({ bodyHeightPx: 258, isLast: true }).marginBottom)
      .toBeUndefined();
  });

  it("publishes the row's own caption band on the row style (Serpent-b1b0f2)", () => {
    const style = virtualJustifiedRowStyle({
      bodyHeightPx: 258,
      isLast: false,
      captionBandPx: 41,
    }) as Record<string, unknown>;
    expect(style["--justified-caption-band"]).toBe("41px");
    const withoutBand = virtualJustifiedRowStyle({
      bodyHeightPx: 258,
      isLast: true,
    }) as Record<string, unknown>;
    expect(withoutBand["--justified-caption-band"]).toBeUndefined();
  });

  it("gives each waterfall card its own caption band (Serpent-b1b0f2)", () => {
    const resolver = createCaptionBandResolver({
      mode: "masonry",
      fields: CAPTION_FIELDS,
    });
    const geometry = buildMasonryGeometry({
      total: 2,
      columnCount: 2,
      columnWidth: 200,
      showCaption: true,
      captionBand: resolver,
      entryAt: (index) => (
        index === 0 ? sizedEntry("sized") : unsizedEntry("unsized")
      ),
    });

    const sizedColumn = geometry[0];
    const unsizedColumn = geometry[1];
    if (!sizedColumn || !unsizedColumn) throw new Error("expected two columns");
    // Each card carries its own band: the sized card keeps the resolution line
    // (52px), the undecoded one drops to the two-line band (38px).
    expect(sizedColumn.heights[0]).toBe(
      estimateMasonryPreviewHeightPx(100, 100, 200) + MASONRY_DIMENSIONS_CAPTION_BAND_PX,
    );
    expect(unsizedColumn.heights[0]).toBe(
      estimateMasonryPreviewHeightPx(null, null, 200) + MASONRY_CAPTION_BAND_PX,
    );
  });

  it("sizes a virtual tiled row by its tallest caption (Serpent-b1b0f2)", () => {
    const resolver = createCaptionBandResolver({
      mode: "justified",
      fields: CAPTION_FIELDS,
    });
    const rows = buildJustifiedGeometry({
      total: 4,
      itemsPerRow: 2,
      availableWidth: 800,
      targetHeight: 200,
      captionBand: resolver,
      entryAt: (index) => (index === 2 ? sizedEntry(`sized-${index}`) : unsizedEntry(`plain-${index}`)),
    });

    expect(rows).toHaveLength(2);
    const plainRow = rows[0];
    const mixedRow = rows[1];
    if (!plainRow || !mixedRow) throw new Error("expected two rows");
    // Every card in a row shares the row band, which is the tallest one needed.
    expect(mixedRow.captionBand).toBeGreaterThan(plainRow.captionBand);
    expect(mixedRow.bodyHeight).toBe(mixedRow.previewHeight + mixedRow.captionBand);
    expect(plainRow.bodyHeight).toBe(plainRow.previewHeight + plainRow.captionBand);
  });
});
