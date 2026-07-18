import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";

import type { AssetSummary } from "../shared/asset-types";
import type {
  PreviewResolution,
  SerpentLibraryApi,
} from "../shared/library-api";
import {
  DirectPlayCapabilityService,
  type DirectPlayMediaDescriptor,
} from "./direct-play-capability";
import { useT, type TranslateFn } from "./i18n";
import {
  nextDirectApprovedState,
  samePreviewPlayback,
  shouldContinuePreviewPolling,
} from "./preview-poll";

interface AssetPreviewModalProps {
  api: SerpentLibraryApi;
  asset: AssetSummary;
  libraryId: string;
  onClose(): void;
  onNext?: () => void;
  onPrevious?: () => void;
}

const PREVIEW_ERROR_KEYS: Record<string, string> = {
  FFMPEG_REQUIRED: "preview.ffmpegRequired",
  OIIO_REQUIRED: "preview.oiioRequired",
  SHARP_UNAVAILABLE: "preview.sharpUnavailable",
  MEDIA_PROCESSING_FAILED: "preview.mediaProcessingFailed",
  UNSUPPORTED_FORMAT: "preview.unsupportedFormat",
};
const directPlaybackCapability = new DirectPlayCapabilityService({
  runtime: {
    platform: navigator.platform || "unknown",
    arch: /arm64|aarch64/iu.test(navigator.userAgent)
      ? "arm64"
      : /x86_64|x64|win64/iu.test(navigator.userAgent)
        ? "x64"
        : "unknown",
  },
  canPlayType: (query) => document.createElement("video").canPlayType(query),
  probeDirectLoad: ({ sourceUrl }) =>
    new Promise<boolean>((resolve) => {
      if (!sourceUrl) {
        resolve(false);
        return;
      }
      const video = document.createElement("video");
      let settled = false;
      const finish = (supported: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        video.removeAttribute("src");
        video.load();
        resolve(supported);
      };
      const timeout = window.setTimeout(() => finish(false), 5_000);
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => finish(true);
      video.onerror = () => finish(false);
      video.src = sourceUrl;
      video.load();
    }),
});

function previewErrorDetail(
  errorCode: string | undefined,
  t: TranslateFn,
): string | undefined {
  if (!errorCode) return undefined;
  const key = PREVIEW_ERROR_KEYS[errorCode];
  return key ? t(key) : undefined;
}

function previewFailureMessage(
  resolution: PreviewResolution,
  t: TranslateFn,
): string {
  if (resolution.errorCode) {
    return (
      previewErrorDetail(resolution.errorCode, t) ??
      t("preview.failedWithCode", { code: resolution.errorCode })
    );
  }
  if (resolution.status === "pending") return t("preview.pending");
  return t("preview.notReady");
}

function requestFailureMessage(
  prefix: string,
  error: { message: string; reason?: string },
  t: TranslateFn,
): string {
  const actionableReason = previewErrorDetail(error.reason, t);
  if (actionableReason) {
    return t("preview.requestFailed", { prefix, detail: actionableReason });
  }
  if (error.reason) {
    return t("preview.requestFailedWithReason", {
      prefix,
      detail: error.message,
      reason: error.reason,
    });
  }
  return t("preview.requestFailed", { prefix, detail: error.message });
}

