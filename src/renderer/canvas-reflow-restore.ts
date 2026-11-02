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
import { canvasHasPreviewScrollHold } from "./browse-scroll-debug";
import {
  readPublishedCanvasAssetLayout,
  readPublishedCanvasAssetLayoutIndex,
  type CanvasAssetLayoutRect,
} from "./canvas-asset-layout";

export type { AnchorCard, CanvasAnchor, RectLike };

export interface ScrollOffsetSnapshot {
  readonly left: number;
  readonly top: number;
}

const anchorRestoreCleanup = new WeakMap<object, () => void>();

/**
 * The outer canvas owns scroll restoration while a panel/window reflow is in
 * flight. Masonry has a legacy raw-scroll restoration loop of its own; it
 * must stand down for both the frozen-width drag phase and the anchored
 * post-drag settle phase, otherwise it can overwrite the anchor compensation
 * on the next animation frame.
 */
export function isCanvasReflowRestorationPending(
  element: { classList: Pick<DOMTokenList, "contains"> } | null,
): boolean {
  return Boolean(
    element?.classList.contains("is-reflow-frozen") ||
      element?.classList.contains("is-reflow-restoring"),
  );
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

function findMountedAnchor(
  canvas: HTMLElement,
  assetId: string,
): HTMLElement | undefined {
  for (const card of canvas.querySelectorAll<HTMLElement>("[data-asset-id]")) {
    if (card.dataset.assetId === assetId) return card;
  }
  for (const slot of canvas.querySelectorAll<HTMLElement>("[data-layout-asset-id]")) {
    if (slot.dataset.layoutAssetId === assetId) return slot;
  }
  return undefined;
}

function publishedAnchorRect(
  host: HTMLElement,
  assetId: string,
): CanvasAssetLayoutRect | null {
  const dense = readPublishedCanvasAssetLayout(host);
  if (dense) {
    return dense.find((item) => item.id === assetId) ?? null;
  }
  const index = readPublishedCanvasAssetLayoutIndex(host);
  if (!index) return null;
  let match: CanvasAssetLayoutRect | null = null;
  index.forEachAll((item) => {
    if (!match && item.id === assetId) match = item;
  });
  return match;
}

/**
 * Virtual windows unmount cards outside the overscan. Scroll toward the
 * published content rect so the slot can mount, then the DOM pass can
 * finish the client-point alignment.
 */
function scrollTowardPublishedAnchor(
  canvas: HTMLElement,
  anchor: CanvasAnchor,
): boolean {
  const hosts = canvas.querySelectorAll<HTMLElement>(
    ".justified-rows, .masonry-columns",
  );
  for (const host of hosts) {
    const rect = publishedAnchorRect(host, anchor.assetId);
    if (!rect) continue;
    const hostRect = host.getBoundingClientRect();
    const delta = computeAnchorScrollDelta(anchor, {
      left: hostRect.left + rect.x,
      top: hostRect.top + rect.y,
      width: rect.width,
      height: rect.height,
    });
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
    if (nextLeft === canvas.scrollLeft && nextTop === canvas.scrollTop) {
      return false;
    }
    canvas.scrollLeft = nextLeft;
    canvas.scrollTop = nextTop;
    return true;
  }
  return false;
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
 * Layout drift can reset scrollTop during the wait; keep the anchor in that
 * case. A new user scroll owns the viewport, however, and must cancel this
 * older reflow snapshot before the delayed frame can overwrite it.
 */
export function scheduleAnchorRestore(
  canvas: HTMLElement,
  anchor: CanvasAnchor | null,
  frameRef: { current: number | null },
  frameCount = 3,
  onRestored?: () => void,
  initialScroll?: ScrollOffsetSnapshot,
): void {
  cancelScheduledAnchorRestore(frameRef);
  if (!anchor) return;
  if (canvasHasPreviewScrollHold(canvas)) return;

  let finished = false;
  let lastRestoreTop = canvas.scrollTop;
  let lastRestoreHeight = canvas.scrollHeight;
  const cleanup = () => {
    canvas.removeEventListener?.('wheel', stopForUserInput);
    canvas.removeEventListener?.('pointerdown', stopForUserInput);
    canvas.removeEventListener?.('touchstart', stopForUserInput);
    canvas.removeEventListener?.('scroll', stopForLargeScroll);
    if (anchorRestoreCleanup.get(frameRef) === cleanup) {
      anchorRestoreCleanup.delete(frameRef);
    }
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    frameRef.current = null;
    cleanup();
    onRestored?.();
  };
  const stopForUserInput = () => {
    if (frameRef.current !== null) globalThis.cancelAnimationFrame(frameRef.current);
    finish();
  };
  const stopForLargeScroll = () => {
    const heightDrifted = Math.abs(canvas.scrollHeight - lastRestoreHeight)
      > Math.max(canvas.clientHeight, lastRestoreHeight * 0.01);
    const newMaxScroll = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
    if (heightDrifted
      && lastRestoreTop > newMaxScroll + 1
      && Math.abs(canvas.scrollTop - newMaxScroll) <= 1) {
      // Only a reduced scroll extent that actually clamps the old offset is
      // layout drift. Normal virtual-geometry updates can change total height
      // while a user is dragging the scrollbar to a distant position.
      lastRestoreHeight = canvas.scrollHeight;
      lastRestoreTop = canvas.scrollTop;
      return;
    }
    if (Math.abs(canvas.scrollTop - lastRestoreTop) > Math.max(64, canvas.clientHeight * 2)) {
      stopForUserInput();
    }
  };
  canvas.addEventListener?.('wheel', stopForUserInput, { passive: true });
  canvas.addEventListener?.('pointerdown', stopForUserInput);
  canvas.addEventListener?.('touchstart', stopForUserInput, { passive: true });
  canvas.addEventListener?.('scroll', stopForLargeScroll, { passive: true });
  anchorRestoreCleanup.set(frameRef, cleanup);

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
        lastRestoreTop = canvas.scrollTop;
        lastRestoreHeight = canvas.scrollHeight;
      }
      const settle = (passesRemaining: number, stableFrames = 0): void => {
        const restored = findMountedAnchor(canvas, anchor.assetId);
        if (!restored) {
          // A zoom reflow can drop the anchor card out of the virtual
          // window before this settle runs. Keep scrolling toward its
          // published geometry instead of leaving the pre-zoom offset.
          const nudged = scrollTowardPublishedAnchor(canvas, anchor);
          if (nudged) {
            lastRestoreTop = canvas.scrollTop;
            lastRestoreHeight = canvas.scrollHeight;
          }
          if (nudged && passesRemaining > 0) {
            frameRef.current = globalThis.requestAnimationFrame(() =>
              settle(passesRemaining - 1, 0),
            );
            return;
          }
          finish();
          return;
        }
        const rect = restored.getBoundingClientRect();
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
        const aligned =
          Math.abs(delta.deltaX) < 0.5 && Math.abs(delta.deltaY) < 0.5;
        if (nextLeft !== canvas.scrollLeft || nextTop !== canvas.scrollTop) {
          canvas.scrollLeft = nextLeft;
          canvas.scrollTop = nextTop;
          lastRestoreTop = canvas.scrollTop;
          lastRestoreHeight = canvas.scrollHeight;
        }
        const nextStableFrames = aligned ? stableFrames + 1 : 0;
        if (nextStableFrames >= 2 || passesRemaining <= 0) {
          finish();
          return;
        }
        if (passesRemaining > 0) {
          frameRef.current = globalThis.requestAnimationFrame(() =>
            settle(passesRemaining - 1, nextStableFrames),
          );
          return;
        }
        finish();
      };
      // Apply the raw snapshot once, then converge on the captured client
      // point. Re-applying the snapshot on every pass undid the previous
      // compensation just before the old "stable rect" early exit.
      // Extra passes cover a virtual window that mounts the card only
      // after the published-geometry scroll.
      settle(12);
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
  anchorRestoreCleanup.get(frameRef)?.();
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
