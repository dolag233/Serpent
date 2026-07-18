import { describe, expect, it } from "vitest";
import {
  INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD,
  NAV_PANEL_AUTO_HIDE_THRESHOLD,
  resolvePanelIntentWidth,
  shouldAutoHidePanel,
  shouldRestorePanelFromEdge,
} from "../../src/renderer/panel-auto-hide";

describe("panel-auto-hide", () => {
  it("computes unclamped intent widths", () => {
    expect(resolvePanelIntentWidth("nav", 224, -100)).toBe(124);
    expect(resolvePanelIntentWidth("inspector", 268, 100)).toBe(168);
  });

  it("hides only below the auto-hide threshold", () => {
    expect(shouldAutoHidePanel("nav", NAV_PANEL_AUTO_HIDE_THRESHOLD)).toBe(
      false,
    );
    expect(shouldAutoHidePanel("nav", NAV_PANEL_AUTO_HIDE_THRESHOLD - 1)).toBe(
      true,
    );
    expect(
      shouldAutoHidePanel(
        "inspector",
        INSPECTOR_PANEL_AUTO_HIDE_THRESHOLD - 1,
      ),
    ).toBe(true);
    expect(shouldAutoHidePanel("nav", 200)).toBe(false);
  });

  it("restores after enough edge travel", () => {
    expect(shouldRestorePanelFromEdge("nav", 0, 47)).toBe(false);
    expect(shouldRestorePanelFromEdge("nav", 0, 48)).toBe(true);
    expect(shouldRestorePanelFromEdge("inspector", 1000, 953)).toBe(false);
    expect(shouldRestorePanelFromEdge("inspector", 1000, 952)).toBe(true);
  });
});
