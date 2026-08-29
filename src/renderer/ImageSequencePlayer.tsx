import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ImageSequenceSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import { iconActionAttrs } from "./icon-action-attrs";
import { Icon } from "./Icons";
import { useT } from "./i18n";
import { SequenceFrameCanvas } from "./SequenceFrameCanvas";
import { Slider } from "./ui/primitives";
import { advanceImageSequenceFrame } from "./image-sequence-playback";
import type { ViewerDisplayTransform } from "./viewer-display-transform";
import { ZoomableImage } from "./zoomable-preview-image";
import { resolveSequenceFrameUrl } from "./sequence-frame-preview";

export interface ImageSequencePlayerProps {
  api: SerpentLibraryApi;
  displayTransform: ViewerDisplayTransform;
  isFullscreen: boolean;
  /** Keep preloaded navigation surfaces from capturing global shortcuts. */
  keyboardShortcutsDisabled?: boolean;
  /** Preloaded navigation surfaces must not start sequence playback. */
  preloadOnly?: boolean;
  libraryId: string;
  onFullscreen(): void;
  onPresentationReady?: () => void;
  onRotate?(): void;
  fitRequestToken?: number;
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
  sequence: ImageSequenceSummary;
}

/**
 * Sequence viewer: play from decoded thumbnails on a canvas. Pause/scrub may
 * request client preview for the current frame. Space toggles playback
 * (capture phase so it wins over parent keybinds).
 */
