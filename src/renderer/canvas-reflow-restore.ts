/**
 * REQ-CANVAS-019 / Serpent-32p: schedule scroll compensation after a canvas
 * width reflow so the previously visible asset set stays on screen.
 */

import {
  reflowDebug,
  summarizeReflowSnapshot,
} from "./canvas-reflow-debug";
import { escapeCssAttrValue } from "./escape-css-selector";
import {
  captureAnchor,
  pickNearestCard,
  type AnchorCard,
  type CanvasAnchor,
  type RectLike,
} from "./canvas-scroll-anchor";
import {
  applyBrowseScrollSnapshot,
  type BrowseViewSnapshot,
} from "./view-restore";

export type { AnchorCard, CanvasAnchor, RectLike };
export type CanvasReflowSnapshot = BrowseViewSnapshot;

export type ReflowRestoreResult = {
  success: boolean;
  passes: number;
  anchorFound: boolean;
  driftPx: number | null;
  scrollTopBefore: number;
  scrollTopAfter: number;
  debugLabel?: string;
};

/**
 * Among cards that vertically overlap the viewport, pick the one whose top
 * edge is closest to the viewport top (then leftmost on ties).
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
  const anchorX = topmost.left + topmost.width / 2;
  const anchorY = Math.min(
    Math.max(topmost.top, viewport.top),
    viewport.top + viewport.height,
  );
  return captureAnchor(topmost, anchorX, anchorY);
}

export function measureAnchorDriftPx(
  canvas: HTMLElement,
  snapshot: CanvasReflowSnapshot,
): number | null {
  if (!snapshot.anchor) return null;
  const restored = canvas.querySelector<HTMLElement>(
    `[data-asset-id="${escapeCssAttrValue(snapshot.anchor.assetId)}"]`,
  );
  if (!restored) return null;
  const rect = restored.getBoundingClientRect();
  const actualY = rect.top + rect.height * snapshot.anchor.ratioY;
  return Math.abs(actualY - snapshot.anchor.clientY);
}

export function applyCanvasReflowRestore(
  canvas: HTMLElement,
  snapshot: CanvasReflowSnapshot,
): boolean {
  return applyBrowseScrollSnapshot(canvas, snapshot);
}

/**
 * Wait for layout to settle, then restore. Retries while anchor drift remains.
 */
export function scheduleCanvasReflowRestore(
  canvas: HTMLElement,
  snapshot: CanvasReflowSnapshot | null,
  frameRef: { current: number | null },
  options?: {
    settleFrames?: number;
    maxPasses?: number;
    stablePasses?: number;
    driftTolerancePx?: number;
    debugLabel?: string;
    onComplete?: (result: ReflowRestoreResult) => void;
  },
): void {
  if (frameRef.current !== null) {
    globalThis.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }
  if (!snapshot) return;

  const settleFrames = options?.settleFrames ?? 2;
  const maxPasses = options?.maxPasses ?? 12;
  const requiredStablePasses = options?.stablePasses ?? 1;
  const driftTolerancePx = options?.driftTolerancePx ?? 3;
  const debugLabel = options?.debugLabel;
  let pass = 0;
  let stablePasses = 0;

  reflowDebug("schedule", {
    label: debugLabel,
    snapshot: summarizeReflowSnapshot(snapshot),
    scrollTopNow: canvas.scrollTop,
    scrollHeight: canvas.scrollHeight,
  });

  const runAfterFrames = (remaining: number, then: () => void): void => {
    if (remaining <= 0) {
      then();
      return;
    }
    frameRef.current = globalThis.requestAnimationFrame(() => {
      runAfterFrames(remaining - 1, then);
    });
  };

  const finish = (result: ReflowRestoreResult): void => {
    frameRef.current = null;
    reflowDebug("complete", { label: debugLabel, ...result });
    options?.onComplete?.(result);
  };

  const runPass = (): void => {
    pass += 1;
    const scrollTopBefore = canvas.scrollTop;
    const anchorFound = snapshot.anchor
      ? Boolean(
          canvas.querySelector(
            `[data-asset-id="${escapeCssAttrValue(snapshot.anchor.assetId)}"]`,
          ),
        )
      : false;

    reflowDebug("pass-start", {
      label: debugLabel,
      pass,
      scrollTopBefore,
      anchorFound,
    });

    const applied = applyCanvasReflowRestore(canvas, snapshot);
    const scrollTopAfter = canvas.scrollTop;
    const drift = measureAnchorDriftPx(canvas, snapshot);
    const restoredAwayFromTop =
      snapshot.scrollTop <= 48 || scrollTopAfter > 48;

    reflowDebug("pass-end", {
      label: debugLabel,
      pass,
      applied,
      anchorFound,
      driftPx: drift,
      scrollTopAfter,
      restoredAwayFromTop,
    });

    if (!applied) {
      finish({
        success: false,
        passes: pass,
        anchorFound,
        driftPx: drift,
        scrollTopBefore,
        scrollTopAfter,
        debugLabel,
      });
      return;
    }

    if (
      restoredAwayFromTop &&
      drift !== null &&
      drift <= driftTolerancePx
    ) {
      stablePasses += 1;
      reflowDebug("pass-stable", {
        label: debugLabel,
        pass,
        stablePasses,
        requiredStablePasses,
        scrollTop: canvas.scrollTop,
        scrollHeight: canvas.scrollHeight,
      });
      if (stablePasses < requiredStablePasses) {
        if (pass >= maxPasses) {
          finish({
            success: false,
            passes: pass,
            anchorFound,
            driftPx: drift,
            scrollTopBefore,
            scrollTopAfter,
            debugLabel,
          });
          return;
        }
        runAfterFrames(2, runPass);
        return;
      }
      finish({
        success: true,
        passes: pass,
        anchorFound,
        driftPx: drift,
        scrollTopBefore,
        scrollTopAfter,
        debugLabel,
      });
      return;
    }
    stablePasses = 0;

    if (pass >= maxPasses) {
      finish({
        success: false,
        passes: pass,
        anchorFound,
        driftPx: drift,
        scrollTopBefore,
        scrollTopAfter,
        debugLabel,
      });
      return;
    }

    runAfterFrames(2, runPass);
  };

  runAfterFrames(settleFrames, runPass);
}

/** @deprecated Use scheduleCanvasReflowRestore with a full BrowseViewSnapshot. */
export function scheduleAnchorRestore(
  canvas: HTMLElement,
  anchor: CanvasAnchor | null,
  frameRef: { current: number | null },
  frameCount = 3,
): void {
  if (!anchor) return;
  scheduleCanvasReflowRestore(
    canvas,
    {
      anchor,
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop,
    },
    frameRef,
    { settleFrames: frameCount },
  );
}

export function cancelScheduledAnchorRestore(
  frameRef: { current: number | null },
): void {
  if (frameRef.current !== null) {
    globalThis.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }
}

export function captureNearestCenterAnchor(
  cards: readonly AnchorCard[],
  viewport: RectLike,
  clientX: number,
  clientY: number,
): CanvasAnchor | null {
  const card = pickNearestCard(cards, viewport, clientX, clientY);
  return card ? captureAnchor(card, clientX, clientY) : null;
}
