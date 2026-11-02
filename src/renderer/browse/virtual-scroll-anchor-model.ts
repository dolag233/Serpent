/** Geometry-only anchor for a windowed canvas. No DOM layout reads on scroll. */
export type VirtualScrollAnchorModel = {
  rectAtIndex(index: number): { top: number; height: number } | null;
  firstVisibleIndex(visibleStart: number): number | null;
};

export type VirtualScrollAnchor = { index: number; top: number };

export function captureVirtualScrollAnchor(
  model: VirtualScrollAnchorModel,
  visibleStart: number,
  visibleEnd: number,
  previous: VirtualScrollAnchor | null,
): VirtualScrollAnchor | null {
  const previousRect = previous && model.rectAtIndex(previous.index);
  const index = previousRect
    && previousRect.top + previousRect.height > visibleStart
    && previousRect.top < visibleEnd
    ? previous!.index
    : model.firstVisibleIndex(visibleStart);
  if (index === null) return null;
  const rect = model.rectAtIndex(index);
  return rect ? { index, top: rect.top } : null;
}

export function virtualScrollAnchorDelta(
  model: VirtualScrollAnchorModel,
  anchor: VirtualScrollAnchor,
): number | null {
  const rect = model.rectAtIndex(anchor.index);
  return rect ? rect.top - anchor.top : null;
}
