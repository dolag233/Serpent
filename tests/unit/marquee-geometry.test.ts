import { describe, expect, it } from "vitest";
import {
  canvasViewportFromMetrics,
  clientPointToContent,
  clipRectToViewport,
  contentRectFromPoints,
  contentRectToViewport,
  rectsIntersect,
  viewportRectToContent,
} from "../../src/renderer/marquee-geometry";

const viewport = {
  left: 100,
  top: 80,
  right: 900,
  bottom: 680,
};

describe("marquee geometry", () => {
  it("keeps a pointer anchored to content while the canvas scrolls", () => {
    const start = clientPointToContent(
      { x: 120, y: 380 },
      viewport,
      { left: 0, top: 300 },
    );
    const afterScroll = clientPointToContent(
      { x: 850, y: 675 },
      viewport,
      { left: 0, top: 1_000 },
    );

    expect(start).toEqual({ x: 20, y: 600 });
    expect(afterScroll).toEqual({ x: 750, y: 1_595 });
  });

  it("projects and clips a content rectangle against the current viewport", () => {
    const contentRect = contentRectFromPoints(
      { x: 20, y: 600 },
      { x: 750, y: 1_595 },
    );
    const viewportRect = contentRectToViewport(
      contentRect,
      viewport,
      { left: 0, top: 1_000 },
    );

    expect(viewportRect).toEqual({
      left: 120,
      top: -320,
      right: 850,
      bottom: 675,
    });
    expect(clipRectToViewport(viewportRect, viewport)).toEqual({
      left: 120,
      top: 80,
      right: 850,
      bottom: 675,
    });
  });

  it("converts card DOMRects into the same content space as the marquee", () => {
    const cardContentRect = viewportRectToContent(
      { left: 110, top: 100, right: 260, bottom: 240 },
      viewport,
      { left: 0, top: 1_000 },
    );

    expect(cardContentRect).toEqual({
      left: 10,
      top: 1_020,
      right: 160,
      bottom: 1_160,
    });
    expect(
      rectsIntersect(cardContentRect, {
        left: 20,
        top: 600,
        right: 750,
        bottom: 1_595,
      }),
    ).toBe(true);
  });

  it("uses the client box so a native scrollbar is not part of the canvas viewport", () => {
    expect(
      canvasViewportFromMetrics(
        { left: 10, top: 20 },
        {
          clientLeft: 1,
          clientTop: 2,
          clientWidth: 799,
          clientHeight: 598,
        },
      ),
    ).toEqual({
      left: 11,
      top: 22,
      right: 810,
      bottom: 620,
    });
  });
});
