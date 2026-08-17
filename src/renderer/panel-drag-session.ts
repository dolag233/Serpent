import {
  resolvePanelIntentWidth,
  shouldAutoHidePanel,
  shouldRestorePanelFromEdge,
  type ResizablePanel,
} from "./panel-auto-hide";
import {
  INSPECTOR_PANEL_WIDTH_MIN,
  NAV_PANEL_WIDTH_MIN,
  clampInspectorPanelWidth,
  clampNavPanelWidth,
} from "./shell-preferences";

export type PanelDragPhase = "resize" | "edge-restore";

export type PanelDragSnapshot = {
  panel: ResizablePanel;
  startX: number;
  startWidth: number;
  phase: PanelDragPhase;
};

export type PanelDragMoveResult =
  | { kind: "resize"; width: number; next: PanelDragSnapshot }
  | { kind: "collapse"; next: PanelDragSnapshot }
  | { kind: "restore"; width: number; next: PanelDragSnapshot }
  | { kind: "edge-wait"; next: PanelDragSnapshot };

function panelMinWidth(panel: ResizablePanel): number {
  return panel === "nav" ? NAV_PANEL_WIDTH_MIN : INSPECTOR_PANEL_WIDTH_MIN;
}

/** Width for a resize-phase drag (nav: +x wider; inspector: −x wider). */
export function resolveClampedPanelWidth(
  panel: ResizablePanel,
  startWidth: number,
  deltaX: number,
): number {
  return panel === "nav"
    ? clampNavPanelWidth(startWidth + deltaX)
    : clampInspectorPanelWidth(startWidth - deltaX);
}

/**
 * Pure step for continuous panel drag across hide ↔ show (SHELL-018).
 * Hide/restore transitions must not end the drag session — only pointerup does.
 */
export function resolvePanelDragMove(
  drag: PanelDragSnapshot,
  clientX: number,
): PanelDragMoveResult {
  if (drag.phase === "edge-restore") {
    if (shouldRestorePanelFromEdge(drag.panel, drag.startX, clientX)) {
      const min = panelMinWidth(drag.panel);
      return {
        kind: "restore",
        width: min,
        next: {
          panel: drag.panel,
          startX: clientX,
          startWidth: min,
          phase: "resize",
        },
      };
    }
    return { kind: "edge-wait", next: drag };
  }

  const intent = resolvePanelIntentWidth(
    drag.panel,
    drag.startWidth,
    clientX - drag.startX,
  );
  if (shouldAutoHidePanel(drag.panel, intent)) {
    return {
      kind: "collapse",
      next: {
        panel: drag.panel,
        startX: clientX,
        startWidth: panelMinWidth(drag.panel),
        phase: "edge-restore",
      },
    };
  }

  const width = resolveClampedPanelWidth(
    drag.panel,
    drag.startWidth,
    clientX - drag.startX,
  );
  return { kind: "resize", width, next: drag };
}
