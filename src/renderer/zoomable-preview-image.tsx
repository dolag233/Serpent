import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import {
  clampViewerPan,
  clampViewerScale,
  fitContainScale,
  isAtFitScale,
} from "./viewer-fit";

export type ZoomableImageHandle = {
  fitToWindow: () => void;
};

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement &&
      (target.isContentEditable || target.closest('[role="dialog"]') !== null))
  );
}

export const ZoomableImage = forwardRef<
  ZoomableImageHandle,
  {
    alt: string;
    onFullscreen?: () => void;
    onSwipeNext?: () => void;
    onSwipePrevious?: () => void;
    src: string;
  }
>(function ZoomableImage(
  { alt, onFullscreen, onSwipeNext, onSwipePrevious, src },
  ref,
) {
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const naturalRef = useRef({ w: 0, h: 0 });
  const fitScaleRef = useRef(0);
  const viewRef = useRef({ scale: 1, x: 0, y: 0 });
  const swipeCooldownRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);
  const [fitScale, setFitScale] = useState(0);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });

  const clampPan = useCallback(
    (next: { scale: number; x: number; y: number }) => {
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
    },
    [],
  );

  const commitView = useCallback(
    (next: { scale: number; x: number; y: number }) => {
      const clamped = clampPan(next);
      viewRef.current = clamped;
      setView(clamped);
    },
    [clampPan],
  );

  const measureAndFit = useCallback(
    (mode: "reset" | "preserve") => {
      const viewport = viewportRef.current;
      const image = imageRef.current;
      if (!viewport || !image || image.naturalWidth <= 0) return false;
      const nextNatural = { w: image.naturalWidth, h: image.naturalHeight };
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
    measureAndFit("reset");
  }, [measureAndFit]);

  useImperativeHandle(ref, () => ({ fitToWindow }), [fitToWindow]);

  useEffect(() => {
    const image = imageRef.current;
    if (image && image.naturalWidth > 0) measureAndFit("reset");
  }, [src, measureAndFit]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (naturalRef.current.w <= 0) return;
      const mode = isAtFitScale(viewRef.current.scale, fitScaleRef.current)
        ? "reset"
        : "preserve";
      measureAndFit(mode);
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

  // Trackpad: two-finger scroll pans; pinch zooms; at-fit horizontal flick →
  // prev/next (fallback when OS/Electron three-finger swipe is unavailable).
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

      if (event.ctrlKey || event.metaKey) {
        zoomAt(
          event.clientX,
          event.clientY,
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key;
      if (key !== " " && key !== "f" && key !== "F") return;
      event.preventDefault();
      event.stopPropagation();
      fitToWindow();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [fitToWindow]);

  const sliderMax = Math.max((fitScale || 1) * 4, 2);
  const percentLabel = Math.round(view.scale * 100);
  const displayW = natural.w > 0 ? natural.w * view.scale : undefined;
  const displayH = natural.h > 0 ? natural.h * view.scale : undefined;

  return (
    <>
      <div
        className="preview-image-viewport is-pannable"
        onPointerDown={(event) => {
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
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          commitView({
            ...viewRef.current,
            x: drag.x + event.clientX - drag.startX,
            y: drag.y + event.clientY - drag.startY,
          });
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId)
            dragRef.current = null;
        }}
        onPointerCancel={(event) => {
          if (dragRef.current?.pointerId === event.pointerId)
            dragRef.current = null;
        }}
        ref={viewportRef}
      >
        <img
          alt={alt}
          className="preview-image"
          draggable={false}
          onLoad={() => {
            measureAndFit("reset");
          }}
          ref={imageRef}
          src={src}
          style={{
            width: displayW,
            height: displayH,
            transform: `translate(${view.x}px, ${view.y}px)`,
            transformOrigin: "center center",
          }}
        />
      </div>
      <div
        className="preview-zoom-controls preview-chrome-fade"
        aria-label={t("preview.imageZoom")}
      >
        <span className="preview-zoom-label">{percentLabel}%</span>
        <input
          aria-label={t("preview.imageZoom")}
          max={sliderMax}
          min={Math.min(fitScale || 0.1, 0.1)}
          onChange={(event) => {
            const bounds = viewportRef.current?.getBoundingClientRect();
            if (!bounds) return;
            zoomAt(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
              Number(event.target.value),
            );
          }}
          step={Math.max(sliderMax / 200, 0.01)}
          type="range"
          value={Math.min(sliderMax, Math.max(0.05, view.scale))}
        />
        <button
          onClick={fitToWindow}
          type="button"
          {...iconActionAttrs(t("preview.fitWindow"))}
        >
          <Icon name="fit-window" size={14} />
        </button>
        {onFullscreen && (
          <button
            onClick={onFullscreen}
            type="button"
            {...iconActionAttrs(t("preview.fullscreen"))}
          >
            <Icon name="fullscreen" size={14} />
          </button>
        )}
      </div>
    </>
  );
});
