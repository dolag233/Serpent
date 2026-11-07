/**
 * REQ-VIEW-008: decide where the browse canvas should scroll back to after
 * closing the viewer. Prefers reflow-aware anchor restoration (keeps the
 * previewed asset at the same on-screen offset even if the grid reflowed
 * while the viewer was open, e.g. the inspector panel toggled and changed
 * available width); falls back to the raw captured pixel position when the
 * asset's card can no longer be located (e.g. it left the current scope).
 *
 * DOM measuring stays in the caller (App.tsx); this module is pure so the
 * restore decision is unit-testable without jsdom.
 */
import {
  captureAnchor,
  clampScrollOffset,
  computeAnchorScrollDelta,
  type AnchorCard,
  type CanvasAnchor,
  type RectLike,
} from "./canvas-scroll-anchor";

export interface BrowseViewSnapshot {
  scrollLeft: number;
  scrollTop: number;
  maxScrollTop?: number;
  anchor: CanvasAnchor | null;
}

/**
 * Captures the state to restore to when the viewer closes. `cardRect` is the
 * previewed asset's card rect (viewport coordinates) at the moment the
 * viewer opened, or `null` if the card could not be measured (still allows
 * falling back to the raw scroll position).
 */
export function captureBrowseViewSnapshot(
  assetId: string,
  cardRect: RectLike | null,
  scrollLeft: number,
  scrollTop: number,
  maxScrollTop?: number,
): BrowseViewSnapshot {
  const position = { scrollLeft, scrollTop, ...(maxScrollTop === undefined ? {} : { maxScrollTop }) };
  if (!cardRect) return { ...position, anchor: null };
  const card: AnchorCard = { ...cardRect, assetId };
  const clientX = cardRect.left + cardRect.width / 2;
  const clientY = cardRect.top + cardRect.height / 2;
  return { ...position, anchor: captureAnchor(card, clientX, clientY) };
}

export interface ScrollExtent {
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
}

/**
 * `restoredCardRect` is the previewed asset's card rect measured after the
 * canvas is visible again and has settled at `snapshot`'s raw scroll
 * position, so the delta only needs to correct for reflow that happened
 * while the viewer was open.
 */
/**
 * True when the live canvas can actually hold the captured offset.
 * A collapsed host (viewer overlay teardown, virtual window not yet
 * remounted) reports max scroll 0; clamping then would finish at the top.
 */
export function browseRestoreExtentIsReady(
  snapshot: BrowseViewSnapshot,
  extent: ScrollExtent,
): boolean {
  if (extent.clientHeight <= 1 || extent.clientWidth <= 1) return false;
  const maxTop = Math.max(0, extent.scrollHeight - extent.clientHeight);
  const maxLeft = Math.max(0, extent.scrollWidth - extent.clientWidth);
  if (snapshot.scrollTop > maxTop + 1) {
    // At the bottom, a slightly shorter settled layout cannot hold the exact
    // old pixel offset. Accept its new bottom once most of the old extent is
    // present; a still-collapsed virtual canvas remains unready.
    const oldMax = snapshot.maxScrollTop;
    if (oldMax === undefined
      || oldMax - snapshot.scrollTop > 2
      || maxTop <= 0
      || maxTop < oldMax * 0.75
      || oldMax - maxTop > extent.clientHeight) return false;
  }
  if (snapshot.scrollLeft > maxLeft + 1) return false;
  return true;
}

export function resolveBrowseRestoreScroll(
  snapshot: BrowseViewSnapshot,
  restoredCardRect: RectLike | null,
  extent: ScrollExtent,
): { left: number; top: number } {
  const rawLeft = clampScrollOffset(
    snapshot.scrollLeft,
    extent.scrollWidth,
    extent.clientWidth,
  );
  const rawTop = clampScrollOffset(
    snapshot.scrollTop,
    extent.scrollHeight,
    extent.clientHeight,
  );
  if (!snapshot.anchor || !restoredCardRect) {
    return { left: rawLeft, top: rawTop };
  }
  const delta = computeAnchorScrollDelta(snapshot.anchor, restoredCardRect);
  return {
    left: clampScrollOffset(rawLeft + delta.deltaX, extent.scrollWidth, extent.clientWidth),
    top: clampScrollOffset(rawTop + delta.deltaY, extent.scrollHeight, extent.clientHeight),
  };
}
