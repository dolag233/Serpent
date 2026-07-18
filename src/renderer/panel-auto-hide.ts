import {
  INSPECTOR_PANEL_WIDTH_MIN,
  NAV_PANEL_WIDTH_MIN,
} from "./shell-preferences";

export type ResizablePanel = "nav" | "inspector";

/**
 * REQ-SHELL-011 复验（Serpent-bhv）：段落感死区/hysteresis 的唯一幅度来源。
 * 拖小方向（越过最小宽度后还要再拖这么多才触发隐藏）与拖出方向（隐藏态往外拖
 * 这么多才重新出现）共用同一个幅度，保证双向手感一致，而不是两个互不相关的
 * 魔数（历史实现中隐藏死区是 40、边缘拖出死区是 48，彼此无关联）。
 */
export const PANEL_AUTO_HIDE_DEAD_ZONE_PX = 40;

/** Intent width below this collapses the pane (must be < panel MIN). */
export const NAV_PANEL_AUTO_HIDE_THRESHOLD =
  NAV_PANEL_WIDTH_MIN - PANEL_AUTO_HIDE_DEAD_ZONE_PX;
export const INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD =
  INSPECTOR_PANEL_WIDTH_MIN - PANEL_AUTO_HIDE_DEAD_ZONE_PX;

/** Pointer travel from the screen edge before a collapsed pane restores. */
export const PANEL_EDGE_RESTORE_PX = PANEL_AUTO_HIDE_DEAD_ZONE_PX;

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
