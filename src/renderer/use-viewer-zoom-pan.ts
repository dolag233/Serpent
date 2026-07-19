import { useCallback, useEffect, useRef, useState } from "react";

import {
  clampViewerPan,
  clampViewerScale,
  fitContainScale,
  isAtFitScale,
} from "./viewer-fit";
import { classifyViewerWheel, resolveWheelGestureAnchor } from "./viewer-wheel-intent";

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
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
}

/**
 * Shared fit/pan/zoom state machine for viewer media surfaces (image, GIF,
 * video — Serpent-yo0n / Serpent-190). Owns the viewport ref, the wheel
 * listener (mouse wheel zooms at the pointer, trackpad scroll pans, pinch /
 * Ctrl+wheel zooms — see viewer-wheel-intent.ts), drag-to-pan pointer
 * handlers, and the ResizeObserver that re-fits when the window changes.
 *
 * Consumers render the media element at `natural × view.scale` with
 * `transform: translate(view.x, view.y)` and call `measureAndFit` when the
 * media's intrinsic size becomes known.
 */
export function useViewerZoomPan({
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
          scale: clampViewerScale(nextFit * ratio),
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

      if (
        classifyViewerWheel({
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
        }) === "zoom"
      ) {
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
        Math.abs(deltaX) >= 28 && Math.abs(deltaX) > Math.abs(deltaY) * 2;
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
  }, [commitView, onSwipeNext, onSwipePrevious, zoomAt]);

  const viewportPointerHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: viewRef.current.x,
        y: viewRef.current.y,
      };
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      commitView({
        ...viewRef.current,
        x: drag.x + event.clientX - drag.startX,
        y: drag.y + event.clientY - drag.startY,
      });
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId === event.pointerId)
        dragRef.current = null;
    },
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
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
