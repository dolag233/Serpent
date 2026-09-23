import { describe, expect, it } from "vitest";

import {
  createCaptionBandResolver,
  resolveAssetCaptionBandPx,
  resolveCardCaptionLines,
  resolveMasonryCaptionBandPx,
  type CardCaptionFields,
} from "../../src/renderer/asset-caption-band";
import {
  MASONRY_CAPTION_BAND_PX,
  MASONRY_DIMENSIONS_CAPTION_BAND_PX,
} from "../../src/renderer/canvas-asset-layout";
import { resolveJustifiedCaptionBandPx } from "../../src/renderer/justified-caption-band";

const ALL_FIELDS: CardCaptionFields = {
  name: true,
  size: true,
  date: true,
  dimensions: true,
};

const VISUAL_WITH_SIZE = { mediaType: "image", width: 1920, height: 1080 } as const;
const VISUAL_WITHOUT_SIZE = { mediaType: "image", width: null, height: null } as const;

describe("resolveCardCaptionLines (Serpent-b1b0f2)", () => {
  it("keeps the resolution line only when the asset really renders one", () => {
    expect(resolveCardCaptionLines(ALL_FIELDS, VISUAL_WITH_SIZE).dimensions).toBe(true);
    expect(resolveCardCaptionLines(ALL_FIELDS, VISUAL_WITHOUT_SIZE).dimensions).toBe(false);
  });

  it("never reserves resolution for non-visual media that carries pixel size", () => {
    expect(
      resolveCardCaptionLines(ALL_FIELDS, {
        mediaType: "document",
        width: 1240,
        height: 1754,
      }).dimensions,
    ).toBe(false);
  });

  it("follows the resolution toggle", () => {
    expect(
      resolveCardCaptionLines(
        { ...ALL_FIELDS, dimensions: false },
        VISUAL_WITH_SIZE,
      ).dimensions,
    ).toBe(false);
  });

  it("keeps reserving the resolution line for unresolved geometry placeholders", () => {
    // No media type at all means the index position has no summary yet:
    // shrinking now and growing later would move 100k-position scrollbar
    // geometry page by page (CANVAS-038).
    expect(resolveCardCaptionLines(ALL_FIELDS, {}).dimensions).toBe(true);
    expect(
      resolveCardCaptionLines(ALL_FIELDS, { width: null, height: null }).dimensions,
    ).toBe(true);
  });

  it("counts a search snippet as the secondary line", () => {
    const noMeta: CardCaptionFields = {
      name: true,
      size: false,
      date: false,
      dimensions: true,
    };
    expect(resolveCardCaptionLines(noMeta, VISUAL_WITH_SIZE).secondary).toBe(false);
    expect(
      resolveCardCaptionLines(noMeta, VISUAL_WITH_SIZE, { snippetLine: true }).secondary,
    ).toBe(true);
  });
});

describe("masonry caption band (Serpent-b1b0f2)", () => {
  it("reproduces the audited two- and three-line constants", () => {
    expect(
      resolveMasonryCaptionBandPx({ dimensions: false, name: true, secondary: true }),
    ).toBe(MASONRY_CAPTION_BAND_PX);
    expect(
      resolveMasonryCaptionBandPx({ dimensions: true, name: true, secondary: true }),
    ).toBe(MASONRY_DIMENSIONS_CAPTION_BAND_PX);
    expect(MASONRY_CAPTION_BAND_PX).toBe(45);
    expect(MASONRY_DIMENSIONS_CAPTION_BAND_PX).toBe(62);
  });

  it("returns no band when every caption line is off", () => {
    expect(resolveMasonryCaptionBandPx({ dimensions: false, name: false, secondary: false }))
      .toBe(0);
  });

  it("scales with the typography tier", () => {
    const base = resolveMasonryCaptionBandPx({
      dimensions: true,
      name: true,
      secondary: true,
    });
    expect(
      resolveMasonryCaptionBandPx({ dimensions: true, name: true, secondary: true }, 1.12),
    ).toBeGreaterThan(base);
  });
});

describe("createCaptionBandResolver (Serpent-b1b0f2)", () => {
  it("gives a waterfall card without resolution a shorter band", () => {
    const resolver = createCaptionBandResolver({ mode: "masonry", fields: ALL_FIELDS });
    const withSize = resolver(VISUAL_WITH_SIZE);
    const withoutSize = resolver(VISUAL_WITHOUT_SIZE);
    expect(withSize).toBe(MASONRY_DIMENSIONS_CAPTION_BAND_PX);
    expect(withoutSize).toBe(MASONRY_CAPTION_BAND_PX);
    expect(withoutSize).toBeLessThan(withSize);
  });

  it("gives a tiled card without resolution a shorter band", () => {
    const resolver = createCaptionBandResolver({ mode: "justified", fields: ALL_FIELDS });
    expect(resolver(VISUAL_WITHOUT_SIZE)).toBeLessThan(resolver(VISUAL_WITH_SIZE));
  });

  it("resolves to zero when captions are switched off entirely", () => {
    const resolver = createCaptionBandResolver({
      mode: "masonry",
      fields: { name: false, size: false, date: false, dimensions: false },
    });
    expect(resolver(VISUAL_WITH_SIZE)).toBe(0);
  });

  it("keeps both views on the same compact caption metrics", () => {
    const justified = resolveAssetCaptionBandPx({
      mode: "justified",
      fields: ALL_FIELDS,
      asset: VISUAL_WITH_SIZE,
    });
    const masonry = resolveAssetCaptionBandPx({
      mode: "masonry",
      fields: ALL_FIELDS,
      asset: VISUAL_WITH_SIZE,
    });
    expect(justified).toBe(
      resolveJustifiedCaptionBandPx({ dimensions: true, name: true, secondary: true }),
    );
    expect(masonry).toBe(justified);
  });
});
