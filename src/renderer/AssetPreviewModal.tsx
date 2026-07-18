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
import { Icon } from "./Icons";
import { useViewerChromeIdle } from "./use-viewer-chrome-idle";
import { resolveViewerPrimarySurface } from "./viewer-preview-policy";
import { VideoPlayerControls } from "./VideoPlayerControls";
import { GifPlayerControls } from "./GifPlayerControls";
import { isGifDisplayName } from "./gif-player-controls";
import { ZoomableImage } from "./zoomable-preview-image";

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
  const { idle: chromeIdle, onPointerActivity } = useViewerChromeIdle();
  const requestSequence = useRef(0);
  const [resolution, setResolution] = useState<PreviewResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [directApproved, setDirectApproved] = useState(false);
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
          // Quiet polls must not clear a source-playback error while proxy is
          // still generating; clear once we upgrade to a ready proxy URL.
          if (
            !quiet ||
            (result.value.status === "ready" &&
              result.value.playbackMode === "proxy" &&
              result.value.url)
          ) {
            setError(null);
          }
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
      // REQ-VIEW-002: keep the current source/URL mounted. Proxy generation is a
      // quiet background upgrade — do not wipe into a blocking "generating" gate.
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
        // Always present the source URL immediately (REQ-VIEW-002). Capability is
        // used to pre-warm proxy when Chromium is unlikely to play the source.
        setDirectApproved(true);
        if (decision.mode === "proxy") {
          void ensureProxyFallback(`VIDEO_${decision.reason.toUpperCase()}`);
        }
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
    const detail = safeRendererDiagnostic(
      mediaError?.message ??
        "HTMLVideoElement emitted an error without MediaError details.",
    );
    if (resolution?.playbackMode === "source") {
      setError(t("preview.videoFailed", { code: errorCode }));
      void ensureProxyFallback(errorCode);
      return;
    }
    setError(t("preview.videoFailed", { code: errorCode }));
    void api
      .reportPreviewError({
        libraryId,
        assetId: asset.assetId,
        errorCode,
        detail,
      })
      .catch(() => undefined);
  }

  const primarySurface = resolveViewerPrimarySurface({
    loading,
    resolution,
    directApproved,
    // Optimistic: source URL presents without waiting on the capability gate.
    requireDirectApproval: false,
  });
  const ready = primarySurface === "media";
  const unsupported = primarySurface === "unsupported";

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
      className={`workspace-viewer${chromeIdle ? " is-chrome-idle" : ""}`}
      onPointerDown={onPointerActivity}
      onPointerMove={onPointerActivity}
      ref={modalRef}
      role="region"
      tabIndex={-1}
    >
      <div className="preview-modal">
        {/* REQ-VIEW-006: no top filename/toolbar bar; nav sits on the edges. */}
        <div className="preview-content">
          {primarySurface === "loading" ? (
            <div className="preview-state" role="status">
              <span className="activity-pulse" />
              {t("preview.resolving")}
            </div>
          ) : ready && resolution?.mediaType === "video" && resolution.url ? (
            <VideoPlayerControls
              onError={handlePlaybackError}
              onFullscreen={() => void enterFullscreen()}
              onReady={() => setDirectApproved(true)}
              posterUrl={resolution.posterUrl}
              src={resolution.url}
            />
          ) : ready &&
            resolution?.url &&
            isGifDisplayName(asset.displayName) ? (
            <GifPlayerControls
              alt={asset.displayName}
              key={resolution.url}
              onFullscreen={() => void enterFullscreen()}
              onSwipeNext={onNext}
              onSwipePrevious={onPrevious}
              src={resolution.url}
            />
          ) : ready && resolution?.url ? (
            <ZoomableImage
              alt={asset.displayName}
              key={asset.assetId}
              onFullscreen={() => void enterFullscreen()}
              onSwipeNext={onNext}
              onSwipePrevious={onPrevious}
              src={resolution.url}
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
              className={`preview-state${primarySurface === "unavailable" || error ? " is-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              <strong>
                {primarySurface === "waiting"
                  ? t("preview.generating")
                  : t("preview.unavailable")}
              </strong>
              <p>
                {error ??
                  (resolution
                    ? previewFailureMessage(resolution, t)
                    : t("preview.statusReadFailed"))}
              </p>
              {primarySurface !== "waiting" && (
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
          <button
            aria-label={t("preview.previous")}
            className="preview-nav is-prev preview-chrome-fade"
            disabled={!onPrevious}
            onClick={onPrevious}
            type="button"
          >
            <Icon name="chevron-left" size={28} />
          </button>
          <button
            aria-label={t("preview.next")}
            className="preview-nav is-next preview-chrome-fade"
            disabled={!onNext}
            onClick={onNext}
            type="button"
          >
            <Icon name="chevron-right" size={28} />
          </button>
          <button
            aria-label={t("preview.closeViewer")}
            className="preview-close-chip preview-chrome-fade"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      </div>
    </section>
  );
}
