import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_INSPECTOR_PANEL_WIDTH,
  DEFAULT_NAV_PANEL_WIDTH,
  clampInspectorPanelWidth,
  clampNavPanelWidth,
  loadShellPreferences,
  saveShellPreferences,
  type ShellPreferencesStorage,
} from './shell-preferences';
import {
  resolvePanelIntentWidth,
  shouldAutoHidePanel,
  shouldRestorePanelFromEdge,
  type ResizablePanel,
} from './panel-auto-hide';

export type { ResizablePanel };

/**
 * Width for `panel` after a pointer move of `deltaX` px from drag start.
 * The nav handle sits on the pane's right edge (drag right = wider); the
 * inspector handle sits on its left edge (drag left = wider).
 */
export function resolvePanelWidth(
  panel: ResizablePanel,
  startWidth: number,
  deltaX: number,
): number {
  return panel === 'nav'
    ? clampNavPanelWidth(startWidth + deltaX)
    : clampInspectorPanelWidth(startWidth - deltaX);
}

export interface UsePanelResizeOptions {
  storage?: ShellPreferencesStorage;
  /** REQ-SHELL-011: collapse when the drag intent width falls below threshold. */
  onAutoHide?: (panel: ResizablePanel) => void;
  /** REQ-SHELL-011: expand after dragging inward from the screen edge. */
  onEdgeRestore?: (panel: ResizablePanel) => void;
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
    storageOrOptions && 'getItem' in storageOrOptions
      ? { storage: storageOrOptions }
      : (storageOrOptions ?? {});
  const { storage, onAutoHide, onEdgeRestore } = options;
  const onAutoHideRef = useRef(onAutoHide);
  const onEdgeRestoreRef = useRef(onEdgeRestore);
  useEffect(() => {
    onAutoHideRef.current = onAutoHide;
    onEdgeRestoreRef.current = onEdgeRestore;
  }, [onAutoHide, onEdgeRestore]);

  const [widths, setWidths] = useState(() => loadShellPreferences(storage));
  const [resizing, setResizing] = useState<ResizablePanel | null>(null);
  const dragRef = useRef<{
    panel: ResizablePanel;
    startX: number;
    startWidth: number;
    mode: 'resize' | 'edge-restore';
  } | null>(null);
  const widthsRef = useRef(widths);
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const persist = useCallback(
    (next: typeof widths) => saveShellPreferences(next, storage),
    [storage],
  );

  const beginResize = useCallback(
    (panel: ResizablePanel, clientX: number) => {
      dragRef.current = {
        panel,
        startX: clientX,
        startWidth:
          panel === 'nav' ? widthsRef.current.navPanelWidth : widthsRef.current.inspectorPanelWidth,
        mode: 'resize',
      };
      setResizing(panel);

      const onMove = (event: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.mode !== 'resize') return;
        const nextWidth = resolvePanelWidth(drag.panel, drag.startWidth, event.clientX - drag.startX);
        setWidths((prev) =>
          drag.panel === 'nav'
            ? { ...prev, navPanelWidth: nextWidth }
            : { ...prev, inspectorPanelWidth: nextWidth },
        );
        widthsRef.current =
          drag.panel === 'nav'
            ? { ...widthsRef.current, navPanelWidth: nextWidth }
            : { ...widthsRef.current, inspectorPanelWidth: nextWidth };
      };
      const onUp = (event: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const drag = dragRef.current;
        dragRef.current = null;
        setResizing(null);
        if (!drag || drag.mode !== 'resize') return;
        const intent = resolvePanelIntentWidth(
          drag.panel,
          drag.startWidth,
          event.clientX - drag.startX,
        );
        if (shouldAutoHidePanel(drag.panel, intent)) {
          // Restore the last persisted/clamped width; do not save the tiny intent.
          widthsRef.current =
            drag.panel === 'nav'
              ? { ...widthsRef.current, navPanelWidth: drag.startWidth }
              : { ...widthsRef.current, inspectorPanelWidth: drag.startWidth };
          setWidths(widthsRef.current);
          onAutoHideRef.current?.(drag.panel);
          return;
        }
        persist(widthsRef.current);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [persist],
  );

  const beginEdgeRestore = useCallback((panel: ResizablePanel, clientX: number) => {
    dragRef.current = {
      panel,
      startX: clientX,
      startWidth:
        panel === 'nav' ? widthsRef.current.navPanelWidth : widthsRef.current.inspectorPanelWidth,
      mode: 'edge-restore',
    };
    setResizing(panel);

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.mode !== 'edge-restore') return;
      if (shouldRestorePanelFromEdge(drag.panel, drag.startX, event.clientX)) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        dragRef.current = null;
        setResizing(null);
        onEdgeRestoreRef.current?.(drag.panel);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragRef.current = null;
      setResizing(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const resetPanel = useCallback(
    (panel: ResizablePanel) => {
      const next =
        panel === 'nav'
          ? { ...widthsRef.current, navPanelWidth: DEFAULT_NAV_PANEL_WIDTH }
          : { ...widthsRef.current, inspectorPanelWidth: DEFAULT_INSPECTOR_PANEL_WIDTH };
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
    body.style.cursor = 'col-resize';
    body.style.userSelect = 'none';
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
      '--nav-width': `${widths.navPanelWidth}px`,
      '--inspector-width': `${widths.inspectorPanelWidth}px`,
    },
    beginResize,
    beginEdgeRestore,
    resetPanel,
  };
}
