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

interface AssetPreviewModalProps {
  api: SerpentLibraryApi;
  asset: AssetSummary;
  libraryId: string;
  onClose(): void;
  onNext?: () => void;
  onPrevious?: () => void;
}

const PREVIEW_ERROR_MESSAGES: Record<string, string> = {
  FFMPEG_REQUIRED:
    "当前安装缺少 FFmpeg，无法生成视频播放代理。请安装或配置 FFmpeg 后重试。",
  OIIO_REQUIRED:
    "当前安装缺少 OpenImageIO，无法解码此图像格式。请安装或配置 oiiotool 后重试。",
  SHARP_UNAVAILABLE: "图像解码组件不可用，无法生成预览。请重新安装应用后重试。",
  MEDIA_PROCESSING_FAILED: "媒体处理失败，源文件可能损坏或编码暂不受支持。",
  UNSUPPORTED_FORMAT: "当前格式暂不支持客户端预览。",
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

function previewFailureMessage(resolution: PreviewResolution): string {
  if (resolution.errorCode) {
    return (
      PREVIEW_ERROR_MESSAGES[resolution.errorCode] ??
      `预览生成失败（错误代码：${resolution.errorCode}）。`
    );
  }
  if (resolution.status === "pending")
    return "预览正在后台生成，完成后会自动显示。";
  return "尚未生成可用预览，可点击重试。";
}

function requestFailureMessage(
  prefix: string,
  error: { message: string; reason?: string },
): string {
  const actionableReason = error.reason
    ? PREVIEW_ERROR_MESSAGES[error.reason]
    : undefined;
  return actionableReason
    ? `${prefix}：${actionableReason}`
    : `${prefix}：${error.message}${error.reason ? `（${error.reason}）` : ""}`;
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
      <div className="preview-zoom-controls" aria-label="图像缩放">
        <button
          aria-label="缩小"
          onClick={() => zoomAtViewportCenter(view.scale / 1.25)}
          type="button"
        >
          −
        </button>
        <button
          aria-label="实际大小"
          onClick={() => setView({ scale: 1, x: 0, y: 0 })}
          type="button"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <button
          aria-label="放大"
          onClick={() => zoomAtViewportCenter(view.scale * 1.25)}
          type="button"
        >
          +
        </button>
        <button onClick={() => setView({ scale: 1, x: 0, y: 0 })} type="button">
          适合窗口
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
  const modalRef = useRef<HTMLElement>(null);
  const requestSequence = useRef(0);
  const [resolution, setResolution] = useState<PreviewResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [directApproved, setDirectApproved] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);

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
          setError(requestFailureMessage("无法打开预览", result.error));
        } else {
          setResolution(result.value);
          setDirectApproved(
            result.value.mediaType !== "video" ||
              result.value.playbackMode !== "source" ||
              !result.value.sourceCodecs?.length,
          );
          setError(null);
        }
        return result;
      } catch {
        if (sequence === requestSequence.current) {
          setError("无法打开预览：桌面服务没有响应，请重试或重新启动应用。");
        }
        return undefined;
      } finally {
        if (!quiet && sequence === requestSequence.current) setLoading(false);
      }
    },
    [api, asset.assetId, libraryId],
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
        setError(requestFailureMessage("无法生成兼容代理", result.error));
    },
    [api, asset.assetId, libraryId, resolution?.playbackToken],
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
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      await resolvePreview(true);
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1_500);
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
        setError(requestFailureMessage("重试失败", result.error));
      } else {
        await resolvePreview(false);
      }
    } catch {
      setError("重试失败：桌面服务没有响应，请重试或重新启动应用。");
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
      setError("无法进入全屏模式，请检查系统窗口权限后重试。");
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
    setError(
      `视频播放失败（错误代码：${errorCode}）。代理文件可能损坏，可重试生成。`,
    );
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
      setError(requestFailureMessage("无法使用外部应用打开", result.error));
  }

  return (
    <section
      aria-label={`${asset.displayName} 查看页面`}
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
              aria-label="查看上一个资产"
              disabled={!onPrevious}
              onClick={onPrevious}
              type="button"
            >
              ←
            </button>
            <button
              aria-label="查看下一个资产"
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
              全屏
            </button>
            <button
              aria-label="关闭查看页面"
              onClick={onClose}
              type="button"
            >
              关闭
            </button>
          </div>
        </div>
        <div className="preview-content">
          {loading ? (
            <div className="preview-state" role="status">
              <span className="activity-pulse" />
              正在解析安全预览…
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
                当前环境不支持视频播放。
              </video>
              <label className="preview-speed-control">
                倍速
                <select
                  aria-label="播放倍速"
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
              <strong>不支持内置预览</strong>
              <p>
                {PREVIEW_ERROR_MESSAGES.UNSUPPORTED_FORMAT}{" "}
                可使用系统默认应用打开源文件。
              </p>
              <button onClick={() => void openExternal()} type="button">
                使用外部应用打开
              </button>
            </div>
          ) : (
            <div
              className={`preview-state${resolution?.status === "failed" || error ? " is-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              <strong>
                {resolution?.status === "pending"
                  ? "正在生成预览"
                  : "预览不可用"}
              </strong>
              <p>
                {error ??
                  (resolution
                    ? previewFailureMessage(resolution)
                    : "无法读取预览状态。")}
              </p>
              {resolution?.status !== "pending" && (
                <button
                  disabled={retrying}
                  onClick={() => void retry()}
                  type="button"
                >
                  {retrying ? "正在重试…" : "重试生成"}
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
                  重试生成
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
