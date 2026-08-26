import {
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

/** Floor for extra pixels above/below the canvas viewport that stay mounted. */
export const VIEWPORT_OVERSCAN_PX = 1200;

/**
 * Runway for windowed browse columns. A fast trackpad flick can move several
 * screens before the compositor's scroll event reaches React. Keep five
 * viewport heights (and twelve card heights for large stops) mounted so the
 * previous slice still covers the new viewport during that hand-off
 * (Serpent-1s3d).
 */
export function viewportOverscanPx(
  viewportHeightPx: number,
  cardSizePx: number = 0,
): number {
  const view =
    Number.isFinite(viewportHeightPx) && viewportHeightPx > 0
      ? viewportHeightPx
      : 800;
  const card =
    Number.isFinite(cardSizePx) && cardSizePx > 0 ? cardSizePx : 0;
  return Math.max(
    VIEWPORT_OVERSCAN_PX,
    Math.round(view * 5),
    Math.round(card * 12),
  );
}

export function useCanvasLocalViewport(
  containerRef: RefObject<HTMLElement | null>,
  cardSizePx: number = 0,
): {
  /** Overscan window kept mounted for scroll continuity. */
  start: number;
  end: number;
  /** Actual canvas viewport used for network/decode priority decisions. */
  visibleStart: number;
  visibleEnd: number;
} {
  const [viewport, setViewport] = useState({
    start: 0,
    end: 8000,
    visibleStart: 0,
    visibleEnd: 800,
  });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const canvas = element.closest<HTMLElement>(".workspace-canvas");
    if (!canvas) return;

    const update = () => {
      // Scroll events can arrive after the compositor has moved the canvas but
      // before the next paint. Deferring this read to requestAnimationFrame
      // leaves the previous slice mounted for one more frame; when the user
      // reverses direction that slice can start below the new viewport and
      // expose a white band (CANVAS-037). Read and publish in the scroll
      // handler so React can commit the matching slice before that paint.
      const next = readCanvasLocalViewport(element, canvas, undefined, cardSizePx);
      const visible = readCanvasLocalViewport(element, canvas, 0, cardSizePx);
      setViewport((previous) =>
        previous.start === next.start
          && previous.end === next.end
          && previous.visibleStart === visible.start
          && previous.visibleEnd === visible.end
          ? previous
          : {
              ...next,
              visibleStart: visible.start,
              visibleEnd: visible.end,
            },
      );
    };

    update();
    canvas.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    observer.observe(element);
    return () => {
      canvas.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [containerRef, cardSizePx]);

  return viewport;
}
/** Whole CSS pixels. Fractional getBoundingClientRect edges retrigger
 *  windowing every frame on Windows DPI (Serpent-oq86). */
export function quantizeCanvasViewportOffsetPx(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function readCanvasLocalViewport(
  container: HTMLElement,
  canvas: HTMLElement,
  overscanPx?: number,
  cardSizePx: number = 0,
): { start: number; end: number } {
  const overscan = overscanPx ?? viewportOverscanPx(canvas.clientHeight, cardSizePx);
  const containerRect = container.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const start =
    quantizeCanvasViewportOffsetPx(canvasRect.top - containerRect.top) - overscan;
  const end = start + canvas.clientHeight + overscan * 2;
  return { start, end };
}

/**
 * Contiguous window over a column/row of estimated heights.
 * `start` is inclusive, `end` is exclusive.
 */
export function columnWindow(
  itemHeights: readonly number[],
  viewStart: number,
  viewEnd: number,
): {
  start: number;
  end: number;
  spacerBefore: number;
  spacerAfter: number;
  totalHeight: number;
} {
  const heights = itemHeights.map((height) =>
    Number.isFinite(height) && height > 0 ? height : 1,
  );
  const totalHeight = heights.reduce((sum, height) => sum + height, 0);
  if (heights.length === 0) {
    return { start: 0, end: 0, spacerBefore: 0, spacerAfter: 0, totalHeight: 0 };
  }

  const top = Number.isFinite(viewStart) ? viewStart : 0;
  const bottom = Number.isFinite(viewEnd) ? Math.max(top, viewEnd) : totalHeight;

  let cursor = 0;
  let start = 0;
  while (start < heights.length && cursor + heights[start]! <= top) {
    cursor += heights[start]!;
    start += 1;
  }
  const spacerBefore = cursor;

  let end = start;
  while (end < heights.length && cursor < bottom) {
    cursor += heights[end]!;
    end += 1;
  }
  if (start === end && start < heights.length) {
    cursor += heights[start]!;
    end = start + 1;
  }

  return {
    start,
    end,
    spacerBefore,
    spacerAfter: Math.max(0, totalHeight - cursor),
    totalHeight,
  };
}
