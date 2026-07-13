import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';

import type { AssetSummary } from '../shared/asset-types';
import type { PreviewResolution, SerpentLibraryApi } from '../shared/library-api';

interface AssetPreviewModalProps {
  api: SerpentLibraryApi;
  asset: AssetSummary;
  libraryId: string;
  onClose(): void;
}

const PREVIEW_ERROR_MESSAGES: Record<string, string> = {
  FFMPEG_REQUIRED: '当前安装缺少 FFmpeg，无法生成视频播放代理。请安装或配置 FFmpeg 后重试。',
  OIIO_REQUIRED: '当前安装缺少 OpenImageIO，无法解码此图像格式。请安装或配置 oiiotool 后重试。',
  SHARP_UNAVAILABLE: '图像解码组件不可用，无法生成预览。请重新安装应用后重试。',
  MEDIA_PROCESSING_FAILED: '媒体处理失败，源文件可能损坏或编码暂不受支持。',
  UNSUPPORTED_FORMAT: '当前格式暂不支持客户端预览。',
};

function previewFailureMessage(resolution: PreviewResolution): string {
  if (resolution.errorCode) {
    return PREVIEW_ERROR_MESSAGES[resolution.errorCode]
      ?? `预览生成失败（错误代码：${resolution.errorCode}）。`;
  }
  if (resolution.status === 'pending') return '预览正在后台生成，完成后会自动显示。';
  return '尚未生成可用预览，可点击重试。';
}

function requestFailureMessage(prefix: string, error: { message: string; reason?: string }): string {
  const actionableReason = error.reason ? PREVIEW_ERROR_MESSAGES[error.reason] : undefined;
  return actionableReason
    ? `${prefix}：${actionableReason}`
    : `${prefix}：${error.message}${error.reason ? `（${error.reason}）` : ''}`;
}

function safeRendererDiagnostic(value: string): string {
  const redacted = value.replace(
    /file:\/\/\S+|[A-Za-z]:\\\S+|\/(?:Users|home|Volumes|private|tmp)\/\S+/gu,
    '[redacted-path]',
  );
  return Array.from(redacted, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('')
    .trim()
    .slice(0, 500);
}

export function AssetPreviewModal({ api, asset, libraryId, onClose }: AssetPreviewModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const [resolution, setResolution] = useState<PreviewResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const resolvePreview = useCallback(async (quiet = false, mode: 'client' | 'fullscreen' = 'client') => {
    const sequence = ++requestSequence.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api.requestPreview({ libraryId, assetId: asset.assetId, mode });
      if (sequence !== requestSequence.current) return result;
      if (!result.ok) {
        setError(requestFailureMessage('无法打开预览', result.error));
      } else {
        setResolution(result.value);
        setError(null);
      }
      return result;
    } catch {
      if (sequence === requestSequence.current) {
        setError('无法打开预览：桌面服务没有响应，请重试或重新启动应用。');
      }
      return undefined;
    } finally {
      if (!quiet && sequence === requestSequence.current) setLoading(false);
    }
  }, [api, asset.assetId, libraryId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void resolvePreview(), 0);
    return () => window.clearTimeout(timer);
  }, [resolvePreview]);

  useEffect(() => api.onThumbnailEvent((event) => {
    if (event.libraryId === libraryId && event.assetId === asset.assetId) {
      void resolvePreview(true);
    }
  }), [api, asset.assetId, libraryId, resolvePreview]);

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

  useEffect(() => () => {
    requestSequence.current += 1;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  async function closePreview() {
    try {
      await api.closePreview({ libraryId, assetId: asset.assetId });
    } catch {
      // The local modal can still close if Main is shutting down.
    } finally {
      onClose();
    }
  }

  async function retry() {
    setRetrying(true);
    setError(null);
    try {
      const result = await api.retryArtifact({
        libraryId,
        assetId: asset.assetId,
        kind: resolution?.kind ?? (asset.mediaType === 'video' ? 'webm_proxy' : 'thumbnail'),
      });
      if (!result.ok) {
        setError(requestFailureMessage('重试失败', result.error));
      } else {
        await resolvePreview(false);
      }
    } catch {
      setError('重试失败：桌面服务没有响应，请重试或重新启动应用。');
    } finally {
      setRetrying(false);
    }
  }

  async function enterFullscreen() {
    const refreshed = await resolvePreview(true, 'fullscreen');
    if (!refreshed?.ok || !modalRef.current) return;
    try {
      await modalRef.current.requestFullscreen();
    } catch (caught) {
      const errorCode = caught instanceof Error && caught.name ? `FULLSCREEN_${caught.name}` : 'FULLSCREEN_FAILED';
      setError('无法进入全屏模式，请检查系统窗口权限后重试。');
      const detail = safeRendererDiagnostic(caught instanceof Error ? caught.message : String(caught));
      await api.reportPreviewError({ libraryId, assetId: asset.assetId, errorCode, detail }).catch(() => undefined);
    }
  }

  function handlePlaybackError(event: SyntheticEvent<HTMLVideoElement>) {
    const mediaError = event.currentTarget.error;
    const errorCode = mediaError ? `VIDEO_MEDIA_ERR_${mediaError.code}` : 'VIDEO_PLAYBACK_FAILED';
    setError(`视频播放失败（错误代码：${errorCode}）。代理文件可能损坏，可重试生成。`);
    const detail = safeRendererDiagnostic(mediaError?.message ?? 'HTMLVideoElement emitted an error without MediaError details.');
    void api.reportPreviewError({ libraryId, assetId: asset.assetId, errorCode, detail }).catch(() => undefined);
  }

  const ready = resolution?.status === 'ready' && resolution.url;

  return (
    <div className="dialog-backdrop preview-backdrop" onClick={() => void closePreview()} role="presentation">
      <div
        aria-label={`${asset.displayName} 预览`}
        aria-modal="true"
        className="preview-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
      >
        <div className="preview-toolbar">
          <div><strong>{asset.displayName}</strong><span>{asset.mediaType === 'video' ? '视频代理预览' : '图像预览'}</span></div>
          <div className="preview-toolbar-actions">
            <button disabled={!ready} onClick={() => void enterFullscreen()} type="button">全屏</button>
            <button aria-label="关闭预览" onClick={() => void closePreview()} type="button">关闭</button>
          </div>
        </div>
        <div className="preview-content">
          {loading ? (
            <div className="preview-state" role="status"><span className="activity-pulse" />正在解析安全预览…</div>
          ) : ready && resolution.mediaType === 'video' ? (
            <video
              autoPlay
              className="preview-video"
              controls
              onError={handlePlaybackError}
              poster={resolution.posterUrl}
              preload="metadata"
              src={resolution.url}
            >
              当前环境不支持视频播放。
            </video>
          ) : ready ? (
            <img alt={asset.displayName} className="preview-image" src={resolution.url} />
          ) : (
            <div className={`preview-state${resolution?.status === 'failed' || error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>
              <strong>{resolution?.status === 'pending' ? '正在生成预览' : '预览不可用'}</strong>
              <p>{error ?? (resolution ? previewFailureMessage(resolution) : '无法读取预览状态。')}</p>
              {resolution?.status !== 'pending' && <button disabled={retrying} onClick={() => void retry()} type="button">{retrying ? '正在重试…' : '重试生成'}</button>}
            </div>
          )}
          {error && ready && <div className="preview-playback-error" role="alert"><span>{error}</span><button disabled={retrying} onClick={() => void retry()} type="button">重试生成</button></div>}
        </div>
      </div>
    </div>
  );
}
