import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolvePanelDragMove,
  resolveClampedPanelWidth,
  type PanelDragSnapshot,
} from "./panel-drag-session";
import {
  DEFAULT_INSPECTOR_PANEL_WIDTH,
  DEFAULT_NAV_PANEL_WIDTH,
  loadShellPreferences,
  saveShellPreferences,
  type ShellPreferencesStorage,
} from "./shell-preferences";
import type { ResizablePanel } from "./panel-auto-hide";

export type { ResizablePanel };

/** @deprecated Prefer resolveClampedPanelWidth from panel-drag-session. */
export function resolvePanelWidth(
  panel: ResizablePanel,
  startWidth: number,
  deltaX: number,
): number {
  return resolveClampedPanelWidth(panel, startWidth, deltaX);
}

export interface UsePanelResizeOptions {
  storage?: ShellPreferencesStorage;
  /** REQ-SHELL-011: collapse when the drag intent width falls below threshold. */
  onAutoHide?: (panel: ResizablePanel) => void;
  /** REQ-SHELL-011: expand after dragging inward from the screen edge. */
  onEdgeRestore?: (panel: ResizablePanel) => void;
  /** Notify consumers at the exact end of the pointer session. */
  onResizeEnd?: (panel: ResizablePanel) => void;
}

export interface UsePanelResizeReturn {
  navPanelWidth: number;
  inspectorPanelWidth: number;
  /** Panel currently being dragged, if any (drives .app-shell.is-resizing). */
  resizing: ResizablePanel | null;
  /** Inline style for .app-shell: the grid tracks consume these variables. */
  shellStyle: Record<string, string>;
  beginResize: (panel: ResizablePanel, clientX: number) => void;
  beginEdgeRestore: (panel: ResizablePanel, clientX: number) => void;
  resetPanel: (panel: ResizablePanel) => void;
}

export function usePanelResize(
  storageOrOptions?: ShellPreferencesStorage | UsePanelResizeOptions,
): UsePanelResizeReturn {
  const options: UsePanelResizeOptions =
    storageOrOptions && "getItem" in storageOrOptions
      ? { storage: storageOrOptions }
      : (storageOrOptions ?? {});
  const { storage, onAutoHide, onEdgeRestore, onResizeEnd } = options;
  const onAutoHideRef = useRef(onAutoHide);
  const onEdgeRestoreRef = useRef(onEdgeRestore);
  const onResizeEndRef = useRef(onResizeEnd);
  useEffect(() => {
    onAutoHideRef.current = onAutoHide;
    onEdgeRestoreRef.current = onEdgeRestore;
    onResizeEndRef.current = onResizeEnd;
  }, [onAutoHide, onEdgeRestore, onResizeEnd]);

  const [widths, setWidths] = useState(() => loadShellPreferences(storage));
  const [resizing, setResizing] = useState<ResizablePanel | null>(null);
  const dragRef = useRef<PanelDragSnapshot | null>(null);
  const widthsRef = useRef(widths);
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const persist = useCallback(
    (next: typeof widths) => saveShellPreferences(next, storage),
    [storage],
  );

  const applyWidth = useCallback((panel: ResizablePanel, width: number) => {
    const next =
      panel === "nav"
        ? { ...widthsRef.current, navPanelWidth: width }
        : { ...widthsRef.current, inspectorPanelWidth: width };
    widthsRef.current = next;
    setWidths(next);
  }, []);

  /**
   * One continuous pointer session across resize ↔ hide ↔ restore.
   * SHELL-018: listeners stay until pointerup so revealing a hidden pane does
   * not forcibly end the drag.
   */
  const attachContinuousDrag = useCallback(
    (initial: PanelDragSnapshot) => {
      dragRef.current = initial;
      setResizing(initial.panel);

      const onMove = (event: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const step = resolvePanelDragMove(drag, event.clientX);
        dragRef.current = step.next;
        if (step.kind === "resize") {
          applyWidth(drag.panel, step.width);
          return;
        }
        if (step.kind === "collapse") {
          applyWidth(drag.panel, step.next.startWidth);
          onAutoHideRef.current?.(drag.panel);
          return;
        }
        if (step.kind === "restore") {
          applyWidth(drag.panel, step.width);
          onEdgeRestoreRef.current?.(drag.panel);
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const drag = dragRef.current;
        dragRef.current = null;
        if (drag) {
          onResizeEndRef.current?.(drag.panel);
        }
        setResizing(null);
        // Persist only when the pane is still open (resize phase). Hidden
        // edge-restore ends without writing a collapsed width.
        if (drag?.phase === "resize") {
          persist(widthsRef.current);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [applyWidth, persist],
  );

  const beginResize = useCallback(
    (panel: ResizablePanel, clientX: number) => {
      attachContinuousDrag({
        panel,
        startX: clientX,
        startWidth:
          panel === "nav"
            ? widthsRef.current.navPanelWidth
            : widthsRef.current.inspectorPanelWidth,
        phase: "resize",
      });
    },
    [attachContinuousDrag],
  );

  const beginEdgeRestore = useCallback(
    (panel: ResizablePanel, clientX: number) => {
      attachContinuousDrag({
        panel,
        startX: clientX,
        startWidth:
          panel === "nav"
            ? widthsRef.current.navPanelWidth
            : widthsRef.current.inspectorPanelWidth,
        phase: "edge-restore",
      });
    },
    [attachContinuousDrag],
  );

  const resetPanel = useCallback(
    (panel: ResizablePanel) => {
      const next =
        panel === "nav"
          ? { ...widthsRef.current, navPanelWidth: DEFAULT_NAV_PANEL_WIDTH }
          : {
              ...widthsRef.current,
              inspectorPanelWidth: DEFAULT_INSPECTOR_PANEL_WIDTH,
            };
      widthsRef.current = next;
      setWidths(next);
      persist(next);
    },
    [persist],
  );

  useEffect(() => {
    if (!resizing) return;
    const { body } = document;
    const prevCursor = body.style.cursor;
    const prevSelect = body.style.userSelect;
    body.style.cursor = "col-resize";
    body.style.userSelect = "none";
    return () => {
      body.style.cursor = prevCursor;
      body.style.userSelect = prevSelect;
    };
  }, [resizing]);

  return {
    navPanelWidth: widths.navPanelWidth,
    inspectorPanelWidth: widths.inspectorPanelWidth,
    resizing,
    shellStyle: {
      "--nav-width": `${widths.navPanelWidth}px`,
      "--inspector-width": `${widths.inspectorPanelWidth}px`,
    },
    beginResize,
    beginEdgeRestore,
    resetPanel,
  };
}
