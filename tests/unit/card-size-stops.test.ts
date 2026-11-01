import { describe, expect, it } from "vitest";

import {
  ASSET_GRID_GAP_PX,
  countFittingColumns,
  leftoverWidthPx,
} from "../../src/renderer/asset-grid-layout";
import {
  BROWSE_CARD_PINCH_GAIN,
  cardSizeFillingColumns,
  enumerateDiscreteCardSizes,
  indexOfDiscreteCardSize,
  isBrowseCardMouseWheelNotch,
  nearestDiscreteCardSize,
  nextDiscreteCardSizeFromPinchDelta,
  nextDiscreteCardSizeFromWheelDelta,
  stepDiscreteCardSize,
} from "../../src/renderer/card-size-stops";
import { CARD_SIZE_MAX, CARD_SIZE_MIN } from "../../src/renderer/canvas-preferences";

describe("enumerateDiscreteCardSizes (Serpent-7ny)", () => {
  it("returns ascending unique stops that pack flush for each column count", () => {
    const width = 1200;
    const stops = enumerateDiscreteCardSizes(width);
    expect(stops.length).toBeGreaterThan(2);
    expect(stops[0]).toBe(CARD_SIZE_MIN);
    const largest = stops[stops.length - 1]!;
    expect(largest).toBeLessThanOrEqual(CARD_SIZE_MAX);
    expect(leftoverWidthPx(width, largest)).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < stops.length; i += 1) {
      expect(stops[i]!).toBeGreaterThan(stops[i - 1]!);
    }
    for (const size of stops) {
      // Flush-packed stops leave less than one column slot of leftover.
      expect(leftoverWidthPx(width, size)).toBeLessThan(size + ASSET_GRID_GAP_PX);
      expect(leftoverWidthPx(width, size)).toBeGreaterThanOrEqual(0);
    }
  });

  it("falls back to endpoints when width is unknown", () => {
    expect(enumerateDiscreteCardSizes(0)).toEqual([CARD_SIZE_MIN, CARD_SIZE_MAX]);
  });

  it("largest stop on a 3840-wide canvas still fits two columns", () => {
    const width = 3840;
    const stops = enumerateDiscreteCardSizes(width);
    const largest = stops[stops.length - 1]!;
    expect(largest).toBe(CARD_SIZE_MAX);
    expect(countFittingColumns(width, largest)).toBe(2);
  });

  it("cardSizeFillingColumns matches the inverse of leftover packing", () => {
    const width = 900;
    const size = cardSizeFillingColumns(width, 4);
    expect(size * 4 + ASSET_GRID_GAP_PX * 3).toBeLessThanOrEqual(width);
    expect(leftoverWidthPx(width, size)).toBeLessThan(size);
  });
});

describe("step / nearest discrete card size", () => {
  const stops = [96, 140, 200, 320];

  it("nearest picks the closest stop", () => {
    expect(nearestDiscreteCardSize(150, stops)).toBe(140);
    expect(nearestDiscreteCardSize(180, stops)).toBe(200);
  });

  it("step enlarges or shrinks by one stop", () => {
    expect(stepDiscreteCardSize(140, 1, stops)).toBe(200);
    expect(stepDiscreteCardSize(140, -1, stops)).toBe(96);
    expect(stepDiscreteCardSize(96, -1, stops)).toBe(96);
    expect(stepDiscreteCardSize(320, 1, stops)).toBe(320);
  });

  it("indexOfDiscreteCardSize maps a stored size onto the slider index", () => {
    expect(indexOfDiscreteCardSize(200, stops)).toBe(2);
    expect(indexOfDiscreteCardSize(155, stops)).toBe(1);
  });
});

describe("nextDiscreteCardSizeFromPinchDelta", () => {
  const stops = enumerateDiscreteCardSizes(1200);

  it("uses a higher gain than the legacy 0.002 continuous path", () => {
    expect(BROWSE_CARD_PINCH_GAIN).toBeGreaterThan(0.002);
  });

  it("advances a stop for a modest pinch delta that would stall at old gain", () => {
    const current = stops[Math.floor(stops.length / 2)]!;
    const next = nextDiscreteCardSizeFromPinchDelta(current, 30, stops);
    expect(next).not.toBe(current);
    expect(stops).toContain(next);
  });

  it("pinch-out (positive deltaY) shrinks cards", () => {
    const current = stops[Math.floor(stops.length / 2)]!;
    const next = nextDiscreteCardSizeFromPinchDelta(current, 40, stops);
    expect(next).toBeLessThan(current);
  });
});

describe("Ctrl+wheel mouse notch vs trackpad pinch (Serpent-fvpi)", () => {
  const stops = enumerateDiscreteCardSizes(1200);

  it("classifies Windows-style mouse deltas as notches", () => {
    expect(
      isBrowseCardMouseWheelNotch({ deltaX: 0, deltaY: -120, deltaMode: 0 }),
    ).toBe(true);
    expect(
      isBrowseCardMouseWheelNotch({ deltaX: 0, deltaY: -1, deltaMode: 1 }),
    ).toBe(true);
  });

  it("classifies fractional pinch samples as non-notch", () => {
    expect(
      isBrowseCardMouseWheelNotch({ deltaX: 0, deltaY: -12.5, deltaMode: 0 }),
    ).toBe(false);
    expect(
      isBrowseCardMouseWheelNotch({ deltaX: 0, deltaY: -8, deltaMode: 0 }),
    ).toBe(false);
  });

  it("large mouse notch advances exactly one stop (not to max)", () => {
    const current = stops[Math.floor(stops.length / 2)]!;
    const currentIndex = indexOfDiscreteCardSize(current, stops);
    const next = nextDiscreteCardSizeFromWheelDelta(
      current,
      -300,
      stops,
    );
    expect(next).toBe(stops[currentIndex + 1]);
    expect(next).toBeLessThan(CARD_SIZE_MAX);
  });

  it.each([-300, -120, -30, -12.5, -8, -0.1, 0.1, 8, 12.5, 30, 120, 300])(
    "wheel delta %s moves exactly one slider stop at every size",
    (delta) => {
      for (const [index, current] of stops.entries()) {
        const nextIndex = Math.max(0, Math.min(stops.length - 1, index + (delta > 0 ? -1 : 1)));
        expect(nextDiscreteCardSizeFromWheelDelta(current, delta, stops)).toBe(stops[nextIndex]);
      }
    },
  );

  it("zero wheel delta keeps the current stop", () => {
    const current = stops[Math.floor(stops.length / 2)]!;
    expect(nextDiscreteCardSizeFromWheelDelta(current, 0, stops)).toBe(current);
  });
});
