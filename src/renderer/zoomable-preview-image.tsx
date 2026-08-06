import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { useViewerZoomPan } from "./use-viewer-zoom-pan";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";
import {
  isDecodedImage,
  resolveViewerImageDisplay,
} from "./viewer-mip-upgrade";
import {
  IDENTITY_VIEWER_DISPLAY_TRANSFORM,
  viewerDisplaySize,
  viewerDisplayTransformCss,
  type ViewerDisplayTransform,
} from "./viewer-display-transform";
import { isViewerFitShortcut } from "./viewer-fit-shortcut";
import {
  pbrTextureDisplayFilter,
  type PbrTextureChannelPresentation,
} from "./pbr-texture-channel";
import { Notice } from "./ui/patterns";

export type ZoomableImageHandle = {
  fitToWindow: () => void;
};

function pbrChannelCopy(
  presentation: PbrTextureChannelPresentation,
  t: ReturnType<typeof useT>,
): { title: string; message: string } {
  switch (presentation.channel) {
    case "base-color":
      return {
        title: t("preview.pbrBaseColorTitle"),
        message: t("preview.pbrColorMode"),
      };
    case "normal":
      return {
        title: t("preview.pbrNormalTitle"),
        message: t("preview.pbrNormalMode"),
      };
    case "roughness":
      return {
        title: t("preview.pbrRoughnessTitle"),
        message: t("preview.pbrScalarMode"),
      };
    case "smoothness":
      return {
        title: t("preview.pbrSmoothnessTitle"),
        message: t("preview.pbrSmoothnessMode"),
      };
    case "metallic":
      return {
        title: t("preview.pbrMetallicTitle"),
        message: t("preview.pbrScalarMode"),
      };
    case "height":
      return {
        title: t("preview.pbrHeightTitle"),
        message: t("preview.pbrScalarMode"),
      };
    case "metallic-roughness":
      return {
        title: t("preview.pbrMetallicRoughnessTitle"),
        message: t("preview.pbrPackedMode"),
      };
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    // Viewer chrome controls are deliberately not typing surfaces: a user
    // may click the zoom range and then press numpad `.` without first
    // moving focus back onto the image.
    const type = target.type.toLowerCase();
    return ![
      "button",
      "checkbox",
      "file",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  }
  if (target instanceof HTMLSelectElement) return false;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest('[role="dialog"]') !== null)
  );
}

export const ZoomableImage = forwardRef<
  ZoomableImageHandle,
  {
    alt: string;
    /** Space fits by default; GIF/sequence players disable Space so it can
     * remain available for playback. The numpad decimal shortcut is always
     * enabled. */
    fitKeybinds?: "space-and-f" | "f-only";
    isFullscreen?: boolean;
    onFullscreen?: () => void;
    onSwipeNext?: () => void;
    onSwipePrevious?: () => void;
    colorSpaceOptions?: Array<{ id: string; label: string }>;
    colorSpaceValue?: string;
    onColorSpaceChange?: (colorSpace: string) => void;
    onRotate?: () => void;
    fitRequestToken?: number;
    displayTransform?: ViewerDisplayTransform;
    /** Detected read-only PBR channel presentation for this image asset. */
    pbrChannel?: PbrTextureChannelPresentation | null;
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
    colorSpaceOptions,
    colorSpaceValue,
    onColorSpaceChange,
    onRotate,
    fitRequestToken,
    displayTransform = IDENTITY_VIEWER_DISPLAY_TRANSFORM,
    pbrChannel = null,
    placeholderSrc,
    src,
  },
  ref,
) {
  const t = useT();
  const imageRef = useRef<HTMLImageElement>(null);
  const [fullDecoded, setFullDecoded] = useState(false);
  const [sourceNatural, setSourceNatural] = useState({ w: 0, h: 0 });
  const {
    fitScale,
    fitToWindow,
    measureAndFit,
    view,
    viewportPointerHandlers,
    viewportRef,
    zoomAt,
  } = useViewerZoomPan({ onSwipeNext, onSwipePrevious });

  const measureFromImage = useCallback(
    (image: HTMLImageElement) => {
      setSourceNatural({ w: image.naturalWidth, h: image.naturalHeight });
      const size = viewerDisplaySize(
        image.naturalWidth,
        image.naturalHeight,
        displayTransform.quarterTurns,
      );
      return measureAndFit("reset", { w: size.width, h: size.height });
    },
    [displayTransform.quarterTurns, measureAndFit],
  );

  useImperativeHandle(ref, () => ({ fitToWindow }), [fitToWindow]);

  useEffect(() => {
    if (fitRequestToken === undefined) return;
    fitToWindow();
  }, [fitRequestToken, fitToWindow]);

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
  const pbrChannelInfo = pbrChannel ? pbrChannelCopy(pbrChannel, t) : null;
  const pbrFilter = pbrChannel
    ? pbrTextureDisplayFilter(pbrChannel)
    : "none";

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (image && image.naturalWidth > 0) measureFromImage(image);
  }, [paintSrc, measureFromImage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key;
      // The numpad decimal key is the viewer-wide fit command.  Chromium
      // normally reports NumpadDecimal; Windows/IME paths may expose the
      // legacy Decimal value instead.
      const numpadDecimalOk = isViewerFitShortcut(event);
      const spaceOk = fitKeybinds === "space-and-f" && key === " ";
      const fitOk = numpadDecimalOk || spaceOk;
      if (!fitOk) return;
      event.preventDefault();
      event.stopPropagation();
      fitToWindow();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [fitKeybinds, fitToWindow]);

  const sliderMax = Math.max((fitScale || 1) * 4, 2);
  // Keep the element itself in source orientation. CSS rotation swaps the
  // rendered bounding box; swapping width/height here as well would stretch
  // the bitmap and effectively swap the dimensions twice.
  const displayW =
    sourceNatural.w > 0 ? sourceNatural.w * view.scale : undefined;
  const displayH =
    sourceNatural.h > 0 ? sourceNatural.h * view.scale : undefined;

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
          data-pbr-channel={pbrChannel?.channel}
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
            filter: pbrFilter,
            transform: `translate(${view.x}px, ${view.y}px) ${viewerDisplayTransformCss(displayTransform)}`,
            transformOrigin: "center center",
          }}
        />
      </div>
      {pbrChannelInfo ? (
        <Notice
          className="preview-pbr-channel-notice"
          leading={<Icon name="info" size={14} />}
          liveRegion={false}
          message={pbrChannelInfo.message}
          role="status"
          title={pbrChannelInfo.title}
          tone="info"
        />
      ) : null}
      <div
        className="preview-zoom-controls preview-chrome-fade"
        aria-label={t("preview.imageZoom")}
      >
        {colorSpaceOptions && colorSpaceOptions.length > 1 && onColorSpaceChange ? (
          <label className="preview-color-space-control">
            <span>{t("preview.colorSpace")}</span>
            <select
              aria-label={t("preview.colorSpace")}
              onChange={(event) => onColorSpaceChange(event.currentTarget.value)}
              value={colorSpaceValue}
            >
              {colorSpaceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
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
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="range"
          value={Math.min(sliderMax, Math.max(0.05, view.scale))}
        />
        {onRotate && (
          <button
            onClick={onRotate}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
            type="button"
            {...iconActionAttrs(t("preview.rotateClockwise"))}
          >
            <Icon name="rotate-cw" size={14} />
          </button>
        )}
        <button
          onClick={fitToWindow}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="button"
          {...iconActionAttrs(t("preview.fitWindow"))}
        >
          <Icon name="fit-window" size={14} />
        </button>
        {onFullscreen && (
          <button
            onClick={onFullscreen}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
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
