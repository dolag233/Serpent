import {
  INSPECTOR_PANEL_WIDTH_MIN,
  NAV_PANEL_WIDTH_MIN,
} from "./shell-preferences";

export type ResizablePanel = "nav" | "inspector";

/** Intent width below this collapses the pane (must be < panel MIN). */
export const NAV_PANEL_AUTO_HIDE_THRESHOLD = NAV_PANEL_WIDTH_MIN - 40;
export const INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD =
  INSPECTOR_PANEL_WIDTH_MIN - 40;

/** Pointer travel from the screen edge before a collapsed pane restores. */
export const PANEL_EDGE_RESTORE_PX = 48;

/** Unclamped width implied by a drag (nav: +x wider; inspector: −x wider). */
export function resolvePanelIntentWidth(
  panel: ResizablePanel,
  startWidth: number,
  deltaX: number,
): number {
  return panel === "nav" ? startWidth + deltaX : startWidth - deltaX;
}

export function panelAutoHideThreshold(panel: ResizablePanel): number {
  return panel === "nav"
    ? NAV_PANEL_AUTO_HIDE_THRESHOLD
    : INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD;
}

export function shouldAutoHidePanel(
  panel: ResizablePanel,
  intentWidth: number,
): boolean {
  return intentWidth < panelAutoHideThreshold(panel);
}

/**
 * Edge restore: nav grows from left (positive deltaX); inspector from right
 * (negative deltaX from a right-edge start, so travel = startX - clientX).
 */
export function shouldRestorePanelFromEdge(
  panel: ResizablePanel,
  startX: number,
  clientX: number,
  thresholdPx = PANEL_EDGE_RESTORE_PX,
): boolean {
  const travel = panel === "nav" ? clientX - startX : startX - clientX;
  return travel >= thresholdPx;
}
