import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
} from "react";

import type { AssetSummary } from "../shared/asset-types";
import type {
  PreviewResolution,
  SerpentLibraryApi,
} from "../shared/library-api";
import type { SerpentPluginManagerApi } from "../shared/plugin-manager-api";
import { createPluginMenuContributionContext } from "./plugin-contribution-context";
import { buildPluginViewerState } from "./plugin-context-state";
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
import type { ViewerChromeActivitySource } from "./viewer-chrome-idle";
import { resolveViewerPrimarySurface } from "./viewer-preview-policy";
import {
  resolveViewerPlaceholderUrl,
} from "./viewer-mip-upgrade";
import { isTransientMediaPlaybackError } from "./media-seek-session";
import { VideoPlayerControls } from "./VideoPlayerControls";
import { AudioPlayerControls } from "./AudioPlayerControls";
import { TextViewerControls, type TextViewerControlsHandle } from "./TextViewerControls";
import { useViewerVolume } from "./use-viewer-volume";
import { ZoomableImage } from "./zoomable-preview-image";
import { detectPbrTextureChannel } from "./pbr-texture-channel";
import { useViewerChromeContrast } from "./use-viewer-chrome-contrast";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";
import { ImageSequencePlayer } from "./ImageSequencePlayer";
import {
  ViewerContextMenu,
  type ViewerContextMenuPosition,
} from "./ViewerContextMenu";
import {
  applyViewerDisplayTransformAction,
  IDENTITY_VIEWER_DISPLAY_TRANSFORM,
  type ViewerDisplayTransform,
} from "./viewer-display-transform";
import { PluginViewerActionButtons } from "./plugin-viewer-actions";
import { PluginViewerOverlays } from "./plugin-viewer-overlays";
import { ShellSurface, ViewerSurface } from "./ui/surfaces";
import { ModelViewerSurface } from "./3d-viewer/viewer-surface";

interface AssetPreviewModalProps {
  api: SerpentLibraryApi;
  asset: AssetSummary;
  /** Owned by a parent that survives per-asset remounts (Serpent-ayf). */
  chromeIdle: boolean;
  libraryId: string;
  onChromeActivity: (source: ViewerChromeActivitySource) => void;
  onSetColorSpace?: (assetId: string, colorSpace: string | null) => void;
  onClose(): void;
  onNext?: () => void;
  onPrevious?: () => void;
  /** Shell Info stack for 3D non-blocking notices (MODEL-004). */
  onInfoNotice?: (message: string) => void;
  pluginApi?: SerpentPluginManagerApi;
  pluginContributionRefreshKey?: string | null;
}

export type AssetPreviewModalHandle = {
  /** Flush text edits (and create a revision if the session changed) then close. */
  requestClose: () => Promise<void>;
};

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

export const AssetPreviewModal = forwardRef<
  AssetPreviewModalHandle,
  AssetPreviewModalProps
