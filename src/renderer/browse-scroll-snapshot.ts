/**
 * Capture browse scroll + anchor state from the live canvas DOM.
 * Used before layout reflow when ResizeObserver may already see scrollTop=0.
 */

import {
  captureReflowAnchorFromCards,
  type AnchorCard,
} from "./canvas-reflow-restore";
import type { BrowseViewSnapshot } from "./view-restore";

export function measureCanvasAnchorCards(canvas: HTMLElement): AnchorCard[] {
  return Array.from(
    canvas.querySelectorAll<HTMLElement>("[data-asset-id]"),
  ).map((el) => ({
    assetId: el.dataset.assetId!,
    ...el.getBoundingClientRect(),
  }));
}

export function captureCanvasBrowseScrollSnapshot(
  canvas: HTMLElement,
): BrowseViewSnapshot | null {
  const cards = measureCanvasAnchorCards(canvas);
  if (cards.length === 0) return null;
  const viewport = canvas.getBoundingClientRect();
  const anchor = captureReflowAnchorFromCards(cards, viewport);
  if (!anchor) return null;
  // Keep the top edge of the leading visible card as the anchor. Using the
  // card center here makes every width change visibly slide the viewport
  // when the card height changes, especially in masonry mode.
  return {
    anchor,
    scrollLeft: canvas.scrollLeft,
    scrollTop: canvas.scrollTop,
  };
}

/** True when the live scrollport jumped to the top but we still have a deeper tracked position. */
export function shouldPreferTrackedBrowseSnapshot(
  liveScrollTop: number,
  tracked: BrowseViewSnapshot | null,
  trackedAnchorPresent = true,
): boolean {
  if (!tracked || tracked.scrollTop <= 48 || !trackedAnchorPresent) return false;
  return liveScrollTop <= 48;
}

/**
 * Ignore a layout-driven clamp to top only while a reflow restore is armed.
 * Without that distinction, an intentional user scroll to the top leaves a
 * stale deep snapshot behind and the next resize jumps back into old content.
 */
export function shouldUpdateTrackedBrowseSnapshot(
  previous: BrowseViewSnapshot | null,
  next: BrowseViewSnapshot,
  ignoreLayoutClamp = false,
): boolean {
  if (!ignoreLayoutClamp) return true;
  if (!previous || previous.scrollTop <= 48) return true;
  if (next.scrollTop > 48) return true;
  return false;
}