function safeRendererDiagnostic(value: string): string {
  const redacted = value.replace(
    /file:\/\/\S+|[A-Za-z]:\\\S+|\/(?:Users|home|Volumes|private|tmp)\/\S+/gu,
    "[redacted-path]",
  );
  return Array.from(redacted, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .trim()
    .slice(0, 500);
}

function ZoomableImage({ alt, src }: { alt: string; src: string }) {
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });

  const zoomAt = useCallback(
    (clientX: number, clientY: number, nextScale: number) => {
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setView((current) => {
        const scale = Math.min(8, Math.max(0.1, nextScale));
        const pointerX = clientX - bounds.left - bounds.width / 2;
        const pointerY = clientY - bounds.top - bounds.height / 2;
        const ratio = scale / current.scale;
        return {
          scale,
          x: pointerX - (pointerX - current.x) * ratio,
          y: pointerY - (pointerY - current.y) * ratio,
        };
      });
    },
    [],
  );
  const zoomAtViewportCenter = useCallback(
    (nextScale: number) => {
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      zoomAt(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
        nextScale,
      );
    },
    [zoomAt],
  );

  return (
    <>
      <div
        className="preview-image-viewport"
        onPointerDown={(event) => {
          if (view.scale <= 1) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: view.x,
            y: view.y,
          };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          setView((current) => ({
            ...current,
            x: drag.x + event.clientX - drag.startX,
            y: drag.y + event.clientY - drag.startY,
          }));
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId)
            dragRef.current = null;
        }}
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          const delta =
            event.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? event.deltaY * 16
              : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? event.deltaY * event.currentTarget.clientHeight
                : event.deltaY;
          zoomAt(
            event.clientX,
            event.clientY,
            view.scale * Math.exp(-delta * 0.002),
          );
        }}
        ref={viewportRef}
      >
        <img
          alt={alt}
          className="preview-image"
          draggable={false}
          src={src}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        />
      </div>
      <div className="preview-zoom-controls" aria-label={t("preview.imageZoom")}>
        <button
          aria-label={t("preview.zoomOut")}
          title={t("preview.zoomOut")}
          onClick={() => zoomAtViewportCenter(view.scale / 1.25)}
          type="button"
        >
          −
        </button>
        <button
          aria-label={t("preview.actualSize")}
          title={t("preview.actualSize")}
          onClick={() => setView({ scale: 1, x: 0, y: 0 })}
          type="button"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button
          aria-label={t("preview.zoomIn")}
          title={t("preview.zoomIn")}
          onClick={() => zoomAtViewportCenter(view.scale * 1.25)}
          type="button"
        >
          +
        </button>
        <button onClick={() => setView({ scale: 1, x: 0, y: 0 })} type="button">
          {t("preview.fitWindow")}
        </button>
      </div>
    </>
  );
}

