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
import { useT, type TranslateFn } from "./i18n";
import {
  nextDirectApprovedState,
  samePreviewPlayback,
  shouldContinuePreviewPolling,
} from "./preview-poll";
import { waitForMediaArtifactRetry } from "./media-retry";
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
import { PdfViewerSurface } from "./PdfViewerSurface";
import { HtmlViewerSurface } from "./HtmlViewerSurface";
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
import { ProxyPlaybackNotice } from "./ProxyPlaybackNotice";
import { createProxyFallbackRunGuard } from "./proxy-fallback-run";
import { shouldCopyAssetOnShortcut } from "./viewer-copy-shortcut";
import { ShellSurface, ViewerSurface } from "./ui/surfaces";
import { ModelViewerSurface } from "./3d-viewer/viewer-surface";
import { isMacPlatform } from "./commands/command-types";

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
  const [manualRetryError, setManualRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Recreate the HTMLMediaElement after a manual retry. Clearing the playback
  // error alone leaves the failed source mounted, so Chromium may not emit a
  // second error event and the viewer loses its actionable retry surface.
  const [playbackRetryGeneration, setPlaybackRetryGeneration] = useState(0);
  const [selectedExrPlane, setSelectedExrPlane] = useState(0);
  const [selectedColorSpace, setSelectedColorSpace] = useState<string | undefined>();
  const [directApproved, setDirectApproved] = useState(false);
  const [proxyNoticeAvailable, setProxyNoticeAvailable] = useState(false);
  const [proxyNoticeVisible, setProxyNoticeVisible] = useState(false);
  // Serpent-e56a1f: 代理回退的可见状态。生成中/加载中显示普通状态提示
  // （非警告），只有生成失败才显示警告。
  const [proxyFallbackState, setProxyFallbackState] = useState<
    "idle" | "generating" | "loading" | "failed"
  >("idle");
  const [displayTransform, setDisplayTransform] =
    useState<ViewerDisplayTransform>(IDENTITY_VIEWER_DISPLAY_TRANSFORM);
  const [viewerContextMenu, setViewerContextMenu] =
    useState<ViewerContextMenuPosition | null>(null);
  const [fitRequestToken, setFitRequestToken] = useState(0);
  const resolutionRef = useRef<PreviewResolution | null>(null);
  const playbackErrorRef = useRef<string | null>(null);
  const requestedProxyFallbackRef = useRef<string | null>(null);
  // An explicit proxy fallback can outlive the media element that requested
  // it (asset navigation, manual retry, or viewer unmount). Invalidate the
  // run so its polling loop cannot paint an error into a newer viewer.
  const proxyFallbackRunGuardRef = useRef(createProxyFallbackRunGuard());
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
      preserveError = false,
      isCurrentRun?: () => boolean,
    ) => {
      if (isCurrentRun && !isCurrentRun()) return undefined;
      const sequence = ++requestSequence.current;
      if (!quiet) setLoading(true);
      try {
        const result = await api.requestPreview({
          libraryId,
          assetId: asset.assetId,
          mode,
          // Start with the original source. Once the media element reports a
          // real decode failure, switch this same viewer request to the
          // explicit proxy-fallback intent so a ready derivative can replace
          // the failed source without any eager encoding.
          intent: requestedProxyFallbackRef.current
            ? "proxy-fallback"
            : "viewer",
          ...(asset.mediaType === "image" ? { exrPlane } : {}),
          ...(colorSpace ? { colorSpace } : {}),
        });
        if (sequence !== requestSequence.current) return result;
        if (isCurrentRun && !isCurrentRun()) return result;
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
            !preserveError &&
            (!quiet ||
              (result.value.status === "ready" &&
                result.value.playbackMode === "proxy" &&
                result.value.url))
          ) {
              setError(null);
          }
        }
        return result;
      } catch {
        if (
          sequence === requestSequence.current &&
          (!isCurrentRun || isCurrentRun())
        ) {
          setError(t("preview.cannotOpenNoResponse"));
        }
        return undefined;
      } finally {
        if (
          !quiet &&
          sequence === requestSequence.current &&
          (!isCurrentRun || isCurrentRun())
        ) {
          setLoading(false);
        }
      }
    },
    [api, asset.assetId, asset.mediaType, libraryId, selectedColorSpace, selectedExrPlane, t],
  );

  useEffect(() => {
    const runGuard = proxyFallbackRunGuardRef.current;
    runGuard.invalidate();
    setSelectedExrPlane(0);
    setSelectedColorSpace(undefined);
    setDisplayTransform(IDENTITY_VIEWER_DISPLAY_TRANSFORM);
    playbackErrorRef.current = null;
    requestedProxyFallbackRef.current = null;
    setProxyNoticeAvailable(false);
    setProxyNoticeVisible(false);
    setProxyFallbackState("idle");
    setManualRetryError(null);
    return () => {
      runGuard.invalidate();
    };
  }, [asset.assetId]);

  const ensureProxyFallback = useCallback(
    async (errorCode: string) => {
      const playbackToken = resolution?.playbackToken;
      if (!playbackToken || requestedProxyFallbackRef.current === playbackToken) return;
      requestedProxyFallbackRef.current = playbackToken;
      const isCurrentRun = proxyFallbackRunGuardRef.current.begin();
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
      // Serpent-e56a1f: 生成中显示状态提示（非警告），失败才警告。
      setProxyFallbackState("generating");
      const result = await api.retryArtifact({
        libraryId,
        assetId: asset.assetId,
        kind: "webm_proxy",
      });
      if (!isCurrentRun()) return;
      if (!result.ok) {
        setProxyFallbackState("failed");
        setError(
          requestFailureMessage(t("preview.proxyFailed"), result.error, t),
        );
      } else {
        // The pending response intentionally keeps the failed source mounted
        // so the viewer does not flash a blocking generation surface. That
        // also means the normal "direct playback is approved" polling gate
        // may stop before the proxy-ready event arrives. An explicit fallback
        // owns its refresh loop until the ready proxy is observable.
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          if (!isCurrentRun()) return;
          const preview = await resolvePreview(
            true,
            "client",
            selectedExrPlane,
            selectedColorSpace,
            false,
            isCurrentRun,
          );
          if (!isCurrentRun()) return;
          if (
            preview?.ok &&
            preview.value.status === "ready" &&
            preview.value.playbackMode === "proxy" &&
            preview.value.url
          ) {
            // Proxy 已就绪，video 即将重新挂载加载——进入「加载中」状态，
            // onReady 时清除（Serpent-e56a1f）。
            setProxyFallbackState("loading");
            return;
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
        }
        if (!isCurrentRun()) return;
        setProxyFallbackState("failed");
        setError(t("preview.proxyFailed"));
      }
    },
    [
      api,
      asset.assetId,
      libraryId,
      resolution?.playbackToken,
      resolvePreview,
      selectedColorSpace,
      selectedExrPlane,
      t,
    ],
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

  async function retry() {
    proxyFallbackRunGuardRef.current.invalidate();
    requestedProxyFallbackRef.current = null;
    setRetrying(true);
    // Serpent-e56a1f: 手动重试同样进入生成中状态，失败前不显示警告。
    setProxyFallbackState("generating");
    setPlaybackRetryGeneration((generation) => generation + 1);
    // For a source-backed video, keep the existing playback error until
    // `loadedmetadata` gives proof that the recreated media element can play.
    // Clearing it immediately can leave an unplayable source mounted with no
    // second error event on Chromium's custom `serpent://` scheme.
    const retainedPlaybackError =
      playbackErrorRef.current ??
      error ??
      (asset.mediaType === "video"
        ? t("preview.videoFailed", { code: "VIDEO_MEDIA_ERR_4" })
        : null);
    const retainPlaybackError =
      asset.mediaType === "video" && Boolean(resolution?.url);
    if (retainPlaybackError && retainedPlaybackError !== null) {
      setManualRetryError(retainedPlaybackError);
      setError(retainedPlaybackError);
    } else {
      setManualRetryError(null);
      setError(null);
    }
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
        await waitForMediaArtifactRetry({
          api,
          libraryId,
          assetId: asset.assetId,
          artifactKind:
            resolution?.kind ??
            (asset.mediaType === "video"
              ? "webm_proxy"
              : asset.mediaType === "audio"
                ? "audio_proxy"
                : "thumbnail"),
        });
        await resolvePreview(
          false,
          "client",
          selectedExrPlane,
          selectedColorSpace,
          retainPlaybackError,
        );
        if (retainPlaybackError && retainedPlaybackError !== null) {
          setError(retainedPlaybackError);
        }
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
      const message =
        previewErrorDetail(resolution.errorCode, t) ??
        t("preview.videoFailed", { code: errorCode });
      playbackErrorRef.current = message;
      // Serpent-e56a1f: 进入代理生成流程后不再显示「视频无法播放」警告——
      // 由「代理生成中」状态提示替代；无 playbackToken（无法生成代理）时
      // 保留原始错误供用户看到。
      if (resolution?.playbackToken) {
        setError(null);
      } else {
        setError(message);
      }
      void ensureProxyFallback(errorCode);
      return;
    }
    const message = t("preview.videoFailed", { code: errorCode });
    playbackErrorRef.current = message;
    setError(message);
    // 代理本身也播放失败：从「加载中」转入失败态，状态条不再显示
    // （Serpent-e56a1f）。
    setProxyFallbackState("failed");
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
  const viewerError = error ?? manualRetryError;
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
  const isDocumentViewer = ready && resolution?.mediaType === "document";
  const viewerContextMenuAvailable = ready && !isTextViewer;
  const viewerTransformable =
    Boolean(asset.sequence) ||
    asset.mediaType === "image" ||
    asset.mediaType === "video";
  const fitShortcut = viewerTransformable ? "Numpad ." : undefined;
  const copyShortcut = isMacPlatform(navigator.userAgent) ? "⌘C" : "Ctrl+C";

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

  const copyViewerAsset = useCallback(async () => {
    // Serpent-f8e175: 与右键「复制」一致，把当前资产源文件复制到剪贴板。
    const result = await api.copyAssetFiles({
      libraryId,
      assetIds: [asset.assetId],
    });
    if (!result.ok) {
      setError(requestFailureMessage(t("preview.copyFailed"), result.error, t));
    }
    // 成功静默：不打断查看器浏览（复制动作本身即反馈）。
  }, [api, libraryId, asset.assetId, setError, t]);

  useEffect(() => {
    // Serpent-f8e175: 图片/视频/PDF/音频等非文本查看器聚焦时 Ctrl/Cmd+C
    // 复制当前资产；文本查看器让渡给原生（复制选中文本），输入框/可编辑
    // 元素聚焦时不抢键（判定见 shouldCopyAssetOnShortcut）。
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !shouldCopyAssetOnShortcut({
          isTextViewer,
          metaOrCtrl: event.metaKey || event.ctrlKey,
          key: event.key,
          targetTag: target?.tagName ?? null,
          contentEditable: Boolean(target?.isContentEditable),
        })
      ) {
        return;
      }
      event.preventDefault();
      void copyViewerAsset();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isTextViewer, copyViewerAsset]);

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
      className={`workspace-viewer${chromeIdle ? " is-chrome-idle" : ""}${isTextViewer ? " is-text-viewer" : ""}${isDocumentViewer ? " is-document-viewer" : ""}`}
      onContextMenu={(event) => {
        if (!viewerContextMenuAvailable) return;
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
        <div className={`preview-content${isTextViewer ? " is-text-mode" : ""}${isDocumentViewer ? " is-document-mode" : ""}`}>
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
              key={`${asset.assetId}:${resolution.url}:${playbackRetryGeneration}`}
              displayTransform={displayTransform}
              fitRequestToken={fitRequestToken}
              isFullscreen={isFullscreen}
              muted={viewerMuted}
              onError={handlePlaybackError}
              onFullscreen={() => void toggleFullscreen()}
              onMutedChange={setViewerMuted}
              onReady={() => {
                setDirectApproved(true);
                setProxyFallbackState("idle");
                if (
                  resolution?.mediaType === "video" &&
                  resolution.playbackMode === "proxy"
                ) {
                  setProxyNoticeAvailable(true);
                  setProxyNoticeVisible(true);
                }
              }}
              onPlaying={(video) => {
                // An unsupported custom source can emit `play` immediately
                // and only publish MEDIA_ERR_4 later. Poll briefly so an
                // early play event cannot remove the retry surface before the
                // media element settles.
                const startedAt = Date.now();
                const confirmPlayable = () => {
                  if (
                    video.error ||
                    !video.isConnected ||
                    video.readyState < HTMLMediaElement.HAVE_METADATA ||
                    video.videoWidth <= 0 ||
                    video.videoHeight <= 0
                  ) {
                    return;
                  }
                  if (Date.now() - startedAt < 5_000) {
                    window.setTimeout(confirmPlayable, 100);
                    return;
                  }
                  playbackErrorRef.current = null;
                  setManualRetryError(null);
                  setError(null);
                };
                confirmPlayable();
              }}
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
          ) : ready && resolution?.mediaType === "document" && resolution.url ? (
            resolution.sourceMimeType === "application/pdf" ? (
              <PdfViewerSurface
                api={api}
                assetId={asset.assetId}
                isFullscreen={isFullscreen}
                key={`${libraryId}:${asset.assetId}`}
                libraryId={libraryId}
                sourceUrl={resolution.url}
              />
            ) : (
              <HtmlViewerSurface
                isFullscreen={isFullscreen}
                key={`${libraryId}:${asset.assetId}`}
                sourceUrl={resolution.url}
              />
            )
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
              className={`preview-state${primarySurface === "unavailable" || viewerError ? " is-error" : ""}`}
              role={viewerError ? "alert" : "status"}
            >
              <strong>
                {primarySurface === "waiting"
                  ? t("preview.generating")
                  : t("preview.unavailable")}
              </strong>
              <p>
                {viewerError ??
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
          {proxyFallbackState === "generating" ||
          proxyFallbackState === "loading" ? (
            <div className="preview-proxy-status" role="status">
              <span className="activity-pulse" aria-hidden />
              <span>
                {proxyFallbackState === "generating"
                  ? t("preview.proxyGenerating")
                  : t("preview.proxyLoading")}
              </span>
            </div>
          ) : null}
          {proxyNoticeAvailable ? (
            <ProxyPlaybackNotice
              visible={proxyNoticeVisible}
              onHide={() => setProxyNoticeVisible(false)}
              onShow={() => setProxyNoticeVisible(true)}
            />
          ) : null}
          {viewerError && ready && (
            <div className="preview-playback-error" role="alert">
              <span>{viewerError}</span>
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
        {viewerContextMenu && viewerContextMenuAvailable ? (
          <ViewerContextMenu
            copyShortcut={copyShortcut}
            flipHorizontal={displayTransform.flipHorizontal}
            flipVertical={displayTransform.flipVertical}
            fitShortcut={fitShortcut}
            isFullscreen={isFullscreen}
            onCopy={() => void copyViewerAsset()}
            onClose={closeViewerContextMenu}
            onFit={fitViewer}
            onFlipHorizontal={flipViewerHorizontal}
            onFlipVertical={flipViewerVertical}
            onFullscreen={() => void toggleFullscreen()}
            onRotate={rotateViewer}
            position={viewerContextMenu}
            transformable={viewerTransformable}
          />
        ) : null}
      </ShellSurface>
    </ViewerSurface>
  );
});
