import { describe, expect, it } from "vitest";
import {
  PANEL_AUTO_HIDE_DEAD_ZONE_PX,
  PANEL_EDGE_RESTORE_PX,
} from "../../src/renderer/panel-auto-hide";
import { resolvePanelDragMove } from "../../src/renderer/panel-drag-session";
import {
  INSPECTOR_PANEL_WIDTH_MIN,
  NAV_PANEL_WIDTH_MIN,
} from "../../src/renderer/shell-preferences";

describe("panel-drag-session (continuous hide/restore)", () => {
  it("keeps resize phase while dragging within the dead zone below min", () => {
    const start = {
      panel: "inspector" as const,
      startX: 1000,
      startWidth: INSPECTOR_PANEL_WIDTH_MIN,
      phase: "resize" as const,
    };
    // Inspector: drag right (clientX ↑) narrows. Stay just inside dead zone.
    const clientX = 1000 + (PANEL_AUTO_HIDE_DEAD_ZONE_PX - 1);
    const step = resolvePanelDragMove(start, clientX);
    expect(step.kind).toBe("resize");
    if (step.kind === "resize") {
      expect(step.width).toBe(INSPECTOR_PANEL_WIDTH_MIN);
      expect(step.next.phase).toBe("resize");
    }
  });

  it("collapses into edge-restore without ending the conceptual session", () => {
    const start = {
      panel: "inspector" as const,
      startX: 1000,
      startWidth: INSPECTOR_PANEL_WIDTH_MIN,
      phase: "resize" as const,
    };
    const clientX = 1000 + PANEL_AUTO_HIDE_DEAD_ZONE_PX + 1;
    const step = resolvePanelDragMove(start, clientX);
    expect(step.kind).toBe("collapse");
    if (step.kind === "collapse") {
      expect(step.next.phase).toBe("edge-restore");
      expect(step.next.startX).toBe(clientX);
      expect(step.next.startWidth).toBe(INSPECTOR_PANEL_WIDTH_MIN);
    }
  });

  it("restores from edge-restore into resize at min width (drag continues)", () => {
    const hiddenAt = 1200;
    const start = {
      panel: "inspector" as const,
      startX: hiddenAt,
      startWidth: INSPECTOR_PANEL_WIDTH_MIN,
      phase: "edge-restore" as const,
    };
    const clientX = hiddenAt - PANEL_EDGE_RESTORE_PX;
    const step = resolvePanelDragMove(start, clientX);
    expect(step.kind).toBe("restore");
    if (step.kind === "restore") {
      expect(step.width).toBe(INSPECTOR_PANEL_WIDTH_MIN);
      expect(step.next.phase).toBe("resize");
      expect(step.next.startX).toBe(clientX);
      expect(step.next.startWidth).toBe(INSPECTOR_PANEL_WIDTH_MIN);
    }
  });

  it("waits in edge-restore until travel reaches the dead zone", () => {
    const start = {
      panel: "nav" as const,
      startX: 0,
      startWidth: NAV_PANEL_WIDTH_MIN,
      phase: "edge-restore" as const,
    };
    const step = resolvePanelDragMove(start, PANEL_EDGE_RESTORE_PX - 1);
    expect(step.kind).toBe("edge-wait");
  });

  it("after restore, further outward drag can collapse again", () => {
    const restored = {
      panel: "inspector" as const,
      startX: 1100,
      startWidth: INSPECTOR_PANEL_WIDTH_MIN,
      phase: "resize" as const,
    };
    const step = resolvePanelDragMove(
      restored,
      1100 + PANEL_AUTO_HIDE_DEAD_ZONE_PX + 1,
    );
    expect(step.kind).toBe("collapse");
  });
});
