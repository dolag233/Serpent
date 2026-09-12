import { describe, expect, it } from "vitest";

import {
  horizontalScrollDeltaFromWheel,
  nextTabStripScrollLeft,
} from "../../src/renderer/workspace-tab-strip-scroll";

const sample = (
  overrides: Partial<Parameters<typeof horizontalScrollDeltaFromWheel>[0]> = {},
) => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  ...overrides,
});

describe("horizontalScrollDeltaFromWheel", () => {
  it("maps a vertical mouse notch onto the tab strip", () => {
    expect(horizontalScrollDeltaFromWheel(sample({ deltaY: 3, deltaMode: 1 }), 200)).toBe(48);
    expect(horizontalScrollDeltaFromWheel(sample({ deltaY: 120 }), 200)).toBe(120);
  });

  it("keeps a trackpad two-finger horizontal swipe on X", () => {
    expect(horizontalScrollDeltaFromWheel(sample({ deltaX: 28, deltaY: 4 }), 200)).toBe(28);
  });

  it("maps a mostly-vertical trackpad pan onto the strip", () => {
    expect(horizontalScrollDeltaFromWheel(sample({ deltaX: 4, deltaY: 22 }), 200)).toBe(22);
  });

  it("ignores pinch / Ctrl+wheel unless Chromium tagged a horizontal slide", () => {
    expect(
      horizontalScrollDeltaFromWheel(sample({ deltaY: 40, ctrlKey: true }), 200),
    ).toBeNull();
    expect(
      horizontalScrollDeltaFromWheel(sample({ deltaX: 40, deltaY: 4, ctrlKey: true }), 200),
    ).toBe(40);
  });
});

describe("nextTabStripScrollLeft", () => {
  it("clamps to the overflow range", () => {
    expect(nextTabStripScrollLeft(0, 800, 200, 50)).toBe(50);
    expect(nextTabStripScrollLeft(0, 800, 200, -20)).toBe(0);
    expect(nextTabStripScrollLeft(580, 800, 200, 50)).toBe(600);
    expect(nextTabStripScrollLeft(0, 180, 200, 50)).toBe(0);
  });
});
