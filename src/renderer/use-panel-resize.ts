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

// ---------------------------------------------------------------------------
// usePanelResize (REQ-SHELL-007)
//
// Drag-resize for the shell's left navigation pane and right Inspector pane.
// Widths live as CSS custom properties consumed by the .app-shell grid tracks
// (styles.css), clamp to the shell-preferences ranges, persist on drag end,
// and reset to the layout defaults on double-click. The drag math is kept in
// the pure `resolvePanelWidth` helper so unit tests do not need React.
// ---------------------------------------------------------------------------

export type ResizablePanel = 'nav' | 'inspector';

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

export interface UsePanelResizeReturn {
  navPanelWidth: number;
  inspectorPanelWidth: number;
  /** Panel currently being dragged, if any (drives .app-shell.is-resizing). */
  resizing: ResizablePanel | null;
  /** Inline style for .app-shell: the grid tracks consume these variables. */
  shellStyle: Record<string, string>;
  beginResize: (panel: ResizablePanel, clientX: number) => void;
  resetPanel: (panel: ResizablePanel) => void;
}

export function usePanelResize(storage?: ShellPreferencesStorage): UsePanelResizeReturn {
  const [widths, setWidths] = useState(() => loadShellPreferences(storage));
  const [resizing, setResizing] = useState<ResizablePanel | null>(null);
  const dragRef = useRef<{ panel: ResizablePanel; startX: number; startWidth: number } | null>(null);
  // Always-current widths for the window-level move handler; synced via
  // effect because refs must not be written during render.
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
      };
      setResizing(panel);

      const onMove = (event: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const nextWidth = resolvePanelWidth(drag.panel, drag.startWidth, event.clientX - drag.startX);
        setWidths((prev) =>
          drag.panel === 'nav'
            ? { ...prev, navPanelWidth: nextWidth }
            : { ...prev, inspectorPanelWidth: nextWidth },
        );
        // Keep the ref current for the drag-end persist (event-handler
        // writes are fine; the state updater above stays pure).
        widthsRef.current =
          drag.panel === 'nav'
            ? { ...widthsRef.current, navPanelWidth: nextWidth }
            : { ...widthsRef.current, inspectorPanelWidth: nextWidth };
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        dragRef.current = null;
        setResizing(null);
        persist(widthsRef.current);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [persist],
  );

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

  // While dragging, force the resize cursor and block text selection
  // app-wide; restored when the drag ends.
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
    resetPanel,
  };
}
