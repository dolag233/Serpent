/**
 * Coordinate helpers for blank-drag marquee selection.
 *
 * Pointer events and fixed-position UI are expressed in viewport coordinates,
 * while cards inside the scrollable canvas have a stable content coordinate.
 * Keeping the selection rectangle in content space prevents the anchor from
 * drifting when the canvas scrolls during a drag.
 */

export interface MarqueePoint {
  x: number;
  y: number;
}

export interface MarqueeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CanvasViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CanvasScrollOffset {
  left: number;
  top: number;
}

export function canvasViewportFromMetrics(
  rect: Pick<DOMRectReadOnly, "left" | "top">,
  metrics: {
    clientLeft: number;
    clientTop: number;
    clientWidth: number;
    clientHeight: number;
  },
): CanvasViewport {
  const left = rect.left + metrics.clientLeft;
  const top = rect.top + metrics.clientTop;
  return {
    left,
    top,
    right: left + metrics.clientWidth,
    bottom: top + metrics.clientHeight,
  };
}

export function clientPointToContent(
  point: MarqueePoint,
  viewport: CanvasViewport,
  scroll: CanvasScrollOffset,
): MarqueePoint {
  return {
    x: point.x - viewport.left + scroll.left,
    y: point.y - viewport.top + scroll.top,
  };
}

export function contentRectFromPoints(
  first: MarqueePoint,
  second: MarqueePoint,
): MarqueeRect {
  return {
    left: Math.min(first.x, second.x),
    top: Math.min(first.y, second.y),
    right: Math.max(first.x, second.x),
    bottom: Math.max(first.y, second.y),
  };
}

export function contentRectToViewport(
  rect: MarqueeRect,
  viewport: CanvasViewport,
  scroll: CanvasScrollOffset,
): MarqueeRect {
  return {
    left: viewport.left + rect.left - scroll.left,
    top: viewport.top + rect.top - scroll.top,
    right: viewport.left + rect.right - scroll.left,
    bottom: viewport.top + rect.bottom - scroll.top,
  };
}

export function viewportRectToContent(
  rect: MarqueeRect,
  viewport: CanvasViewport,
  scroll: CanvasScrollOffset,
): MarqueeRect {
  return {
    left: rect.left - viewport.left + scroll.left,
    top: rect.top - viewport.top + scroll.top,
    right: rect.right - viewport.left + scroll.left,
    bottom: rect.bottom - viewport.top + scroll.top,
  };
}

export function clipRectToViewport(
  rect: MarqueeRect,
  viewport: CanvasViewport,
): MarqueeRect | null {
  const left = Math.max(rect.left, viewport.left);
  const top = Math.max(rect.top, viewport.top);
  const right = Math.min(rect.right, viewport.right);
  const bottom = Math.min(rect.bottom, viewport.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

export function rectsIntersect(a: MarqueeRect, b: MarqueeRect): boolean {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}
