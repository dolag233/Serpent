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
import { useViewerZoomPan } from "./use-viewer-zoom-pan";
import {
  isDecodedImage,
  resolveViewerImageDisplay,
} from "./viewer-mip-upgrade";

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
    /**
     * Optional ready thumbnail / preview. Shown immediately; full `src`
     * upgrades quietly after decode (Serpent-eh07).
     */
    placeholderSrc?: string;
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
    placeholderSrc,
    src,
  },
  ref,
) {
  const t = useT();
  const imageRef = useRef<HTMLImageElement>(null);
  const [fullDecoded, setFullDecoded] = useState(false);
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

  // Reset decode latch whenever the full URL identity changes.
  useEffect(() => {
    setFullDecoded(false);
  }, [src]);

  // Prefetch full image; only promote after proven decode (naturalWidth > 0).
  useEffect(() => {
    if (!src) return;
    if (placeholderSrc && src === placeholderSrc) {
      setFullDecoded(true);
      return;
    }
    let cancelled = false;
    const probe = new Image();
    const finish = () => {
      if (cancelled) return;
      if (isDecodedImage(probe)) setFullDecoded(true);
    };
    probe.onload = finish;
    probe.onerror = () => {
      // Fall through: still show placeholder; full may retry via parent.
    };
    probe.src = src;
    if (probe.complete) finish();
    return () => {
      cancelled = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [placeholderSrc, src]);

  const display = resolveViewerImageDisplay({
    placeholderUrl: placeholderSrc ?? null,
    fullUrl: src,
    fullDecoded,
  });
  const paintSrc = display.displayUrl ?? src;

  useEffect(() => {
    const image = imageRef.current;
    if (image && image.naturalWidth > 0) measureFromImage(image);
  }, [paintSrc, measureFromImage]);

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
  const displayW = natural.w > 0 ? natural.w * view.scale : undefined;
  const displayH = natural.h > 0 ? natural.h * view.scale : undefined;

  return (
    <>
      <div
        className="preview-image-viewport is-pannable"
        data-viewer-layer={display.layer}
        data-viewer-upgrading={display.upgrading ? "true" : "false"}
        ref={viewportRef}
        {...viewportPointerHandlers}
      >
        <img
          alt={alt}
          className="preview-image"
          draggable={false}
          onLoad={(event) => {
            measureFromImage(event.currentTarget);
            if (
              paintSrc === src &&
              isDecodedImage(event.currentTarget)
            ) {
              setFullDecoded(true);
            }
          }}
          ref={imageRef}
          src={paintSrc}
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