export function ImageSequencePlayer({
  api,
  displayTransform,
  isFullscreen,
  keyboardShortcutsDisabled = false,
  libraryId,
  onFullscreen,
  onPresentationReady,
  onRotate,
  fitRequestToken,
  onSwipeNext,
  onSwipePrevious,
  preloadOnly = false,
  sequence,
}: ImageSequencePlayerProps) {
  const t = useT();
  const thumbnailUrls = useMemo(
    () =>
      sequence.frames.map((frame) => resolveSequenceFrameUrl(libraryId, frame)),
    [libraryId, sequence.frames],
  );
  const [resolvedUrls, setResolvedUrls] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [frameIndex, setFrameIndex] = useState(0);
  // Keep the user's playback choice across a preload → visible promotion.
  // `isPlaying` masks the state while hidden, so a promoted sequence starts
  // with the same autoplay behavior as a directly opened sequence.
  const [playing, setPlaying] = useState(true);
  const isPlaying = !preloadOnly && playing;
  const playingRef = useRef(isPlaying);
  const [frameErrorAssetId, setFrameErrorAssetId] = useState<string | null>(null);

  useEffect(() => {
    // A preloaded surface must be paused immediately after its prop changes.
    // This ref only serves imperative interval/key handling and is not render
    // state, so syncing it here avoids a cascading state update.
    playingRef.current = isPlaying;
  }, [isPlaying]);

  const setPlayback = (nextPlaying: boolean) => {
    // Keep the imperative guard in sync before React processes the state
    // update. Otherwise a playback interval can win a race with a keyboard
    // slider event (Home/ArrowRight) and advance one extra frame.
    playingRef.current = nextPlaying;
    setPlaying(nextPlaying);
  };

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(
      () => {
        setFrameIndex((current) => {
          // The callback may already be queued when the user pauses or
          // scrubs. Re-check the ref inside the updater so that stale ticks
          // cannot apply after the slider has selected a frame.
          if (!playingRef.current) return current;
          return advanceImageSequenceFrame(
            current,
            sequence.frames.length,
            playingRef.current,
          );
        });
      },
      1000 / Math.max(1, sequence.fps),
    );
    return () => window.clearInterval(timer);
  }, [isPlaying, sequence.fps, sequence.frames.length]);

  const currentFrame = sequence.frames[frameIndex]!;

  const reportFrameError = useCallback(() => {
    setFrameErrorAssetId(currentFrame.assetId);
    onPresentationReady?.();
  }, [currentFrame.assetId, onPresentationReady]);

  useEffect(() => {
    if (isPlaying) return;
    let cancelled = false;
    void api
      .requestPreview({
        libraryId,
        assetId: currentFrame.assetId,
        mode: "client",
      })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok || !result.value.url) {
          reportFrameError();
          return;
        }
        setResolvedUrls((current) => {
          if (current.has(currentFrame.assetId)) return current;
          const next = new Map(current);
          next.set(currentFrame.assetId, result.value.url!);
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) reportFrameError();
      });
    return () => {
      cancelled = true;
    };
  }, [api, currentFrame.assetId, isPlaying, libraryId, reportFrameError]);

  useEffect(() => {
    if (keyboardShortcutsDisabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.key !== " " && event.code !== "Space") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setPlayback(!playingRef.current);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keyboardShortcutsDisabled]);

  const pausedUrl =
    resolvedUrls.get(currentFrame.assetId) ??
    thumbnailUrls[frameIndex] ??
    thumbnailUrls.find((url): url is string => Boolean(url)) ??
    null;

  return (
    <div className="preview-sequence-stage">
      {frameErrorAssetId === currentFrame.assetId ? (
        <div className="preview-state is-error" role="alert">
          <strong>{t("preview.unavailable")}</strong>
          <p>{t("preview.statusReadFailed")}</p>
        </div>
      ) : isPlaying ? (
        <div className="preview-sequence-play-stage">
          {thumbnailUrls.some(Boolean) ? (
            <SequenceFrameCanvas
              alt={currentFrame.displayName}
              fallbackUrl={thumbnailUrls[0]}
              frameIndex={frameIndex}
              frames={sequence.frames}
              libraryId={libraryId}
              onPresentationError={reportFrameError}
              onPresentationReady={onPresentationReady}
            />
          ) : (
            <div
              aria-busy="true"
              className="preview-state is-silent"
              role="status"
            />
          )}
        </div>
      ) : pausedUrl ? (
        <ZoomableImage
          alt={currentFrame.displayName}
          displayTransform={displayTransform}
          fitRequestToken={fitRequestToken}
          fitKeybinds="f-only"
          isFullscreen={isFullscreen}
          keyboardShortcutsDisabled={keyboardShortcutsDisabled}
          onPresentationReady={onPresentationReady}
          onFullscreen={onFullscreen}
          onRotate={onRotate}
          onSwipeNext={onSwipeNext}
          onSwipePrevious={onSwipePrevious}
          placeholderSrc={thumbnailUrls[frameIndex] ?? undefined}
          src={pausedUrl}
        />
      ) : (
        <div aria-busy="true" className="preview-state is-silent" role="status" />
      )}
      <div className="preview-sequence-controls preview-chrome-fade">
        <button
          onClick={() => setPlayback(!playingRef.current)}
          type="button"
          {...iconActionAttrs(
            isPlaying ? t("preview.sequencePause") : t("preview.sequencePlay"),
          )}
        >
          <span aria-hidden="true">{isPlaying ? "❚❚" : "▶"}</span>
        </button>
        <Slider
          aria-label={t("preview.sequenceFrame")}
          max={sequence.frames.length - 1}
          min={0}
          onValueChange={(nextFrame) => {
            setPlayback(false);
            setFrameIndex(nextFrame);
          }}
          step={1}
          value={frameIndex}
          wrapperClassName="preview-sequence-slider"
        />
        <span>
          {frameIndex + 1} / {sequence.frames.length} · {sequence.fps} FPS
        </span>
        {onRotate ? (
          <button
            onClick={onRotate}
            type="button"
            {...iconActionAttrs(t("preview.rotateClockwise"))}
          >
            <Icon name="rotate-cw" size={14} />
          </button>
        ) : null}
        <button
          onClick={onFullscreen}
          type="button"
          {...iconActionAttrs(
            isFullscreen ? t("preview.exitFullscreen") : t("preview.fullscreen"),
          )}
        >
          <Icon
            name={isFullscreen ? "fullscreen-exit" : "fullscreen"}
            size={14}
          />
        </button>
      </div>
    </div>
  );
}
