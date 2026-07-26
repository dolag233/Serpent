/**
 * REQ-CANVAS-019: shared geometry for keeping a specific asset card anchored
 * to the same on-screen point when the canvas reflows (card-size change,
 * sidebar drag, window resize, viewer close). Pure math only — no DOM
 * access — so callers do the `getBoundingClientRect()` measuring and pass
 * plain rects in, which keeps this module unit-testable without jsdom.
 */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AnchorCard extends RectLike {
  assetId: string;
}

/**
 * Copy the geometry fields from a browser DOMRect explicitly.
 *
 * DOMRect accessors are not guaranteed to be enumerable, so `{ ...rect }`
 * can silently produce an empty object and poison every anchor calculation
 * with NaN.
 */
export function rectLikeFromDomRect(
  rect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
): RectLike {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** A captured viewport point expressed relative to the anchor card's box. */
export interface CanvasAnchor {
  assetId: string;
  ratioX: number;
  ratioY: number;
  /** Absolute (viewport) coordinates of the point at capture time. */
  clientX: number;
  clientY: number;
}

function distanceToCenter(rect: RectLike, clientX: number, clientY: number): number {
  return Math.hypot(
    rect.left + rect.width / 2 - clientX,
    rect.top + rect.height / 2 - clientY,
  );
}

/**
 * Picks the card closest to (clientX, clientY) among the cards that overlap
 * the visible viewport band vertically; falls back to the closest card
 * overall when none overlap (e.g. the point sits just outside the canvas).
 */
export function pickNearestCard(
  cards: readonly AnchorCard[],
  viewport: RectLike,
  clientX: number,
  clientY: number,
): AnchorCard | null {
  if (cards.length === 0) return null;
  const visible = cards.filter(
    (card) =>
      card.top + card.height > viewport.top && card.top < viewport.top + viewport.height,
  );
  const pool = visible.length > 0 ? visible : cards;
  return pool.reduce((closest, card) =>
    distanceToCenter(card, clientX, clientY) < distanceToCenter(closest, clientX, clientY)
      ? card
      : closest,
  );
}

/** Captures the ratio-based anchor for `card` relative to viewport point (clientX, clientY). */
export function captureAnchor(
  card: AnchorCard,
  clientX: number,
  clientY: number,
): CanvasAnchor {
  return {
    assetId: card.assetId,
    ratioX: card.width ? (clientX - card.left) / card.width : 0.5,
    ratioY: card.height ? (clientY - card.top) / card.height : 0.5,
    clientX,
    clientY,
  };
}

/**
 * Computes how far the scroll container must shift so the anchor's captured
 * viewport point lands back on the same spot within the card's new
 * (reflowed) rect.
 */
export function computeAnchorScrollDelta(
  anchor: CanvasAnchor,
  newRect: RectLike,
): { deltaX: number; deltaY: number } {
  return {
    deltaX: newRect.left + newRect.width * anchor.ratioX - anchor.clientX,
    deltaY: newRect.top + newRect.height * anchor.ratioY - anchor.clientY,
  };
}

/** Clamps a scroll offset to the valid [0, contentSize - viewportSize] range. */
export function clampScrollOffset(
  value: number,
  contentSize: number,
  viewportSize: number,
): number {
  return Math.min(Math.max(0, value), Math.max(0, contentSize - viewportSize));
}