>(function AssetPreviewModal(
  {
    api,
    asset,
    chromeIdle,
    libraryId,
    onChromeActivity,
    onSetColorSpace,
    onClose,
    onNext,
    onPrevious,
    onInfoNotice,
    pluginApi,
    pluginContributionRefreshKey = null,
  },
  ref,
) {
  const t = useT();
  const modalRef = useRef<HTMLElement>(null);
  const requestSequence = useRef(0);
  const [resolution, setResolution] = useState<PreviewResolution | null>(null);
  const chromeContrast = useViewerChromeContrast(
    modalRef,
    `${asset.assetId}:${resolution?.url ?? ""}:${resolution?.posterUrl ?? ""}`,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pluginContributionContext = useMemo(() => createPluginMenuContributionContext({
    descriptor: {
      type: "asset",
      assetId: asset.assetId,
      displayName: asset.displayName,
      locationKind: asset.locationKind,
      isAvailable: asset.availability === "available",
      isDeleted: asset.deletedAt !== null,
    },
    assets: [asset],
    libraryId,
    viewer: buildPluginViewerState(asset, isFullscreen),
  }), [asset, isFullscreen, libraryId]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [selectedExrPlane, setSelectedExrPlane] = useState(0);
  const [selectedColorSpace, setSelectedColorSpace] = useState<string | undefined>();
  const [directApproved, setDirectApproved] = useState(false);
  const [displayTransform, setDisplayTransform] =
    useState<ViewerDisplayTransform>(IDENTITY_VIEWER_DISPLAY_TRANSFORM);
  const [viewerContextMenu, setViewerContextMenu] =
    useState<ViewerContextMenuPosition | null>(null);
  const [fitRequestToken, setFitRequestToken] = useState(0);
  const resolutionRef = useRef<PreviewResolution | null>(null);
  const directApprovedRef = useRef(false);
  const directGateIdentityRef = useRef<string | null>(null);
  const textViewerRef = useRef<TextViewerControlsHandle>(null);
  const {
    volume: viewerVolume,
    muted: viewerMuted,
    setVolume: setViewerVolume,
    setMuted: setViewerMuted,
  } = useViewerVolume(
    resolution?.mediaType === "video" || resolution?.mediaType === "audio",
  );

  const resolvePreview = useCallback(
    async (
      quiet = false,
      mode: "client" | "fullscreen" = "client",
      exrPlane = selectedExrPlane,
      colorSpace = selectedColorSpace,
    ) => {
      const sequence = ++requestSequence.current;
      if (!quiet) setLoading(true);
      try {
        const result = await api.requestPreview({
          libraryId,
          assetId: asset.assetId,
          mode,
          // The double-click viewer always plays the ORIGINAL source
          // (REQ-VIEW-002); proxies are for hover previews only.
          intent: "viewer",
          ...(asset.mediaType === "image" ? { exrPlane } : {}),
          ...(colorSpace ? { colorSpace } : {}),
        });
        if (sequence !== requestSequence.current) return result;
        if (!result.ok) {
          setError(
            requestFailureMessage(t("preview.cannotOpen"), result.error, t),
          );
        } else {
          setResolution((previous) => {
            // A derivative refresh may temporarily return pending without a
            // URL. Keep the currently decoded media mounted until the
            // replacement is ready; otherwise the viewer flashes its
            // missing/unavailable state for the duration of the request.
            if (
              previous?.url &&
              !result.value.url &&
              result.value.status === "pending"
            ) {
              return {
                ...previous,
                ...(result.value.colorSpace
                  ? { colorSpace: result.value.colorSpace }
                  : {}),
              };
            }
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
    [api, asset.assetId, asset.mediaType, libraryId, selectedColorSpace, selectedExrPlane, t],
  );

  useEffect(() => {
    setSelectedExrPlane(0);
    setSelectedColorSpace(undefined);
    setDisplayTransform(IDENTITY_VIEWER_DISPLAY_TRANSFORM);
  }, [asset.assetId]);

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
          (asset.mediaType === "video"
            ? "webm_proxy"
            : asset.mediaType === "audio"
              ? "audio_proxy"
              : "thumbnail"),
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

  function selectExrPlane(event: ChangeEvent<HTMLSelectElement>) {
    const plane = Number(event.currentTarget.value);
    if (!Number.isSafeInteger(plane) || plane < 0) return;
    setSelectedExrPlane(plane);
    void resolvePreview(false, "client", plane);
  }

  function selectColorSpace(value: string) {
    const colorSpace = value.trim();
    if (!colorSpace) return;
    setSelectedColorSpace(colorSpace);
    onSetColorSpace?.(asset.assetId, colorSpace);
    void resolvePreview(false, "client", selectedExrPlane, colorSpace);
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        setError(t("preview.fullscreenFailed"));
      }
      return;
    }
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

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === modalRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    onFullscreenChange();
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  function handlePlaybackError(event: SyntheticEvent<HTMLMediaElement>) {
    const mediaError = event.currentTarget.error;
    // Seek/scrub cancels in-flight Range fetches; Chromium reports ABORTED.
    // Do not paint a fatal overlay or kick proxy generation for that race.
    if (isTransientMediaPlaybackError(mediaError)) {
      return;
    }
    const isAudio = resolution?.mediaType === "audio";
    const errorCode = mediaError
      ? `${isAudio ? "AUDIO" : "VIDEO"}_MEDIA_ERR_${mediaError.code}`
      : isAudio
        ? "AUDIO_PLAYBACK_FAILED"
        : "VIDEO_PLAYBACK_FAILED";
    const detail = safeRendererDiagnostic(
      mediaError?.message ??
        "HTMLMediaElement emitted an error without MediaError details.",
    );
    if (isAudio) {
      setError(
        previewErrorDetail(resolution?.errorCode, t) ??
          t("preview.audioFailed", { code: errorCode }),
      );
      void api
        .reportPreviewError({
          libraryId,
          assetId: asset.assetId,
          errorCode,
          detail,
        })
        .catch(() => undefined);
      return;
    }
    // Proxy only for codec/container failure — not MEDIA_ERR_NETWORK (2), which
    // commonly appears when a Range fetch is cancelled during scrub.
    const shouldProxyFallback =
      resolution?.playbackMode === "source" &&
      mediaError != null &&
      (mediaError.code === 3 || mediaError.code === 4);
    if (shouldProxyFallback) {
      setError(
        previewErrorDetail(resolution.errorCode, t) ??
          t("preview.videoFailed", { code: errorCode }),
      );
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

  const placeholderUrl = resolveViewerPlaceholderUrl(asset, libraryId);
  const primarySurface = resolveViewerPrimarySurface({
    loading,
    resolution,
    directApproved,
    // Optimistic: source URL presents without waiting on the capability gate.
    requireDirectApproval: false,
    hasPlaceholder: Boolean(placeholderUrl),
  });
  const ready = primarySurface === "media";
  const unsupported = primarySurface === "unsupported";
  const imageSrc = resolution?.url ?? placeholderUrl;
  const pbrChannel =
    asset.mediaType === "image"
      ? detectPbrTextureChannel(asset.displayName)
      : null;
  const showImage =
    asset.mediaType === "image" &&
    Boolean(imageSrc) &&
    (ready || Boolean(placeholderUrl));
  const isTextViewer = ready && resolution?.mediaType === "text";
  const viewerTransformable =
    Boolean(asset.sequence) ||
    asset.mediaType === "image" ||
    asset.mediaType === "video";
  const fitShortcut = viewerTransformable ? "Numpad ." : undefined;

  const rotateViewer = useCallback(() => {
    setDisplayTransform((current) =>
      applyViewerDisplayTransformAction(current, "rotate-clockwise"),
    );
  }, []);
  const flipViewerHorizontal = useCallback(() => {
    setDisplayTransform((current) =>
      applyViewerDisplayTransformAction(current, "flip-horizontal"),
    );
  }, []);
  const flipViewerVertical = useCallback(() => {
    setDisplayTransform((current) =>
      applyViewerDisplayTransformAction(current, "flip-vertical"),
    );
  }, []);
  const fitViewer = useCallback(() => {
    setFitRequestToken((current) => current + 1);
  }, []);
  const closeViewerContextMenu = useCallback(() => {
    setViewerContextMenu(null);
  }, []);

  const handleTextSave = useCallback(async () => {
    await textViewerRef.current?.save();
  }, []);

  const requestClose = useCallback(async () => {
    if (textViewerRef.current) {
      const ok = await textViewerRef.current.flushBeforeClose();
      if (!ok) return;
    }
    onClose();
  }, [onClose]);

  useImperativeHandle(ref, () => ({ requestClose }), [requestClose]);

  useEffect(() => {
    if (!isTextViewer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleTextSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTextSave, isTextViewer]);

  useEffect(() => {
    setViewerContextMenu(null);
  }, [asset.assetId]);

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
    <ViewerSurface
      aria-label={t("preview.viewPage", { name: asset.displayName })}
      className={`workspace-viewer${chromeIdle ? " is-chrome-idle" : ""}${isTextViewer ? " is-text-viewer" : ""}`}
      onContextMenu={(event) => {
        if (!viewerTransformable) return;
        event.preventDefault();
        event.stopPropagation();
        onChromeActivity("pointerdownOrClick");
        setViewerContextMenu({ x: event.clientX, y: event.clientY });
      }}
      onPointerDown={() => onChromeActivity("pointerdownOrClick")}
      onPointerMove={() => onChromeActivity("pointermove")}
      ref={modalRef}
      role="region"
      tabIndex={-1}
    >
      <ShellSurface className="preview-modal">
        {/* REQ-VIEW-006: no top filename/toolbar bar; nav sits on the edges. */}
        <div className={`preview-content${isTextViewer ? " is-text-mode" : ""}`}>
          {primarySurface === "loading" && !placeholderUrl ? (
            <div
              aria-busy="true"
              aria-label={t("preview.resolving")}
              className="preview-state is-silent"
              role="status"
            />
          ) : asset.sequence ? (
            <ImageSequencePlayer
              api={api}
              displayTransform={displayTransform}
              fitRequestToken={fitRequestToken}
              isFullscreen={isFullscreen}
              libraryId={libraryId}
              onFullscreen={() => void toggleFullscreen()}
              onRotate={rotateViewer}
              onSwipeNext={onNext}
              onSwipePrevious={onPrevious}
              sequence={asset.sequence}
            />
          ) : ready && resolution?.mediaType === "video" && resolution.url ? (
            <VideoPlayerControls
              displayTransform={displayTransform}
              fitRequestToken={fitRequestToken}
              isFullscreen={isFullscreen}
              muted={viewerMuted}
              onError={handlePlaybackError}
              onFullscreen={() => void toggleFullscreen()}
              onMutedChange={setViewerMuted}
              onReady={() => setDirectApproved(true)}
              onRotate={rotateViewer}
              onSwipeNext={onNext}
              onSwipePrevious={onPrevious}
              onUserActivity={() => onChromeActivity("pointerdownOrClick")}
              onVolumeChange={setViewerVolume}
              posterUrl={resolution.posterUrl}
              src={resolution.url}
              volume={viewerVolume}
            />
          ) : ready && resolution?.mediaType === "audio" && resolution.url ? (
            <AudioPlayerControls
              key={resolution.url}
              muted={viewerMuted}
              onError={handlePlaybackError}
              onMutedChange={setViewerMuted}
              onReady={() => setDirectApproved(true)}
              onUserActivity={() => onChromeActivity("pointerdownOrClick")}
              onVolumeChange={setViewerVolume}
              src={resolution.url}
              volume={viewerVolume}
              waveformUrl={resolution.posterUrl}
            />
          ) : ready && resolution?.mediaType === "model" && resolution.url ? (
            // Slice C (Serpent-qvc6): the 3D viewport surface. Keyed so a
            // navigation to another asset remounts the WebGL session cleanly
            // (the modal itself is already keyed by assetId in App.tsx).
            <ModelViewerSurface
              api={api}
              asset={asset}
              isFullscreen={isFullscreen}
              key={`${libraryId}:${asset.assetId}`}
              libraryId={libraryId}
              onFullscreen={() => void toggleFullscreen()}
              onInfoNotice={onInfoNotice}
              sourceUrl={resolution.url}
            />
          ) : ready && resolution?.mediaType === "text" ? (
            <TextViewerControls
              key={`${libraryId}:${asset.assetId}`}
              ref={textViewerRef}
              api={api}
              assetId={asset.assetId}
              libraryId={libraryId}
              onClose={onClose}
              onSaved={() => setDirectApproved(true)}
            />
          ) : showImage && imageSrc ? (
            <ZoomableImage
              alt={asset.displayName}
              displayTransform={displayTransform}
              fitRequestToken={fitRequestToken}
              colorSpaceOptions={resolution?.colorSpace?.options}
              colorSpaceValue={
                selectedColorSpace ?? resolution?.colorSpace?.id
              }
              isFullscreen={isFullscreen}
              key={asset.assetId}
              onColorSpaceChange={selectColorSpace}
              onFullscreen={() => void toggleFullscreen()}
              onRotate={rotateViewer}
              onSwipeNext={onNext}
              onSwipePrevious={onPrevious}
              pbrChannel={pbrChannel}
              placeholderSrc={placeholderUrl ?? undefined}
              src={imageSrc}
            />
          ) : unsupported ? (            <div className="preview-state" role="status">
              <strong>{t("preview.unsupportedTitle")}</strong>
              <p>
                {t("preview.unsupportedFormat")} {t("preview.openWithSystem")}
              </p>
              <button
                onClick={() => void openExternal()}
                tabIndex={VIEWER_CHROME_TAB_INDEX}
                type="button"
              >
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
                  tabIndex={VIEWER_CHROME_TAB_INDEX}
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
                  tabIndex={VIEWER_CHROME_TAB_INDEX}
                  type="button"
                >
                  {t("preview.retryGenerate")}
                </button>
              )}
            </div>
          )}
          {resolution?.exrPlanes && resolution.exrPlanes.length > 1 ? (
            <label className="preview-exr-plane-selector">
              <span>{t("preview.exrPlane")}</span>
              <select
                aria-label={t("preview.exrPlane")}
                onChange={selectExrPlane}
                tabIndex={VIEWER_CHROME_TAB_INDEX}
                value={resolution.selectedExrPlane ?? selectedExrPlane}
              >
                {resolution.exrPlanes.map((plane) => (
                  <option key={plane.index} value={plane.index}>
                    {plane.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <PluginViewerActionButtons
            assetId={asset.assetId}
            context={pluginContributionContext}
            libraryId={libraryId}
            pluginApi={pluginApi}
            refreshKey={pluginContributionRefreshKey}
          />
          <PluginViewerOverlays
            libraryId={libraryId}
            pluginApi={pluginApi}
            refreshKey={pluginContributionRefreshKey}
          />
          {!isTextViewer ? (
            <>
              <button
                aria-label={t("preview.previous")}
                className={`preview-nav is-prev preview-chrome-fade is-${chromeContrast.prev}`}
                disabled={!onPrevious}
                onClick={onPrevious}
                tabIndex={VIEWER_CHROME_TAB_INDEX}
                type="button"
              >
                <Icon name="chevron-left" size={28} />
              </button>
              <button
                aria-label={t("preview.next")}
                className={`preview-nav is-next preview-chrome-fade is-${chromeContrast.next}`}
                disabled={!onNext}
                onClick={onNext}
                tabIndex={VIEWER_CHROME_TAB_INDEX}
                type="button"
              >
                <Icon name="chevron-right" size={28} />
              </button>
              <button
                aria-label={t("preview.closeViewer")}
                className={`preview-close-chip preview-chrome-fade is-${chromeContrast.close}`}
                onClick={() => void requestClose()}
                tabIndex={VIEWER_CHROME_TAB_INDEX}
                type="button"
              >
                <Icon name="close" size={18} />
              </button>
            </>
          ) : null}
        </div>
        {viewerContextMenu && viewerTransformable ? (
          <ViewerContextMenu
            flipHorizontal={displayTransform.flipHorizontal}
            flipVertical={displayTransform.flipVertical}
            fitShortcut={fitShortcut}
            isFullscreen={isFullscreen}
            onClose={closeViewerContextMenu}
            onFit={fitViewer}
            onFlipHorizontal={flipViewerHorizontal}
            onFlipVertical={flipViewerVertical}
            onFullscreen={() => void toggleFullscreen()}
            onRotate={rotateViewer}
            position={viewerContextMenu}
          />
        ) : null}
      </ShellSurface>
    </ViewerSurface>
  );
});
