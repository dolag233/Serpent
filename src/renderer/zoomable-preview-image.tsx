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
  VIEWER_MAX_SCALE,
  VIEWER_MIN_SCALE,
} from "./viewer-fit";
import {
  pbrTextureDisplayFilter,
  type PbrTextureChannelPresentation,
} from "./pbr-texture-channel";

export type ZoomableImageHandle = {
  fitToWindow: () => void;
};

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
    /** Suppress global viewer shortcuts while this surface is preloading. */
    keyboardShortcutsDisabled?: boolean;
    onPresentationReady?: () => void;
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
    /** Keep animated formats on their static placeholder until promotion. */
    isAnimated?: boolean;
    /**
     * Optional ready thumbnail / preview. Shown immediately; full `src`
     * upgrades quietly after decode (Serpent-eh07).
     */
    placeholderSrc?: string;
    /** Suppress animated full-source playback while this surface preloads. */
    preloadOnly?: boolean;
    src: string;
  }
>(function ZoomableImage(
  {
    alt,
    fitKeybinds = "space-and-f",
    isFullscreen = false,
    keyboardShortcutsDisabled = false,
    onPresentationReady,
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
    isAnimated = false,
    placeholderSrc,
    preloadOnly = false,
    src,
  },
  ref,
) {
  const t = useT();
  const imageRef = useRef<HTMLImageElement>(null);
  const [decodedSource, setDecodedSource] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const decodeRequestRef = useRef(0);
  const [sourceNatural, setSourceNatural] = useState({ w: 0, h: 0 });
  const sourceNaturalRef = useRef({ w: 0, h: 0 });
  const previousQuarterTurnsRef = useRef(displayTransform.quarterTurns);
  const useAnimatedPlaceholder = Boolean(
    preloadOnly && isAnimated && placeholderSrc,
  );
  const fullSource = useAnimatedPlaceholder ? placeholderSrc! : src;
  const activeSourceRef = useRef(fullSource);
  activeSourceRef.current = fullSource;
  // Keep the decode latch tied to the URL it proved. The first viewer render
  // can legitimately use the thumbnail as both `placeholderSrc` and `src`;
  // a later source URL must not inherit that thumbnail's decoded state.
  const fullDecoded = !useAnimatedPlaceholder && decodedSource === src;
  const fullLayerDecoded = decodedSource === fullSource;
  const {
    fitToWindow,
    measureAndFit,
    view,
    viewportPointerHandlers,
    viewportRef,
    zoomAt,
  } = useViewerZoomPan({
    keyboardShortcutsDisabled,
    onSwipeNext,
    onSwipePrevious,
  });

  const notifyPresentationReady = useCallback(() => {
    onPresentationReady?.();
  }, [onPresentationReady]);

  const measureFromImage = useCallback(
    (image: HTMLImageElement) => {
      const rotated =
        previousQuarterTurnsRef.current !== displayTransform.quarterTurns;
      previousQuarterTurnsRef.current = displayTransform.quarterTurns;
      const hadNaturalSize = sourceNaturalRef.current.w > 0;
      setSourceNatural({ w: image.naturalWidth, h: image.naturalHeight });
      sourceNaturalRef.current = {
        w: image.naturalWidth,
        h: image.naturalHeight,
      };
      const size = viewerDisplaySize(
        image.naturalWidth,
        image.naturalHeight,
        displayTransform.quarterTurns,
      );
      // Serpent-esuj: preserve the user's zoom/pan when the placeholder
      // upgrades to the decoded original (mode "preserve" keeps the relative
      // scale and pan); first measurement and rotations reset to fit. With no
      // interaction the preserve ratio is 1, so behavior equals reset.
      const mode = rotated || !hadNaturalSize ? "reset" : "preserve";
      const measured = measureAndFit(mode, { w: size.width, h: size.height });
      if (!measured) {
        sourceNaturalRef.current = { w: 0, h: 0 };
      }
      return measured;
    },
    [displayTransform.quarterTurns, measureAndFit],
  );

  useImperativeHandle(ref, () => ({ fitToWindow }), [fitToWindow]);

  useEffect(() => {
    if (fitRequestToken === undefined) return;
    fitToWindow();
  }, [fitRequestToken, fitToWindow]);

  const promoteDecodedImage = useCallback(
    (image: HTMLImageElement, source: string) => {
      if (!isDecodedImage(image)) return;
      const requestId = ++decodeRequestRef.current;
      void (async () => {
        try {
          // `load`/naturalWidth can precede the compositor's paint-ready
          // decode for large images. Wait for the browser's decode promise
          // before changing which layer is visible.
          if (typeof image.decode === "function") await image.decode();
        } catch {
          // A decode rejection is only recoverable when the image still proves
          // a usable current resource. Source changes/failed loads are stale.
          if (!isDecodedImage(image)) return;
        }
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
        const attributeSource = image.getAttribute("src");
        if (
          requestId !== decodeRequestRef.current ||
          activeSourceRef.current !== source ||
          (attributeSource !== source && image.currentSrc !== source) ||
          !image.isConnected ||
          !isDecodedImage(image)
        ) {
          return;
        }
        // Measure before committing the visible-layer switch so the first
        // full-image frame already has the correct fit/zoom geometry.
        measureFromImage(image);
        setDecodedSource(source);
        notifyPresentationReady();
      })();
    },
    [measureFromImage, notifyPresentationReady],
  );

  // Invalidate pending decode continuations before React can reconcile a new
  // source. The source identity latch above also makes this safe across the
  // passive-effect boundary of a thumbnail → original prop update.
  useEffect(() => {
    decodeRequestRef.current += 1;
    setDecodedSource(null);
    setImageError(false);
  }, [fullSource, placeholderSrc, src]);

  const handleImageError = useCallback(() => {
    // Do not leave Chromium's native broken-image glyph and alt text on the
    // canvas. The viewer owns a consistent, theme-aware failure surface.
    decodeRequestRef.current += 1;
    setImageError(true);
    setDecodedSource(null);
    setSourceNatural({ w: 0, h: 0 });
    sourceNaturalRef.current = { w: 0, h: 0 };
    notifyPresentationReady();
  }, [notifyPresentationReady]);

  const display = resolveViewerImageDisplay({
    placeholderUrl: placeholderSrc ?? null,
    fullUrl: src,
    fullDecoded,
  });
  const paintSrc = display.displayUrl ?? src;
  const hasFullUpgrade = Boolean(
    placeholderSrc && src && placeholderSrc !== src,
  );

  // Keep exactly one <img> reading the full source. The previous middle layer
  // fetched the same `src` again, decoded it through ImageBitmap, rasterized
  // a PNG, and then kept a second full-resolution <img> alive. That reduced
  // the visual gap on some files but doubled source I/O and decode pressure on
  // the viewer's critical path. The ready thumbnail remains visible while
  // this single full image loads and is revealed only after naturalWidth > 0.

  const pbrFilter = pbrChannel
    ? pbrTextureDisplayFilter(pbrChannel)
    : "none";

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (image && image.naturalWidth > 0) {
      measureFromImage(image);
      notifyPresentationReady();
    }
  }, [display.layer, fullLayerDecoded, measureFromImage, notifyPresentationReady]);

  useEffect(() => {
    if (keyboardShortcutsDisabled) return;
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
  }, [fitKeybinds, fitToWindow, keyboardShortcutsDisabled]);

  // The range must describe the same scale domain as wheel/keyboard zoom.
  // Using `fitScale * 4` made the slider stop early for small images while
  // the wheel continued to the viewer's real 8× ceiling.
  const sliderMin = VIEWER_MIN_SCALE;
  const sliderMax = VIEWER_MAX_SCALE;
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
        {imageError ? (
          <div
            aria-label={alt}
            className="preview-image-error"
            role="img"
          >
            <Icon name="broken-file" size={42} />
            <span className="preview-image-error-name">{alt}</span>
          </div>
        ) : hasFullUpgrade ? (
          <>
            <img
              alt={fullLayerDecoded ? "" : alt}
              aria-hidden={fullLayerDecoded ? true : undefined}
              className={`preview-image preview-image-placeholder${fullLayerDecoded ? " is-hidden" : ""}`}
              data-pbr-channel={pbrChannel?.channel}
              decoding="async"
              draggable={false}
              onError={handleImageError}
              onLoad={(event) => {
                setImageError(false);
                measureFromImage(event.currentTarget);
                // The placeholder is already a valid presentation for a
                // preloading viewer; it must not set the full-source latch.
                notifyPresentationReady();
              }}
              ref={fullLayerDecoded ? undefined : imageRef}
              src={placeholderSrc}
              style={{
                width: displayW,
                height: displayH,
                filter: pbrFilter,
                transform: `translate(${view.x}px, ${view.y}px) ${viewerDisplayTransformCss(displayTransform)}`,
                transformOrigin: "center center",
              }}
            />
            <img
              alt={fullLayerDecoded ? alt : ""}
              aria-hidden={!fullLayerDecoded ? true : undefined}
              className={`preview-image preview-image-full${fullLayerDecoded ? " is-visible" : " is-hidden"}`}
              data-pbr-channel={pbrChannel?.channel}
              decoding="async"
              draggable={false}
              onError={handleImageError}
              onLoad={(event) => {
                setImageError(false);
                promoteDecodedImage(event.currentTarget, fullSource);
              }}
              ref={fullLayerDecoded ? imageRef : undefined}
              src={fullSource}
              style={{
                width: displayW,
                height: displayH,
                filter: pbrFilter,
                transform: `translate(${view.x}px, ${view.y}px) ${viewerDisplayTransformCss(displayTransform)}`,
                transformOrigin: "center center",
              }}
            />
          </>
        ) : (
          <img
            alt={alt}
            className="preview-image"
            data-pbr-channel={pbrChannel?.channel}
            draggable={false}
            onError={handleImageError}
            onLoad={(event) => {
              setImageError(false);
              promoteDecodedImage(event.currentTarget, paintSrc);
            }}
            ref={imageRef}
            src={display.displayUrl ?? src}
            style={{
              width: displayW,
              height: displayH,
              filter: pbrFilter,
              transform: `translate(${view.x}px, ${view.y}px) ${viewerDisplayTransformCss(displayTransform)}`,
              transformOrigin: "center center",
            }}
          />
        )}
      </div>
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
          min={sliderMin}
          onChange={(event) => {
            const bounds = viewportRef.current?.getBoundingClientRect();
            if (!bounds) return;
            zoomAt(
              bounds.left + bounds.width / 2,
              bounds.top + bounds.height / 2,
              Number(event.target.value),
            );
          }}
          // Keep the range endpoint reachable. A 0.04 step from a 0.05
          // minimum lands on 7.97 when the user presses End, despite max=8.
          step={0.01}
          tabIndex={VIEWER_CHROME_TAB_INDEX}
          type="range"
          value={Math.min(sliderMax, Math.max(sliderMin, view.scale))}
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
