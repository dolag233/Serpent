import { describe, expect, it } from "vitest";

import {
  JUSTIFIED_CAPTION_DIMENSIONS_LINE_PX,
  JUSTIFIED_CAPTION_GAP_PX,
  JUSTIFIED_CAPTION_NAME_LINE_PX,
  JUSTIFIED_CAPTION_PAD_BOTTOM_PX,
  JUSTIFIED_CAPTION_PAD_TOP_PX,
  JUSTIFIED_CAPTION_SECONDARY_LINE_PX,
  resolveJustifiedCaptionBandPx,
} from "../../src/renderer/justified-caption-band";

describe("resolveJustifiedCaptionBandPx (Serpent-omn)", () => {
  it("returns 0 when no caption lines are shown", () => {
    expect(
      resolveJustifiedCaptionBandPx({
        dimensions: false,
        name: false,
        secondary: false,
      }),
    ).toBe(0);
  });

  it("keeps a dimensions-only band compact", () => {
    const band = resolveJustifiedCaptionBandPx({
      dimensions: true,
      name: false,
      secondary: false,
    });
    expect(band).toBe(
      JUSTIFIED_CAPTION_PAD_TOP_PX +
        JUSTIFIED_CAPTION_DIMENSIONS_LINE_PX +
        JUSTIFIED_CAPTION_PAD_BOTTOM_PX,
    );
    expect(band).toBe(30);
  });

  it("matches the compact ~54px default (dimensions + name + meta)", () => {
    const band = resolveJustifiedCaptionBandPx({
      dimensions: true,
      name: true,
      secondary: true,
    });
    expect(band).toBe(
      JUSTIFIED_CAPTION_PAD_TOP_PX +
        JUSTIFIED_CAPTION_DIMENSIONS_LINE_PX +
        JUSTIFIED_CAPTION_GAP_PX +
        JUSTIFIED_CAPTION_NAME_LINE_PX +
        JUSTIFIED_CAPTION_GAP_PX +
        JUSTIFIED_CAPTION_SECONDARY_LINE_PX +
        JUSTIFIED_CAPTION_PAD_BOTTOM_PX,
    );
    // The compact caption keeps the measured three-line content while trimming
    // the bottom breathing room.
    expect(band).toBeGreaterThanOrEqual(62);
    expect(band).toBe(62);
  });

  it("grows when more lines are enabled", () => {
    const dimsOnly = resolveJustifiedCaptionBandPx({
      dimensions: true,
      name: false,
      secondary: false,
    });
    const withName = resolveJustifiedCaptionBandPx({
      dimensions: true,
      name: true,
      secondary: false,
    });
    const full = resolveJustifiedCaptionBandPx({
      dimensions: true,
      name: true,
      secondary: true,
    });
    expect(withName).toBeGreaterThan(dimsOnly);
    expect(full).toBeGreaterThan(withName);
  });

  it("scales the reserved band for the larger typography tier", () => {
    const lines = { dimensions: true, name: true, secondary: true };
    const base = resolveJustifiedCaptionBandPx(lines);
    const large = resolveJustifiedCaptionBandPx(lines, 1.12);

    expect(large).toBeGreaterThan(base);
    expect(large).toBe(71);
  });
});
