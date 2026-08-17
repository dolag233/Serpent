/** Pixels from the scrollport edge that count as “near the scrollbar track”. */
export const SCROLLBAR_TRACK_PROXIMITY_PX = 16;

export function elementHasScrollbar(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  const scrollsY =
    (overflowY === "auto" || overflowY === "scroll") &&
    el.scrollHeight > el.clientHeight + 1;
  const scrollsX =
    (overflowX === "auto" || overflowX === "scroll") &&
    el.scrollWidth > el.clientWidth + 1;
  return scrollsY || scrollsX;
}

/**
 * True when the pointer is over the vertical and/or horizontal scrollbar
 * gutter — not merely anywhere inside the scrollport (Serpent-62wm).
 */
export function isPointerNearScrollbarTrack(
  el: HTMLElement,
  clientX: number,
  clientY: number,
  proximityPx = SCROLLBAR_TRACK_PROXIMITY_PX,
): boolean {
  const rect = el.getBoundingClientRect();
  if (
    clientY < rect.top ||
    clientY > rect.bottom ||
    clientX < rect.left ||
    clientX > rect.right
  ) {
    return false;
  }
  const hasVertical = el.scrollHeight > el.clientHeight + 1;
  const hasHorizontal = el.scrollWidth > el.clientWidth + 1;
  const nearRight = hasVertical && clientX >= rect.right - proximityPx;
  const nearBottom = hasHorizontal && clientY >= rect.bottom - proximityPx;
  return nearRight || nearBottom;
}

/** Collect scrollable ancestors of elements under the pointer. */
export function collectScrollablesAtPoint(
  x: number,
  y: number,
  doc: Document = document,
): HTMLElement[] {
  const result: HTMLElement[] = [];
  const seen = new Set<Element>();
  for (const hit of doc.elementsFromPoint(x, y)) {
    let node: Element | null = hit;
    while (node && node !== doc.documentElement) {
      if (seen.has(node)) break;
      seen.add(node);
      if (node instanceof HTMLElement && elementHasScrollbar(node)) {
        result.push(node);
      }
      node = node.parentElement;
    }
  }
  return result;
}