export function AssetPreviewModal({
  api,
  asset,
  libraryId,
  onClose,
  onNext,
  onPrevious,
}: AssetPreviewModalProps) {
  const t = useT();
  const modalRef = useRef<HTMLElement>(null);
  const requestSequence = useRef(0);
  const [resolution, setResolution] = useState<PreviewResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [directApproved, setDirectApproved] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const resolutionRef = useRef<PreviewResolution | null>(null);
  const directApprovedRef = useRef(false);
  const directGateIdentityRef = useRef<string | null>(null);

  const resolvePreview = useCallback(
    async (quiet = false, mode: "client" | "fullscreen" = "client") => {
      const sequence = ++requestSequence.current;
      if (!quiet) setLoading(true);
      try {
        const result = await api.requestPreview({
          libraryId,
          assetId: asset.assetId,
          mode,
        });
        if (sequence !== requestSequence.current) return result;
        if (!result.ok) {
          setError(
            requestFailureMessage(t("preview.cannotOpen"), result.error, t),
          );
        } else {
          setResolution((previous) => {
            if (previous && samePreviewPlayback(previous, result.value)) {
              return previous;
            }
            return result.value;
          });
          const gated = nextDirectApprovedState({
            resolution: result.value,
            previousIdentity: directGateIdentityRef.current,
            previousApproved: directApprovedRef.current,
          });
          directGateIdentityRef.current = gated.identity;
          setDirectApproved(gated.approved);
          setError(null);
        }
        return result;
      } catch {
        if (sequence === requestSequence.current) {
          setError(t("preview.cannotOpenNoResponse"));
        }
        return undefined;
      } finally {
        if (!quiet && sequence === requestSequence.current) setLoading(false);
      }
    },
    [api, asset.assetId, libraryId, t],
  );

  const ensureProxyFallback = useCallback(
    async (errorCode: string) => {
      const playbackToken = resolution?.playbackToken;
      if (
        !playbackToken ||
        !directPlaybackCapability.claimProxyFallback(playbackToken)
          .shouldRequestProxy
      )
        return;
      setResolution((current) =>
        current
          ? {
              ...current,
              status: "pending",
              kind: "webm_proxy",
              url: undefined,
            }
          : current,
      );
      const detail = `Direct playback unavailable: ${errorCode}`;
      void api
        .reportPreviewError({
          libraryId,
          assetId: asset.assetId,
          errorCode,
          detail,
        })
        .catch(() => undefined);
      const result = await api.retryArtifact({
        libraryId,
        assetId: asset.assetId,
        kind: "webm_proxy",
      });
      if (!result.ok)
        setError(
          requestFailureMessage(t("preview.proxyFailed"), result.error, t),
        );
    },
    [api, asset.assetId, libraryId, resolution?.playbackToken, t],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void resolvePreview(), 0);
    return () => window.clearTimeout(timer);
  }, [resolvePreview]);

  useEffect(
    () =>
      api.onThumbnailEvent((event) => {
        if (event.libraryId === libraryId && event.assetId === asset.assetId) {
          void resolvePreview(true);
        }
      }),
    [api, asset.assetId, libraryId, resolvePreview],
  );

  useEffect(() => {
    resolutionRef.current = resolution;
  }, [resolution]);

  useEffect(() => {
    directApprovedRef.current = directApproved;
  }, [directApproved]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      if (
        !shouldContinuePreviewPolling(
          resolutionRef.current,
          directApprovedRef.current,
        )
      ) {
        return;
      }
      await resolvePreview(true);
      if (
        !cancelled &&
        shouldContinuePreviewPolling(
          resolutionRef.current,
          directApprovedRef.current,
        )
      ) {
        timer = window.setTimeout(() => void poll(), 1_500);
      }
    };
    timer = window.setTimeout(() => void poll(), 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resolvePreview]);

  useEffect(
    () => () => {
      requestSequence.current += 1;
    },
    [],
  );

  useEffect(() => {
    modalRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (
      resolution?.mediaType !== "video" ||
      resolution.playbackMode !== "source" ||
      !resolution.url
    ) {
      return;
    }
    if (
      !resolution.sourceContainer ||
      !resolution.sourceMimeType ||
      !resolution.sourceCodecs
    ) {
      return;
    }
    let cancelled = false;
    const descriptor: DirectPlayMediaDescriptor = {
      container: resolution.sourceContainer,
      mimeType: resolution.sourceMimeType,
      codecs: resolution.sourceCodecs,
    };
    void directPlaybackCapability
      .decide(descriptor, resolution.url)
      .then((decision) => {
        if (cancelled) return;
        if (decision.mode === "direct") setDirectApproved(true);
        else void ensureProxyFallback(`VIDEO_${decision.reason.toUpperCase()}`);
      });
    return () => {
      cancelled = true;
    };
  }, [
    ensureProxyFallback,
    resolution?.playbackMode,
    resolution?.mediaType,
    resolution?.sourceCodecs,
    resolution?.sourceContainer,
    resolution?.sourceMimeType,
    resolution?.url,
  ]);

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const result = await api.retryArtifact({
        libraryId,
        assetId: asset.assetId,
        kind:
          resolution?.kind ??
          (asset.mediaType === "video" ? "webm_proxy" : "thumbnail"),
      });
      if (!result.ok) {
        setError(
          requestFailureMessage(t("preview.retryFailed"), result.error, t),
        );
      } else {
        await resolvePreview(false);
      }
    } catch {
      setError(t("preview.retryFailedNoResponse"));
    } finally {
      setRetrying(false);
    }
  }

  async function enterFullscreen() {
    const refreshed = await resolvePreview(true, "fullscreen");
    if (!refreshed?.ok || !modalRef.current) return;
    try {
      await modalRef.current.requestFullscreen();
    } catch (caught) {
      const errorCode =
        caught instanceof Error && caught.name
          ? `FULLSCREEN_${caught.name}`
          : "FULLSCREEN_FAILED";
      setError(t("preview.fullscreenFailed"));
      const detail = safeRendererDiagnostic(
        caught instanceof Error ? caught.message : String(caught),
      );
      await api
        .reportPreviewError({
          libraryId,
          assetId: asset.assetId,
          errorCode,
          detail,
        })
        .catch(() => undefined);
    }
  }

  function handlePlaybackError(event: SyntheticEvent<HTMLVideoElement>) {
    const mediaError = event.currentTarget.error;
    const errorCode = mediaError
      ? `VIDEO_MEDIA_ERR_${mediaError.code}`
      : "VIDEO_PLAYBACK_FAILED";
    if (resolution?.playbackMode === "source") {
      void ensureProxyFallback(errorCode);
      return;
    }
    setError(t("preview.videoFailed", { code: errorCode }));
    const detail = safeRendererDiagnostic(
      mediaError?.message ??
        "HTMLVideoElement emitted an error without MediaError details.",
    );
    void api
      .reportPreviewError({
        libraryId,
        assetId: asset.assetId,
        errorCode,
        detail,
      })
      .catch(() => undefined);
  }

  const ready =
    resolution?.status === "ready" &&
    resolution.url &&
    (resolution.playbackMode !== "source" || directApproved);
  const unsupported =
    resolution?.mediaType === "other" ||
    resolution?.errorCode === "UNSUPPORTED_FORMAT";

  async function openExternal() {
    const result = await api.openExternal({
      libraryId,
      assetId: asset.assetId,
    });
    if (!result.ok)
      setError(
        requestFailureMessage(
          t("preview.cannotOpenExternal"),
          result.error,
          t,
        ),
      );
  }

  return (
    <section
      aria-label={t("preview.viewPage", { name: asset.displayName })}
      className="workspace-viewer"
      ref={modalRef}
      role="region"
      tabIndex={-1}
    >
      <div className="preview-modal">
        <div className="preview-toolbar">
          <div>
            {/* REQ-VIEW-001: no redundant media-type caption under the name
                (the old 图像预览/视频预览 subtitle was pure noise). */}
            <strong>{asset.displayName}</strong>
          </div>
          <div className="preview-toolbar-actions">
            <button
              aria-label={t("preview.previous")}
              title={t("preview.previous")}
              disabled={!onPrevious}
              onClick={onPrevious}
              type="button"
            >
              ←
            </button>
            <button
              aria-label={t("preview.next")}
              title={t("preview.next")}
              disabled={!onNext}
              onClick={onNext}
              type="button"
            >
              →
            </button>
            <button
              disabled={!ready}
              onClick={() => void enterFullscreen()}
              type="button"
            >
              {t("preview.fullscreen")}
            </button>
            <button
              aria-label={t("preview.closeViewer")}
              title={t("preview.closeViewer")}
              onClick={onClose}
              type="button"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
        <div className="preview-content">
          {loading ? (
            <div className="preview-state" role="status">
              <span className="activity-pulse" />
              {t("preview.resolving")}
            </div>
          ) : ready && resolution.mediaType === "video" ? (
            <div className="preview-video-stage">
              <video
                autoPlay
                className="preview-video"
                controls
                onError={handlePlaybackError}
                onLoadedMetadata={() => {
                  setDirectApproved(true);
                  if (videoRef.current)
                    videoRef.current.playbackRate = playbackRate;
                }}
                poster={resolution.posterUrl}
                preload="metadata"
                ref={videoRef}
                src={resolution.url}
              >
                {t("preview.videoUnsupported")}
              </video>
              <label className="preview-speed-control">
                {t("preview.playbackRate")}
                <select
                  aria-label={t("preview.playbackRateAria")}
                  onChange={(event) => {
                    const rate = Number(event.target.value);
                    setPlaybackRate(rate);
                    if (videoRef.current) videoRef.current.playbackRate = rate;
                  }}
                  value={playbackRate}
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}×
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : ready ? (
            <ZoomableImage
              alt={asset.displayName}
              key={asset.assetId}
              src={resolution.url!}
            />
          ) : unsupported ? (
            <div className="preview-state" role="status">
              <strong>{t("preview.unsupportedTitle")}</strong>
              <p>
                {t("preview.unsupportedFormat")} {t("preview.openWithSystem")}
              </p>
              <button onClick={() => void openExternal()} type="button">
                {t("preview.openExternal")}
              </button>
            </div>
          ) : (
            <div
              className={`preview-state${resolution?.status === "failed" || error ? " is-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              <strong>
                {resolution?.status === "pending"
                  ? t("preview.generating")
                  : t("preview.unavailable")}
              </strong>
              <p>
                {error ??
                  (resolution
                    ? previewFailureMessage(resolution, t)
                    : t("preview.statusReadFailed"))}
              </p>
              {resolution?.status !== "pending" && (
                <button
                  disabled={retrying}
                  onClick={() => void retry()}
                  type="button"
                >
                  {retrying
                    ? t("preview.retrying")
                    : t("preview.retryGenerate")}
                </button>
              )}
            </div>
          )}
          {error && ready && (
            <div className="preview-playback-error" role="alert">
              <span>{error}</span>
              {!unsupported && (
                <button
                  disabled={retrying}
                  onClick={() => void retry()}
                  type="button"
                >
                  {t("preview.retryGenerate")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
