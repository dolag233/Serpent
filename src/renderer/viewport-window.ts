import {
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

/** Extra pixels above/below the canvas viewport that stay mounted. */
export const VIEWPORT_OVERSCAN_PX = 1200;

export function useCanvasLocalViewport(
  containerRef: RefObject<HTMLElement | null>,
): { start: number; end: number } {
  const [viewport, setViewport] = useState({ start: 0, end: 2400 });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const canvas = element.closest<HTMLElement>(".workspace-canvas");
    if (!canvas) return;

    let raf = 0;
    const update = () => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = readCanvasLocalViewport(element, canvas);
        setViewport((previous) =>
          previous.start === next.start && previous.end === next.end
            ? previous
            : next,
        );
      });
    };

    update();
    canvas.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(canvas);
    observer.observe(element);
    return () => {
      canvas.removeEventListener("scroll", update);
      observer.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [containerRef]);

  return viewport;
}
export function readCanvasLocalViewport(
  container: HTMLElement,
  canvas: HTMLElement,
  overscanPx: number = VIEWPORT_OVERSCAN_PX,
): { start: number; end: number } {
  const containerRect = container.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const start = canvasRect.top - containerRect.top - overscanPx;
  const end = start + canvas.clientHeight + overscanPx * 2;
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
