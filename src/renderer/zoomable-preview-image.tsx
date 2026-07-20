import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { useViewerZoomPan } from "./use-viewer-zoom-pan";

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
    /** Space+F fit by default; GIF player uses F-only so Space can pause. */
    fitKeybinds?: "space-and-f" | "f-only";
    isFullscreen?: boolean;
    onFullscreen?: () => void;
    onSwipeNext?: () => void;
    onSwipePrevious?: () => void;
    src: string;
  }
>(function ZoomableImage(
  {
    alt,
    fitKeybinds = "space-and-f",
    isFullscreen = false,
    onFullscreen,
    onSwipeNext,
    onSwipePrevious,
    src,
  },
  ref,
) {
  const t = useT();
  const imageRef = useRef<HTMLImageElement>(null);
  const {
    fitScale,
    fitToWindow,
    measureAndFit,
    natural,
    view,
    viewportPointerHandlers,
    viewportRef,
    zoomAt,
  } = useViewerZoomPan({ onSwipeNext, onSwipePrevious });

  const measureFromImage = useCallback(
    (image: HTMLImageElement) =>
      measureAndFit("reset", {
        w: image.naturalWidth,
        h: image.naturalHeight,
      }),
    [measureAndFit],
  );

  useImperativeHandle(ref, () => ({ fitToWindow }), [fitToWindow]);

  useEffect(() => {
    const image = imageRef.current;
    if (image && image.naturalWidth > 0) measureFromImage(image);
  }, [src, measureFromImage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key;
      const spaceOk = fitKeybinds === "space-and-f" && key === " ";
      const fitOk = key === "f" || key === "F" || spaceOk;
      if (!fitOk) return;
      event.preventDefault();
      event.stopPropagation();
      fitToWindow();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [fitKeybinds, fitToWindow]);

  const sliderMax = Math.max((fitScale || 1) * 4, 2);
  const percentLabel = Math.round(view.scale * 100);
  const displayW = natural.w > 0 ? natural.w * view.scale : undefined;
  const displayH = natural.h > 0 ? natural.h * view.scale : undefined;

  return (
    <>
      <div
        className="preview-image-viewport is-pannable"
        ref={viewportRef}
        {...viewportPointerHandlers}
      >
        <img
          alt={alt}
          className="preview-image"
          draggable={false}
          onLoad={(event) => {
            measureFromImage(event.currentTarget);
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
            {...iconActionAttrs(
              isFullscreen
                ? t("preview.exitFullscreen")
                : t("preview.fullscreen"),
            )}
          >
            <Icon
              name={isFullscreen ? "fullscreen-exit" : "fullscreen"}
              size={14}
            />
          </button>
        )}
      </div>
    </>
  );
});
