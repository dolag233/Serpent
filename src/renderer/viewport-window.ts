import {
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

/** Floor for extra pixels above/below the canvas viewport that stay mounted. */
export const VIEWPORT_OVERSCAN_PX = 1200;

const canvasLocalViewportSnapshots = new WeakMap<HTMLElement, CanvasLocalViewportSnapshot>();

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

    let snapshot: CanvasLocalViewportSnapshot | null = null;
    const publish = () => {
      if (!snapshot) return;
      const scrollTop = canvas.scrollTop;
      snapshot.scrollTop = scrollTop;
      const next = canvasLocalViewportFromSnapshot(
        snapshot,
        scrollTop,
        viewportOverscanPx(snapshot.height, cardSizePx),
      );
      const visible = canvasLocalViewportFromSnapshot(snapshot, scrollTop, 0);
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
    const measure = () => {
      // A collapsed canvas (viewer overlay teardown) reports a top window.
      // Keep the last measurable slice mounted so close-restore still has
      // cards and minHeight instead of remounting the first row.
      snapshot = measureCanvasLocalViewport(element, canvas);
      if (!snapshot) return;
      canvasLocalViewportSnapshots.set(element, snapshot);
      publish();
    };
    const onScroll = () => {
      // Scroll events can arrive after the compositor has moved the canvas but
      // before the next paint. Deferring this read to requestAnimationFrame
      // leaves the previous slice mounted for one more frame; when the user
      // reverses direction that slice can start below the new viewport and
      // expose a white band (CANVAS-037). Publish synchronously from scrollTop
      // and the last measured origin, avoiding layout reads on every wheel tick.
      publish();
    };

    measure();
    canvas.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver((entries) => {
      // The virtual grid changes height as page summaries arrive. Its top
      // stays fixed while it is taller than the viewport, so remeasuring on
      // each such change repeats layout work during a jump. A short grid can
      // be centered by the canvas, however; its own resize moves its origin.
      if (entries.some((entry) =>
        entry.target !== element || entry.contentRect.height <= canvas.clientHeight)) {
        measure();
      }
    });
    const observeGeometry = () => {
      observer.disconnect();
      observer.observe(canvas);
      observer.observe(element);
      // Preceding canvas siblings can also move this container's origin.
      let directChild: HTMLElement = element;
      while (directChild.parentElement && directChild.parentElement !== canvas) {
        directChild = directChild.parentElement;
      }
      for (let sibling = directChild.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling instanceof HTMLElement) observer.observe(sibling);
      }
    };
    observeGeometry();
    const mutationObserver = new MutationObserver(() => {
      observeGeometry();
      measure();
    });
    mutationObserver.observe(canvas, { childList: true });
    return () => {
      canvas.removeEventListener("scroll", onScroll);
      observer.disconnect();
      mutationObserver.disconnect();
      canvasLocalViewportSnapshots.delete(element);
    };
  }, [containerRef, cardSizePx]);

  return viewport;
}

export function canvasViewportIsMeasurable(
  canvas: Pick<HTMLElement, "clientHeight" | "clientWidth">,
): boolean {
  return canvas.clientHeight > 0 && canvas.clientWidth > 0;
}

/** Whole CSS pixels. Fractional getBoundingClientRect edges retrigger
 *  windowing every frame on Windows DPI (Serpent-oq86). */
export function quantizeCanvasViewportOffsetPx(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export type CanvasLocalViewportSnapshot = {
  /** Container origin in canvas scroll coordinates. */
  contentTop: number;
  height: number;
  /** Last scroll event (or geometry measurement), before later DOM patches. */
  scrollTop: number;
};

/** Reuse the measured origin for geometry anchoring without a layout read. */
export function readCanvasLocalViewportSnapshot(
  container: HTMLElement,
): CanvasLocalViewportSnapshot | undefined {
  return canvasLocalViewportSnapshots.get(container);
}

export function measureCanvasLocalViewport(
  container: HTMLElement,
  canvas: HTMLElement,
): CanvasLocalViewportSnapshot | null {
  if (!canvasViewportIsMeasurable(canvas)) return null;
  const scrollTop = canvas.scrollTop;
  return {
    contentTop: container.getBoundingClientRect().top
      - canvas.getBoundingClientRect().top + scrollTop,
    height: canvas.clientHeight,
    scrollTop,
  };
}

/** Scroll-window coordinates from a cached origin; no layout measurement. */
export function canvasLocalViewportFromSnapshot(
  snapshot: CanvasLocalViewportSnapshot,
  scrollTop: number,
  overscanPx: number,
): { start: number; end: number } {
  const overscan = Math.max(0, Math.round(overscanPx));
  const start = quantizeCanvasViewportOffsetPx(scrollTop - snapshot.contentTop) - overscan;
  return { start, end: start + snapshot.height + overscan * 2 };
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
 * True when `[top, top + height]` overlaps the real canvas visible range.
 * Virtual cards outside this range stay mounted for scroll continuity but
 * must not receive a media URL (`deferUntilVisible`).
 */
export function itemIntersectsVisibleRange(
  top: number,
  height: number,
  visibleStart: number,
  visibleEnd: number,
): boolean {
  const itemTop = Number.isFinite(top) ? top : 0;
  const itemHeight = Number.isFinite(height) && height > 0 ? height : 0;
  return itemTop + itemHeight > visibleStart && itemTop < visibleEnd;
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
