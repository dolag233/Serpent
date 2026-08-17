import { describe, expect, it } from "vitest";
import {
  INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD,
  NAV_PANEL_AUTO_HIDE_THRESHOLD,
  PANEL_AUTO_HIDE_DEAD_ZONE_PX,
  PANEL_EDGE_RESTORE_PX,
  resolvePanelIntentWidth,
  shouldAutoHidePanel,
  shouldRestorePanelFromEdge,
} from "../../src/renderer/panel-auto-hide";
import {
  INSPECTOR_PANEL_WIDTH_MIN,
  NAV_PANEL_WIDTH_MIN,
} from "../../src/renderer/shell-preferences";

describe("panel-auto-hide", () => {
  it("computes unclamped intent widths", () => {
    expect(resolvePanelIntentWidth("nav", 224, -100)).toBe(124);
    expect(resolvePanelIntentWidth("inspector", 268, 100)).toBe(168);
  });

  // REQ-SHELL-011 复验（Serpent-bhv）：隐藏死区与拖出死区必须共用同一幅度，
  // 双向手感才一致（"双向都要有段落感"）——不能各自维护互不相关的魔数。
  it("shares one dead-zone magnitude between the hide and restore directions", () => {
    expect(PANEL_EDGE_RESTORE_PX).toBe(PANEL_AUTO_HIDE_DEAD_ZONE_PX);
    expect(NAV_PANEL_WIDTH_MIN - NAV_PANEL_AUTO_HIDE_THRESHOLD).toBe(
      PANEL_AUTO_HIDE_DEAD_ZONE_PX,
    );
    expect(INSPECTOR_PANEL_WIDTH_MIN - INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD).toBe(
      PANEL_AUTO_HIDE_DEAD_ZONE_PX,
    );
  });

  it("keeps the pane visible while the drag is still above the minimum width", () => {
    // Above MIN: no dead zone involved yet, never hides.
    expect(shouldAutoHidePanel("nav", NAV_PANEL_WIDTH_MIN)).toBe(false);
    expect(shouldAutoHidePanel("nav", NAV_PANEL_WIDTH_MIN + 1)).toBe(false);
  });

  it("keeps the pane visible while inside the dead zone below the minimum width", () => {
    // Below MIN but not yet past the dead zone: still visible (clamped at MIN
    // in the UI), matching "越过最小宽度后界面不再变窄，但还不能立刻隐藏".
    expect(shouldAutoHidePanel("nav", NAV_PANEL_WIDTH_MIN - 1)).toBe(false);
    expect(shouldAutoHidePanel("nav", NAV_PANEL_AUTO_HIDE_THRESHOLD)).toBe(
      false,
    );
    expect(
      shouldAutoHidePanel(
        "inspector",
        INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD,
      ),
    ).toBe(false);
  });

  it("hides only once the drag crosses past the dead zone", () => {
    expect(shouldAutoHidePanel("nav", NAV_PANEL_AUTO_HIDE_THRESHOLD - 1)).toBe(
      true,
    );
    expect(
      shouldAutoHidePanel(
        "inspector",
        INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD - 1,
      ),
    ).toBe(true);
  });

  it("does not restore immediately on the first pixel of outward drag from a hidden edge", () => {
    expect(shouldRestorePanelFromEdge("nav", 0, 1)).toBe(false);
    expect(
      shouldRestorePanelFromEdge("nav", 0, PANEL_EDGE_RESTORE_PX - 1),
    ).toBe(false);
    expect(
      shouldRestorePanelFromEdge("inspector", 1000, 1000 - (PANEL_EDGE_RESTORE_PX - 1)),
    ).toBe(false);
  });

  it("restores exactly once outward travel reaches the dead-zone threshold", () => {
    expect(
      shouldRestorePanelFromEdge("nav", 0, PANEL_EDGE_RESTORE_PX),
    ).toBe(true);
    expect(
      shouldRestorePanelFromEdge(
        "inspector",
        1000,
        1000 - PANEL_EDGE_RESTORE_PX,
      ),
    ).toBe(true);
  });

  it("supports a custom threshold override", () => {
    expect(shouldRestorePanelFromEdge("nav", 0, 10, 20)).toBe(false);
    expect(shouldRestorePanelFromEdge("nav", 0, 20, 20)).toBe(true);
  });
});
