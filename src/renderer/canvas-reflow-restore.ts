/**
 * REQ-CANVAS-019 / Serpent-32p: schedule scroll compensation after a canvas
 * width reflow so the previously visible asset set stays on screen.
 *
 * Pure scheduling + DOM measure helpers live here so the restore policy
 * (always re-anchor; prefer the topmost visible card) can be unit-tested
 * without mounting App.tsx.
 */

import {
  captureAnchor,
  clampScrollOffset,
  computeAnchorScrollDelta,
  pickNearestCard,
  type AnchorCard,
  type CanvasAnchor,
  type RectLike,
} from "./canvas-scroll-anchor";

export type { AnchorCard, CanvasAnchor, RectLike };

export interface ScrollOffsetSnapshot {
  readonly left: number;
  readonly top: number;
}

/**
 * Among cards that vertically overlap the viewport, pick the one whose top
 * edge is closest to the viewport top (then leftmost on ties). Anchoring the
 * topmost visible card keeps the visible set stable when column count changes
 * — better than viewport-center nearest for "A/B/C stay in view".
 */
export function pickTopmostVisibleCard(
  cards: readonly AnchorCard[],
  viewport: RectLike,
): AnchorCard | null {
  if (cards.length === 0) return null;
  const visible = cards.filter(
    (card) =>
      card.top + card.height > viewport.top &&
      card.top < viewport.top + viewport.height,
  );
  const pool = visible.length > 0 ? visible : cards;
  return pool.reduce((best, card) => {
    if (card.top < best.top - 0.5) return card;
    if (Math.abs(card.top - best.top) <= 0.5 && card.left < best.left) {
      return card;
    }
    return best;
  });
}

export function captureReflowAnchorFromCards(
  cards: readonly AnchorCard[],
  viewport: RectLike,
): CanvasAnchor | null {
  const topmost = pickTopmostVisibleCard(cards, viewport);
  if (!topmost) return null;
  // Anchor to the card's top-center within the viewport so vertical scroll
  // restores the leading edge of the visible band.
  const anchorX = topmost.left + topmost.width / 2;
  const anchorY = Math.min(
    Math.max(topmost.top, viewport.top),
    viewport.top + viewport.height,
  );
  return captureAnchor(topmost, anchorX, anchorY);
}

/** Keep the first anchor throughout one continuous resize/reflow burst. */
export function retainReflowAnchor(
  current: CanvasAnchor | null,
  cards: readonly AnchorCard[],
  viewport: RectLike,
): CanvasAnchor | null {
  return current ?? captureReflowAnchorFromCards(cards, viewport);
}

/**
 * Wait `frameCount` animation frames for layout/React commits to settle, then
 * nudge scroll so `anchor` lands back at its captured client point.
 *
 * Intentionally does **not** bail when scroll drifted during the wait: width
 * reflow often resets scrollTop (content height flicker / remount), and that
 * was the CANVAS-021 failure mode. User scroll during ~3 frames is rare; if
 * it happens, restoring the prior visible set is still the safer product
 * choice than leaving the viewport on unrelated assets.
 */
export function scheduleAnchorRestore(
  canvas: HTMLElement,
  anchor: CanvasAnchor | null,
  frameRef: { current: number | null },
  frameCount = 3,
  onRestored?: () => void,
  initialScroll?: ScrollOffsetSnapshot,
): void {
  if (frameRef.current !== null) {
    globalThis.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }
  if (!anchor) return;

  const runAfterFrames = (remaining: number): void => {
    if (remaining <= 0) {
      if (initialScroll) {
        canvas.scrollLeft = clampScrollOffset(
          initialScroll.left,
          canvas.scrollWidth,
          canvas.clientWidth,
        );
        canvas.scrollTop = clampScrollOffset(
          initialScroll.top,
          canvas.scrollHeight,
          canvas.clientHeight,
        );
      }
      const settle = (
        passesRemaining: number,
        previousRect?: RectLike,
      ): void => {
        const restored = Array.from(
          canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
        ).find((card) => card.dataset.assetId === anchor.assetId);
        if (!restored) {
          frameRef.current = null;
          onRestored?.();
          return;
        }
        const rect = restored.getBoundingClientRect();
        if (
          previousRect &&
          Math.abs(rect.left - previousRect.left) < 0.5 &&
          Math.abs(rect.top - previousRect.top) < 0.5
        ) {
          frameRef.current = null;
          onRestored?.();
          return;
        }
        const delta = computeAnchorScrollDelta(anchor, rect);
        const nextLeft = clampScrollOffset(
          canvas.scrollLeft + delta.deltaX,
          canvas.scrollWidth,
          canvas.clientWidth,
        );
        const nextTop = clampScrollOffset(
          canvas.scrollTop + delta.deltaY,
          canvas.scrollHeight,
          canvas.clientHeight,
        );
        if (nextLeft !== canvas.scrollLeft || nextTop !== canvas.scrollTop) {
          canvas.scrollLeft = nextLeft;
          canvas.scrollTop = nextTop;
        }
        if (passesRemaining > 0) {
          frameRef.current = globalThis.requestAnimationFrame(() =>
            settle(passesRemaining - 1, rect),
          );
          return;
        }
        frameRef.current = null;
        onRestored?.();
      };
      settle(3);
      return;
    }
    frameRef.current = globalThis.requestAnimationFrame(() => {
      runAfterFrames(remaining - 1);
    });
  };

  runAfterFrames(frameCount);
}

/** Cancel a previously scheduled restore (used by App unmount/effects). */
export function cancelScheduledAnchorRestore(
  frameRef: { current: number | null },
): void {
  if (frameRef.current !== null) {
    globalThis.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }
}

/** @deprecated Prefer captureReflowAnchorFromCards; kept for card-size pinch path. */
export function captureNearestCenterAnchor(
  cards: readonly AnchorCard[],
  viewport: RectLike,
  clientX: number,
  clientY: number,
): CanvasAnchor | null {
  const card = pickNearestCard(cards, viewport, clientX, clientY);
  return card ? captureAnchor(card, clientX, clientY) : null;
}
