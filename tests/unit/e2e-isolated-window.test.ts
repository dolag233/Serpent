import { describe, expect, it } from 'vitest';

import {
  pickIsolatedWindowPlacement,
  type DisplayLike,
} from '../../src/main/e2e-isolated-window';

const primary: DisplayLike = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
};

describe('pickIsolatedWindowPlacement', () => {
  it('returns undefined when only the primary display is present', () => {
    expect(
      pickIsolatedWindowPlacement([primary], primary.id, { width: 1440, height: 900 }),
    ).toBeUndefined();
  });

  it('centers the window inside a secondary display large enough for the preferred size', () => {
    const secondary: DisplayLike = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    };

    const placement = pickIsolatedWindowPlacement(
      [primary, secondary],
      primary.id,
      { width: 1440, height: 900 },
    );

    expect(placement).toEqual({
      displayId: 2,
      x: 1920 + 240,
      y: 90,
      width: 1440,
      height: 900,
    });
  });

  it('clamps the window to fit a secondary display smaller than the preferred size', () => {
    const secondary: DisplayLike = {
      id: 2,
      bounds: { x: -1024, y: 0, width: 1024, height: 768 },
    };

    const placement = pickIsolatedWindowPlacement(
      [primary, secondary],
      primary.id,
      { width: 1440, height: 900 },
    );

    expect(placement).toEqual({
      displayId: 2,
      x: -1024,
      y: 0,
      width: 1024,
      height: 768,
    });
  });

  it('keeps the placement fully within a secondary display positioned with a negative origin', () => {
    const secondary: DisplayLike = {
      id: 3,
      bounds: { x: -1920, y: -200, width: 1600, height: 1000 },
    };

    const placement = pickIsolatedWindowPlacement(
      [primary, secondary],
      primary.id,
      { width: 1440, height: 900 },
    );

    expect(placement).toBeDefined();
    expect(placement!.x).toBeGreaterThanOrEqual(secondary.bounds.x);
    expect(placement!.x + placement!.width).toBeLessThanOrEqual(
      secondary.bounds.x + secondary.bounds.width,
    );
    expect(placement!.y).toBeGreaterThanOrEqual(secondary.bounds.y);
    expect(placement!.y + placement!.height).toBeLessThanOrEqual(
      secondary.bounds.y + secondary.bounds.height,
    );
  });

  it('picks the first non-primary display when several are present', () => {
    const secondaryA: DisplayLike = {
      id: 2,
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    };
    const secondaryB: DisplayLike = {
      id: 3,
      bounds: { x: 3840, y: 0, width: 1920, height: 1080 },
    };

    const placement = pickIsolatedWindowPlacement(
      [primary, secondaryA, secondaryB],
      primary.id,
      { width: 1440, height: 900 },
    );

    expect(placement?.displayId).toBe(2);
  });
});
