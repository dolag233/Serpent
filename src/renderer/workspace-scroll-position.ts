import type { WorkspaceNavViewport } from "./workspace-nav-history";

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

  const stop = () => {
    if (cancelled) return;
    cancelled = true;
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    element.removeEventListener("wheel", stop);
    element.removeEventListener("pointerdown", stop);
    element.removeEventListener("touchstart", stop);
    onComplete?.();
  };
  element.addEventListener("wheel", stop, { passive: true });
  element.addEventListener("pointerdown", stop);
  element.addEventListener("touchstart", stop, { passive: true });

  const apply = () => {
    frame = undefined;
    if (cancelled) return;
    if (!isCurrent()) {
      stop();
      return;
    }
    const extent = Math.max(0, element.scrollHeight - element.clientHeight);
    const target = resolveWorkspaceScrollTop(viewport, extent);
    element.scrollTo({ top: target, left: 0 });
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
