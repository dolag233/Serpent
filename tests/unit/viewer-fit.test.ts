import { describe, expect, it } from 'vitest';

import {
  clampViewerPan,
  clampViewerScale,
  fitContainScale,
  isAtFitScale,
} from '../../src/renderer/viewer-fit';

describe('fitContainScale (REQ-VIEW-006)', () => {
  it('fits a landscape image by width when that is the constraining edge', () => {
    // 2000x1000 into 1000x800 → limited by width → 0.5
    expect(fitContainScale(2000, 1000, 1000, 800)).toBeCloseTo(0.5);
  });

  it('fits a portrait image by height when that is the constraining edge', () => {
    // 1000x2000 into 1000x800 → limited by height → 0.4
    expect(fitContainScale(1000, 2000, 1000, 800)).toBeCloseTo(0.4);
  });

  it('returns 0 for invalid sizes so callers do not treat it as 100% actual', () => {
    expect(fitContainScale(0, 100, 100, 100)).toBe(0);
    expect(fitContainScale(100, 100, 0, 100)).toBe(0);
  });
});

describe('clampViewerScale', () => {
  it('clamps to the viewer range', () => {
    expect(clampViewerScale(0.01)).toBe(0.05);
    expect(clampViewerScale(12)).toBe(8);
    expect(clampViewerScale(1.5)).toBe(1.5);
  });
});

describe('clampViewerPan', () => {
  it('locks pan when the image fits inside the viewport', () => {
    expect(clampViewerPan(40, -20, 800, 600, 0.5, 1000, 800)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('clamps to the overflow edges when zoomed in', () => {
    // 2000x1000 @ scale 1 in 1000x800 → maxX=500, maxY=100
    expect(clampViewerPan(800, 0, 2000, 1000, 1, 1000, 800)).toEqual({
      x: 500,
      y: 0,
    });
    expect(clampViewerPan(0, -400, 2000, 1000, 1, 1000, 800)).toEqual({
      x: 0,
      y: -100,
    });
  });
});

describe('isAtFitScale', () => {
  it('tolerates small float error around fit', () => {
    expect(isAtFitScale(0.5, 0.5)).toBe(true);
    expect(isAtFitScale(0.505, 0.5)).toBe(true);
    expect(isAtFitScale(1, 0.5)).toBe(false);
  });
});
