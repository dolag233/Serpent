import type { WorkspaceNavViewport } from "./workspace-nav-history";
import { logBrowseScrollWrite } from "./browse-scroll-debug";

export function captureWorkspaceNavViewport(
  element: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight"> | null,
): WorkspaceNavViewport {
  if (!element) {
    return { scrollTop: 0, scrollProgress: 0, scrollExtent: 0 };
  }
  const scrollExtent = Math.max(0, element.scrollHeight - element.clientHeight);
  const scrollTop = Math.min(scrollExtent, Math.max(0, element.scrollTop));
  return {
    scrollTop,
    scrollProgress: scrollExtent > 0 ? scrollTop / scrollExtent : 0,
    scrollExtent,
  };
}

export function resolveWorkspaceScrollTop(
  viewport: WorkspaceNavViewport,
  currentScrollExtent: number,
): number {
  const extent = Math.max(0, currentScrollExtent);
  if (extent === 0) return 0;
  if (Math.abs(extent - viewport.scrollExtent) <= 1) {
    return Math.min(extent, viewport.scrollTop);
  }
  return Math.min(extent, Math.max(0, viewport.scrollProgress * extent));
}

/**
 * Same-scope discovery debounce is not a folder switch. Re-running
 * `finishWorkspaceNavigation` about a second after the viewer already
 * restored would fight the user's next scroll.
 */
export function shouldRestoreViewportAfterBrowseReload(
  kind: "silent" | "submit",
): boolean {
  return kind === "submit";
}

export type PendingWorkspaceViewportAction = "apply" | "clear";

/**
 * Same-commit folder/tab restore may arm `pendingViewportRestore` with
 * `{ scrollTop: 0 }`. That leftover must not keep writing on later React
 * renders — after the user has scrolled, or while the viewer owns the
 * canvas, applying it yanks the browse view to the top.
 */
export function pendingWorkspaceViewportAction(input: {
  previewActive: boolean;
  navigationPending: boolean;
  restoreLoopActive: boolean;
  intendedTop: number;
  targetTop: number;
  currentTop: number;
  extent: number;
}): PendingWorkspaceViewportAction {
  if (input.previewActive) return "clear";
  if (input.extent <= 0) return "apply";
  const restoreRunning = input.restoreLoopActive || input.navigationPending;
  if (!restoreRunning && input.intendedTop <= 1 && input.currentTop > 1) {
    return "clear";
  }
  if (
    input.intendedTop <= input.extent + 1 &&
    Math.abs(input.currentTop - input.targetTop) < 1
  ) {
    return "clear";
  }
  return "apply";
}

/**
 * Restores after virtual layout settles. The percentage keeps a location at
 * the same precise point even when the window or progressive layout changed
 * its total scroll extent while another tab/page was active.
 */
export function restoreWorkspaceNavViewport(
  element: HTMLElement,
  viewport: WorkspaceNavViewport,
  isCurrent: () => boolean,
  onComplete?: () => void,
): () => void {
  let frame: number | undefined;
  let attempts = 0;
  let stableFrames = 0;
  let previousExtent = -1;
  let cancelled = false;
  let lastAppliedTop: number | null = null;
  let lastAppliedExtent: number | null = null;

  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    element.removeEventListener("wheel", stop);
    element.removeEventListener("pointerdown", stop);
    element.removeEventListener("touchstart", stop);
    element.removeEventListener("scroll", stopOnExternalJump);
    onComplete?.();
  };
  const stopOnExternalJump = () => {
    // Native scrollbar-thumb motion does not reliably dispatch pointerdown or
    // wheel on the scroll element. A large position change after our last
    // write is user navigation, not a layout-settle adjustment; stop the
    // restore loop before its next frame can pull the viewport back.
    if (lastAppliedTop === null) return;
    const extent = Math.max(0, element.scrollHeight - element.clientHeight);
    if (
      lastAppliedExtent !== null
      && extent < lastAppliedExtent - 1
      && lastAppliedTop > extent + 1
      && Math.abs(element.scrollTop - extent) <= 1
    ) {
      // Progressive geometry briefly shortened the scroll range, so the
      // browser clamped our position. Keep restoring when the range returns.
      lastAppliedTop = element.scrollTop;
      lastAppliedExtent = extent;
      return;
    }
    if (Math.abs(element.scrollTop - lastAppliedTop) > Math.max(64, element.clientHeight * 2)) {
      stop();
    }
  };
  element.addEventListener("wheel", stop, { passive: true });
  element.addEventListener("pointerdown", stop);
  element.addEventListener("touchstart", stop, { passive: true });
  element.addEventListener("scroll", stopOnExternalJump, { passive: true });

  const apply = () => {
    frame = undefined;
    if (cancelled) return;
    if (!isCurrent()) {
      stop();
      return;
    }
    const extent = Math.max(0, element.scrollHeight - element.clientHeight);
    const target = resolveWorkspaceScrollTop(viewport, extent);
    if (Math.abs(element.scrollTop - target) >= 1) {
      logBrowseScrollWrite("restoreWorkspaceNavViewport", element, {
        target: Math.round(target),
        viewportTop: viewport.scrollTop,
        attempts,
      });
    }
    element.scrollTo({ top: target, left: 0 });
    lastAppliedTop = element.scrollTop;
    lastAppliedExtent = extent;
    attempts += 1;
    stableFrames = Math.abs(extent - previousExtent) <= 1 ? stableFrames + 1 : 0;
    previousExtent = extent;

    const canSettle = viewport.scrollTop === 0 || extent > 0;
    if ((canSettle && stableFrames >= 8) || attempts >= 120) {
      stop();
      return;
    }
    frame = window.requestAnimationFrame(apply);
  };

  frame = window.requestAnimationFrame(apply);
  return stop;
}
