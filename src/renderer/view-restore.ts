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
import { escapeCssAttrValue } from "./escape-css-selector";

export interface BrowseViewSnapshot {
  scrollLeft: number;
  scrollTop: number;
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
): BrowseViewSnapshot {
  if (!cardRect) return { scrollLeft, scrollTop, anchor: null };
  const card: AnchorCard = { ...cardRect, assetId };
  const clientX = cardRect.left + cardRect.width / 2;
  const clientY = cardRect.top + cardRect.height / 2;
  return { scrollLeft, scrollTop, anchor: captureAnchor(card, clientX, clientY) };
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
/** Apply a captured browse snapshot to a scroll container (viewer close + reflow). */
export function applyBrowseScrollSnapshot(
  canvas: {
    scrollLeft: number;
    scrollTop: number;
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
    scrollTo: (options: { left: number; top: number }) => void;
    querySelector: (selector: string) => Element | null;
  },
  snapshot: BrowseViewSnapshot,
): boolean {
  canvas.scrollTo({
    left: snapshot.scrollLeft,
    top: snapshot.scrollTop,
  });
  const restoredCard = snapshot.anchor
    ? canvas.querySelector(
        `[data-asset-id="${escapeCssAttrValue(snapshot.anchor.assetId)}"]`,
      )
    : null;
  const target = resolveBrowseRestoreScroll(
    snapshot,
    restoredCard?.getBoundingClientRect() ?? null,
    {
      scrollWidth: canvas.scrollWidth,
      scrollHeight: canvas.scrollHeight,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
    },
  );
  canvas.scrollTo({ left: target.left, top: target.top });
  return Boolean(restoredCard ?? !snapshot.anchor);
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
