import { describe, expect, it } from "vitest";

import {
  SCROLLBAR_TRACK_PROXIMITY_PX,
  isPointerNearScrollbarTrack,
} from "../../src/renderer/scrollbar-visibility";

describe("isPointerNearScrollbarTrack", () => {
  const el = {
    scrollHeight: 2_000,
    clientHeight: 400,
    scrollWidth: 800,
    clientWidth: 800,
    getBoundingClientRect: () => ({
      top: 100,
      left: 50,
      right: 850,
      bottom: 500,
      width: 800,
      height: 400,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLElement;

  it("is false in the content area away from the track", () => {
    expect(isPointerNearScrollbarTrack(el, 400, 300)).toBe(false);
  });

  it("is true near the right edge when vertically scrollable", () => {
    expect(
      isPointerNearScrollbarTrack(
        el,
        850 - SCROLLBAR_TRACK_PROXIMITY_PX + 2,
        300,
      ),
    ).toBe(true);
  });

  it("is false outside the element bounds", () => {
    expect(isPointerNearScrollbarTrack(el, 900, 300)).toBe(false);
  });
});
