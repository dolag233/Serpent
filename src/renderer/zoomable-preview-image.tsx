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
  const [imageError, setImageError] = useState(false);
  const [middleState, setMiddleState] = useState<{
    source: string;
    url: string | null;
  }>({ source: "", url: null });
  const [sourceNatural, setSourceNatural] = useState({ w: 0, h: 0 });
  const sourceNaturalRef = useRef({ w: 0, h: 0 });
  const previousQuarterTurnsRef = useRef(displayTransform.quarterTurns);
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

  // Reset the decode latch whenever the full URL identity changes (asset
  // switches remount via key; placeholder->full upgrades change src, so the
  // probe must re-decode the new URL). The measured natural size is NOT reset
  // here — asset switches already remount (key={assetId}) and the upgrade must
  // keep the previous measurement to preserve the user's zoom/pan
  // (Serpent-esuj).
  useEffect(() => {
    setFullDecoded(false);
    setImageError(false);
  }, [placeholderSrc, src]);

  const handleImageError = useCallback(() => {
    // Do not leave Chromium's native broken-image glyph and alt text on the
    // canvas. The viewer owns a consistent, theme-aware failure surface.
    setImageError(true);
    setFullDecoded(false);
    setSourceNatural({ w: 0, h: 0 });
    sourceNaturalRef.current = { w: 0, h: 0 };
  }, []);

  const display = resolveViewerImageDisplay({
    placeholderUrl: placeholderSrc ?? null,
    fullUrl: src,
    fullDecoded,
  });
  const hasFullUpgrade = Boolean(
    placeholderSrc && src && placeholderSrc !== src,
  );
  const middleSrc = middleState.source === src ? middleState.url : null;

  // Build a fit-sized middle image from the full response. This uses one
  // resized ImageBitmap decode for the quick upgrade; the full URL remains on
  // its own hidden <img> and becomes visible only after that element proves it
  // has decoded. No detached full-resolution probe is created (Serpent-h00q).
  useEffect(() => {
    if (
      !hasFullUpgrade ||
      fullDecoded ||
      typeof createImageBitmap !== "function"
    ) {
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;

    const createMiddleImage = async (): Promise<string | null> => {
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok) return null;
      const sourceBlob = await response.blob();
      const bitmap = await createImageBitmap(sourceBlob, {
        // Supplying only one dimension preserves the source aspect ratio. The
        // largest viewport edge is a good fit-sized middle target even before
        // the full source's natural dimensions are known.
        resizeWidth: Math.max(
          1,
          Math.round(
            Math.max(
              viewportRef.current?.clientWidth ?? 0,
              viewportRef.current?.clientHeight ?? 0,
              window.innerWidth,
              window.innerHeight,
            ),
          ),
        ),
        resizeQuality: "high",
      });
      try {
        if (controller.signal.aborted) return null;
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) return null;
        context.drawImage(bitmap, 0, 0);
        const middleBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/png"),
        );
        if (!middleBlob || controller.signal.aborted) return null;
        objectUrl = URL.createObjectURL(middleBlob);
        return objectUrl;
      } finally {
        bitmap.close();
      }
    };

    void createMiddleImage()
      .then((url) => {
        if (!url || controller.signal.aborted) return;
        setMiddleState({ source: src, url });
      })
      .catch(() => {
        // The placeholder remains visible if a browser cannot create the
        // resized middle layer; the full image still upgrades normally.
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fullDecoded, hasFullUpgrade, src, viewportRef]);

  const pbrChannelInfo = pbrChannel ? pbrChannelCopy(pbrChannel, t) : null;
  const pbrFilter = pbrChannel
    ? pbrTextureDisplayFilter(pbrChannel)
    : "none";

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (image && image.naturalWidth > 0) measureFromImage(image);
  }, [display.layer, fullDecoded, measureFromImage]);

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
              alt={middleSrc || fullDecoded ? "" : alt}
              aria-hidden={middleSrc || fullDecoded ? true : undefined}
              className={`preview-image preview-image-placeholder${middleSrc || fullDecoded ? " is-hidden" : ""}`}
              data-pbr-channel={pbrChannel?.channel}
              draggable={false}
              onError={handleImageError}
              onLoad={(event) => {
                setImageError(false);
                measureFromImage(event.currentTarget);
              }}
              ref={middleSrc || fullDecoded ? undefined : imageRef}
              src={placeholderSrc}
              style={{
                width: displayW,
                height: displayH,
                filter: pbrFilter,
                transform: `translate(${view.x}px, ${view.y}px) ${viewerDisplayTransformCss(displayTransform)}`,
                transformOrigin: "center center",
              }}
            />
            {middleSrc ? (
              <img
                alt={fullDecoded ? "" : alt}
                aria-hidden={fullDecoded ? true : undefined}
                className={`preview-image preview-image-middle${fullDecoded ? " is-hidden" : " is-visible"}`}
                data-pbr-channel={pbrChannel?.channel}
                draggable={false}
                onError={handleImageError}
                onLoad={(event) => {
                  setImageError(false);
                  measureFromImage(event.currentTarget);
                }}
                ref={fullDecoded ? undefined : imageRef}
                src={middleSrc}
                style={{
                  width: displayW,
                  height: displayH,
                  filter: pbrFilter,
                  transform: `translate(${view.x}px, ${view.y}px) ${viewerDisplayTransformCss(displayTransform)}`,
                  transformOrigin: "center center",
                }}
              />
            ) : null}
            <img
              alt={fullDecoded ? alt : ""}
              aria-hidden={!fullDecoded ? true : undefined}
              className={`preview-image preview-image-full${fullDecoded ? " is-visible" : " is-hidden"}`}
              data-pbr-channel={pbrChannel?.channel}
              draggable={false}
              onError={handleImageError}
              onLoad={(event) => {
                setImageError(false);
                measureFromImage(event.currentTarget);
                if (isDecodedImage(event.currentTarget)) setFullDecoded(true);
              }}
              ref={fullDecoded ? imageRef : undefined}
              src={src}
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
              measureFromImage(event.currentTarget);
              if (isDecodedImage(event.currentTarget)) setFullDecoded(true);
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
