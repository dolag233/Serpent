import { useCallback, useEffect, useRef, useState } from "react";

import { isMacPlatform } from "./commands/command-types";
import {
  matchGlobalZoomShortcut,
  nextKeyboardZoomScale,
  GLOBAL_ZOOM_MENU_ACTION_EVENT,
  type GlobalZoomAction,
  shouldIgnoreGlobalZoomShortcut,
} from "./global-zoom-shortcuts";
import {
  clampViewerPan,
  clampViewerScale,
  fitContainScale,
  isAtFitScale,
} from "./viewer-fit";
import { isViewerPanPointerButton } from "./viewer-pointer-pan";
import { getShortcutRuntimePlatform, listenForShortcutInputs, matchesRuntimeShortcut } from "./shortcut-runtime";
import type { ShortcutEventLike } from "../shared/shortcut-resolution";
import {
  classifyViewerWheel,
  isPrimarilyHorizontalWheel,
  resolveWheelGestureAnchor,
} from "./viewer-wheel-intent";

export interface ViewerNaturalSize {
  w: number;
  h: number;
}

export interface ViewerViewState {
  scale: number;
  x: number;
  y: number;
}

interface UseViewerZoomPanOptions {
  imageWheelShortcut?: boolean;
  keyboardShortcutsDisabled?: boolean;
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
}

/**
 * Shared fit/pan/zoom state machine for viewer media surfaces (image, GIF,
 * video — Serpent-yo0n / Serpent-190). Owns the viewport ref, the wheel
 * listener (mouse wheel zooms at the pointer, trackpad scroll pans, pinch /
 * Ctrl+wheel zooms — see viewer-wheel-intent.ts), drag-to-pan pointer
 * handlers (left or middle mouse — Photoshop-style middle-button pan),
 * and the ResizeObserver that re-fits when the window changes.
 *
 * Consumers render the media element at `natural × view.scale` with
 * `transform: translate(view.x, view.y)` and call `measureAndFit` when the
 * media's intrinsic size becomes known.
 */
export function useViewerZoomPan({
  imageWheelShortcut = false,
  keyboardShortcutsDisabled = false,
  onSwipeNext,
  onSwipePrevious,
}: UseViewerZoomPanOptions) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const naturalRef = useRef<ViewerNaturalSize>({ w: 0, h: 0 });
  const fitScaleRef = useRef(0);
  const viewRef = useRef<ViewerViewState>({ scale: 1, x: 0, y: 0 });
  const swipeCooldownRef = useRef(0);
  const wheelAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    lastEventAt: number;
  } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);
  const [fitScale, setFitScale] = useState(0);
  const [natural, setNatural] = useState<ViewerNaturalSize>({ w: 0, h: 0 });
  const [view, setView] = useState<ViewerViewState>({ scale: 1, x: 0, y: 0 });

  const clampPan = useCallback((next: ViewerViewState) => {
    const viewport = viewportRef.current;
    const { w, h } = naturalRef.current;
    if (!viewport || w <= 0 || h <= 0) return { ...next, x: 0, y: 0 };
    const pan = clampViewerPan(
      next.x,
      next.y,
      w,
      h,
      next.scale,
      viewport.clientWidth,
      viewport.clientHeight,
    );
    return { scale: next.scale, ...pan };
  }, []);

  const commitView = useCallback(
    (next: ViewerViewState) => {
      const clamped = clampPan(next);
      viewRef.current = clamped;
      setView(clamped);
    },
    [clampPan],
  );

  const measureAndFit = useCallback(
    (mode: "reset" | "preserve", nextNatural: ViewerNaturalSize) => {
      const viewport = viewportRef.current;
      if (!viewport || nextNatural.w <= 0 || nextNatural.h <= 0) return false;
      naturalRef.current = nextNatural;
      setNatural(nextNatural);
      const nextFit = fitContainScale(
        nextNatural.w,
        nextNatural.h,
        viewport.clientWidth,
        viewport.clientHeight,
      );
      if (nextFit <= 0) return false;
      const previousFit = fitScaleRef.current || nextFit;
      fitScaleRef.current = nextFit;
      setFitScale(nextFit);
      if (mode === "reset") {
        commitView({ scale: nextFit, x: 0, y: 0 });
      } else {
        const ratio = viewRef.current.scale / previousFit;
        commitView({
          // Camera originals may fit below the manual zoom floor. Preserve
          // their fitted size across mip upgrades, just as reset/fit does;
          // clamping a fitted original to 5% makes large portraits jump larger.
          scale: isAtFitScale(viewRef.current.scale, previousFit)
            ? nextFit
            : clampViewerScale(nextFit * ratio),
          x: viewRef.current.x,
          y: viewRef.current.y,
        });
      }
      return true;
    },
    [commitView],
  );

  const fitToWindow = useCallback(() => {
    const viewport = viewportRef.current;
    const { w, h } = naturalRef.current;
    if (!viewport || w <= 0 || h <= 0) return;
    const nextFit = fitContainScale(
      w,
      h,
      viewport.clientWidth,
      viewport.clientHeight,
    );
    if (nextFit <= 0) return;
    fitScaleRef.current = nextFit;
    setFitScale(nextFit);
    commitView({ scale: nextFit, x: 0, y: 0 });
  }, [commitView]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const { w, h } = naturalRef.current;
      if (w <= 0 || h <= 0) return;
      const mode = isAtFitScale(viewRef.current.scale, fitScaleRef.current)
        ? "reset"
        : "preserve";
      measureAndFit(mode, { w, h });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [measureAndFit]);

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextScale: number) => {
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const current = viewRef.current;
      const scale = clampViewerScale(nextScale);
      const pointerX = clientX - bounds.left - bounds.width / 2;
      const pointerY = clientY - bounds.top - bounds.height / 2;
      const ratio = scale / current.scale;
      commitView({
        scale,
        x: pointerX - (pointerX - current.x) * ratio,
        y: pointerY - (pointerY - current.y) * ratio,
      });
    },
    [commitView],
  );

  // Cmd/Ctrl+=|-|0: zoom at viewport center; 0 = fit (Serpent-46i9).
  useEffect(() => {
    if (keyboardShortcutsDisabled) return;
    const platform = isMacPlatform(navigator.userAgent) ? "mac" : "windows";
    const applyZoomAction = (action: GlobalZoomAction) => {
      if (action === "reset") {
        fitToWindow();
        return;
      }
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      zoomAt(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
        nextKeyboardZoomScale(viewRef.current.scale, action),
      );
    };
    const onShortcutInput = (input: ShortcutEventLike, event: KeyboardEvent | MouseEvent) => {
      if (shouldIgnoreGlobalZoomShortcut(event.target)) return;
      const action = matchGlobalZoomShortcut(input, platform);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      applyZoomAction(action);
    };
    const onMenuZoom = (event: Event) => {
      if (shouldIgnoreGlobalZoomShortcut(document.activeElement)) return;
      const action = (event as CustomEvent<GlobalZoomAction>).detail;
      if (action === "in" || action === "out" || action === "reset") applyZoomAction(action);
    };
    const removeShortcutInputs = listenForShortcutInputs(window, onShortcutInput, true);
    window.addEventListener(GLOBAL_ZOOM_MENU_ACTION_EVENT, onMenuZoom);
    return () => {
      removeShortcutInputs();
      window.removeEventListener(GLOBAL_ZOOM_MENU_ACTION_EVENT, onMenuZoom);
    };
  }, [fitToWindow, keyboardShortcutsDisabled, zoomAt]);

  // Wheel: mouse wheel zooms at the pointer; trackpad two-finger scroll
  // pans; pinch (ctrlKey) zooms; at-fit horizontal flick → prev/next
  // (fallback when OS/Electron three-finger swipe is unavailable).
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const deltaX =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaX * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaX * viewport.clientWidth
            : event.deltaX;
      const deltaY =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * viewport.clientHeight
            : event.deltaY;

      const wheelIntent = classifyViewerWheel({
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
        });
      const wheelMatches = imageWheelShortcut && matchesRuntimeShortcut(
        "viewer.image.wheel-zoom",
        { key: "Wheel", ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey },
        getShortcutRuntimePlatform(),
      );
      const fixedModifiedZoom = (event.ctrlKey || event.metaKey) && wheelIntent === "zoom";
      const customZoom = wheelMatches && deltaY !== 0 && !isPrimarilyHorizontalWheel({ deltaX, deltaY });
      if (imageWheelShortcut ? (fixedModifiedZoom || customZoom) : wheelIntent === "zoom") {
        if (deltaY === 0) return;
        // The zoom center is frozen at the gesture-start pointer position
        // (Serpent-yo0n): mid-gesture pointer drift must not move it.
        const anchor = resolveWheelGestureAnchor(
          wheelAnchorRef.current,
          event.clientX,
          event.clientY,
          Date.now(),
        );
        wheelAnchorRef.current = anchor;
        zoomAt(
          anchor.clientX,
          anchor.clientY,
          viewRef.current.scale * Math.exp(-deltaY * 0.002),
        );
        return;
      }

      const atFit = isAtFitScale(viewRef.current.scale, fitScaleRef.current);
      const horizontalFlick =
        Math.abs(deltaX) >= 28 &&
        isPrimarilyHorizontalWheel({ deltaX, deltaY });
      if (atFit && horizontalFlick) {
        const now = Date.now();
        if (now - swipeCooldownRef.current > 350) {
          swipeCooldownRef.current = now;
          // deltaX > 0 → content moves right → previous; < 0 → next.
          if (deltaX > 0) onSwipePrevious?.();
          else onSwipeNext?.();
        }
        return;
      }

      const current = viewRef.current;
      commitView({
        ...current,
        x: current.x - deltaX,
        y: current.y - deltaY,
      });
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [commitView, imageWheelShortcut, onSwipeNext, onSwipePrevious, zoomAt]);

  // Mouse pan is driven from mousedown, not pointerdown. Chromium/Electron
  // often omits pointer events for the middle button (or setPointerCapture
  // throws), then starts autoscroll unless mousedown is cancelled in capture.
  // Left-button pan uses this same mouse path so the two buttons stay aligned.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let draggingButton: number | null = null;
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || draggingButton === null) return;
      commitView({
        ...viewRef.current,
        x: drag.x + event.clientX - drag.startX,
        y: drag.y + event.clientY - drag.startY,
      });
    };
    const stopDrag = () => {
      draggingButton = null;
      dragRef.current = null;
      delete viewport.dataset.panning;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    const onUp = (event: MouseEvent) => {
      if (draggingButton === null || event.button !== draggingButton) return;
      stopDrag();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!isViewerPanPointerButton(event.button)) return;
      // Touch/pen already started via pointer handlers.
      if (dragRef.current) return;
      event.preventDefault();
      draggingButton = event.button;
      dragRef.current = {
        pointerId: event.button,
        startX: event.clientX,
        startY: event.clientY,
        x: viewRef.current.x,
        y: viewRef.current.y,
      };
      viewport.dataset.panning = "true";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    const onAuxClick = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    };

    viewport.addEventListener("mousedown", onMouseDown, true);
    viewport.addEventListener("auxclick", onAuxClick, true);
    return () => {
      viewport.removeEventListener("mousedown", onMouseDown, true);
      viewport.removeEventListener("auxclick", onAuxClick, true);
      stopDrag();
    };
  }, [commitView]);

  const viewportPointerHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      // Mouse buttons (incl. middle) go through mousedown above.
      if (event.pointerType === "mouse") return;
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is optional; window-level mouse fallback still pans.
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: viewRef.current.x,
        y: viewRef.current.y,
      };
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse") return;
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      commitView({
        ...viewRef.current,
        x: drag.x + event.clientX - drag.startX,
        y: drag.y + event.clientY - drag.startY,
      });
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse") return;
      if (dragRef.current?.pointerId === event.pointerId)
        dragRef.current = null;
    },
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse") return;
      if (dragRef.current?.pointerId === event.pointerId)
        dragRef.current = null;
    },
  } as const;

  return {
    fitScale,
    fitToWindow,
    measureAndFit,
    natural,
    view,
    viewportPointerHandlers,
    viewportRef,
    zoomAt,
  };
}

export type UseViewerZoomPanApi = ReturnType<typeof useViewerZoomPan>;
