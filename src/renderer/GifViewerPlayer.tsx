import { useCallback, useEffect, useRef, useState } from "react";

import type { SerpentShellApi } from "../shared/external-url";
import type { ViewerVideoShortcutAction } from "../shared/viewer-video-shortcuts";
import { openGifFrameSource, type GifFrameSource } from "./gif-frame-source";
import {
  gifAdjacentFrameIndex,
  gifFrameIndexAtTime,
  gifPlaybackFrames,
  gifTimeAtFrameStart,
  gifTimelineDurationMs,
  gifWrapPlaybackTimeMs,
  readGifFrameTimings,
  type GifFrameTiming,
} from "./gif-playback-timeline";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { useViewerZoomPan } from "./use-viewer-zoom-pan";
import { VideoPlaybackRateSelect } from "./VideoPlaybackRateSelect";
import {
  clampScrubTime,
  formatVideoClockTime,
  isTypingKeyboardTarget,
  matchVideoPlaybackRateKey,
  matchVideoPlaybackSeekKey,
  scrubRatioFromClientX,
  scrubRatioFromTime,
  scrubTimeFromRatio,
  shouldHandleVideoSpaceKey,
  stepVideoPlaybackRate,
  videoSeekDeltaSeconds,
  type VideoPlaybackRate,
} from "./video-player-controls";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";
import {
  IDENTITY_VIEWER_DISPLAY_TRANSFORM,
  viewerDisplaySize,
  viewerDisplayTransformCss,
  type ViewerDisplayTransform,
} from "./viewer-display-transform";
import { isViewerFitShortcut } from "./viewer-fit-shortcut";
import { ZoomableImage } from "./zoomable-preview-image";

type RendererWindow = Window & {
  serpent?: { shell?: SerpentShellApi };
};

const SCRUB_STEP_SECONDS = 5;

export type GifViewerPlayerProps = {
  alt: string;
  autoPlay?: boolean;
  colorSpaceOptions?: Array<{ id: string; label: string }>;
  colorSpaceValue?: string;
  displayTransform?: ViewerDisplayTransform;
  fitRequestToken?: number;
  isFullscreen?: boolean;
  keyboardShortcutsDisabled?: boolean;
  onColorSpaceChange?: (colorSpace: string) => void;
  onFullscreen?: () => void;
  onPresentationReady?: () => void;
  onRotate?: () => void;
  onRotateCounterClockwise?: () => void;
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
  onUserActivity?: () => void;
  placeholderSrc?: string;
  src: string;
};

type GifPlaybackSession = {
  frames: GifFrameTiming[];
  source: GifFrameSource;
};

/**
 * Animated GIFs in the viewer use the video transport (play/pause, scrub,
 * skip, frame step, rate). Single-frame GIFs and decode failures stay on
 * the still image viewer. Cards and Inspector are unchanged.
 */
export function GifViewerPlayer(props: GifViewerPlayerProps) {
  const [mode, setMode] = useState<"loading" | "animated" | "still" | "native">(
    "loading",
  );
  const [session, setSession] = useState<GifPlaybackSession | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let source: GifFrameSource | null = null;
    let disposed = false;
    setMode("loading");
    setSession(null);

    void (async () => {
      try {
        const response = await fetch(props.src, { signal: abort.signal });
        if (!response.ok) throw new Error("fetch");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (disposed) return;
        const parsed = readGifFrameTimings(bytes);
        source = await openGifFrameSource(bytes);
        if (disposed) {
          source.close();
          return;
        }
        if (source.frameCount <= 1) {
          source.close();
          source = null;
          if (!disposed) setMode("still");
          return;
        }
        const frames = gifPlaybackFrames(parsed, source.frameCount);
        const opened = source;
        source = null;
        if (disposed) {
          opened.close();
          return;
        }
        setSession({ frames, source: opened });
        setMode("animated");
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        source?.close();
        setMode("native");
      }
    })();

    return () => {
      disposed = true;
      abort.abort();
      setSession((current) => {
        current?.source.close();
        return null;
      });
    };
  }, [props.src]);

  if (mode === "still" || mode === "native") {
    return (
      <ZoomableImage
        alt={props.alt}
        colorSpaceOptions={props.colorSpaceOptions}
        colorSpaceValue={props.colorSpaceValue}
        displayTransform={props.displayTransform}
        fitRequestToken={props.fitRequestToken}
        isAnimated={mode === "native"}
        isFullscreen={props.isFullscreen}
        keyboardShortcutsDisabled={props.keyboardShortcutsDisabled}
        onColorSpaceChange={props.onColorSpaceChange}
        onFullscreen={props.onFullscreen}
        onPresentationReady={props.onPresentationReady}
        onRotate={props.onRotate}
        onRotateCounterClockwise={props.onRotateCounterClockwise}
        onSwipeNext={props.onSwipeNext}
        onSwipePrevious={props.onSwipePrevious}
        placeholderSrc={props.placeholderSrc}
        src={props.src}
      />
    );
  }

  return <GifAnimatedStage {...props} session={session} />;
}

function GifAnimatedStage({
  alt,
  autoPlay = true,
  displayTransform = IDENTITY_VIEWER_DISPLAY_TRANSFORM,
  fitRequestToken,
  isFullscreen = false,
  keyboardShortcutsDisabled = false,
  onFullscreen,
  onPresentationReady,
  onRotate,
  onRotateCounterClockwise,
  onSwipeNext,
  onSwipePrevious,
  onUserActivity,
  placeholderSrc,
  session,
}: GifViewerPlayerProps & { session: GifPlaybackSession | null }) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const framesRef = useRef<GifFrameTiming[]>(session?.frames ?? []);
  const sourceRef = useRef<GifFrameSource | null>(session?.source ?? null);
  const timeRef = useRef(0);
  const indexRef = useRef(-1);
  const paintGen = useRef(0);
  const playbackRateRef = useRef<VideoPlaybackRate>(1);
  const playingRef = useRef(false);
  const scrubbingRef = useRef(false);
  const scrubbingPointerId = useRef<number | null>(null);
  const userPausedRef = useRef(false);
  const autoPlayRef = useRef(autoPlay);
  const presentationReadyRef = useRef(onPresentationReady);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<VideoPlaybackRate>(1);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [hasFrame, setHasFrame] = useState(false);
  const {
    fitToWindow,
    measureAndFit,
    view,
    viewportPointerHandlers,
    viewportRef,
  } = useViewerZoomPan({
    keyboardShortcutsDisabled,
    onSwipeNext,
    onSwipePrevious,
  });

  useEffect(() => {
    autoPlayRef.current = autoPlay;
    playbackRateRef.current = playbackRate;
    playingRef.current = playing;
    presentationReadyRef.current = onPresentationReady;
  }, [autoPlay, onPresentationReady, playbackRate, playing]);

  const paint = useCallback((index: number) => {
    const source = sourceRef.current;
    const canvas = canvasRef.current;
    if (!source || !canvas) return;
    const generation = ++paintGen.current;
    void source.bitmap(index).then((bitmap) => {
      if (generation !== paintGen.current) return;
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        setNatural({ w: bitmap.width, h: bitmap.height });
      }
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(bitmap, 0, 0);
      setHasFrame(true);
      presentationReadyRef.current?.();
    }).catch(() => undefined);
    const count = framesRef.current.length;
    if (count > 1) {
      void source.bitmap((index + 1) % count).catch(() => undefined);
      void source.bitmap((index + 2) % count).catch(() => undefined);
    }
  }, []);

  const seekToMs = useCallback((timeMs: number) => {
    const frames = framesRef.current;
    const duration = gifTimelineDurationMs(frames);
    const clamped = Math.min(duration, Math.max(0, timeMs));
    timeRef.current = clamped;
    setCurrentTimeMs(clamped);
    const index = gifFrameIndexAtTime(frames, clamped);
    indexRef.current = index;
    paint(index);
  }, [paint]);

  const stepFrame = useCallback((direction: 1 | -1) => {
    const frames = framesRef.current;
    if (frames.length === 0) return;
    userPausedRef.current = true;
    setPlaying(false);
    const current = gifFrameIndexAtTime(frames, timeRef.current);
    const next = gifAdjacentFrameIndex(frames.length, current, direction);
    seekToMs(gifTimeAtFrameStart(frames, next));
  }, [seekToMs]);

  const togglePlayback = useCallback(() => {
    if (framesRef.current.length <= 1) return;
    if (playingRef.current) {
      userPausedRef.current = true;
      setPlaying(false);
      return;
    }
    userPausedRef.current = false;
    const duration = gifTimelineDurationMs(framesRef.current);
    if (duration > 0 && timeRef.current >= duration) timeRef.current = 0;
    setPlaying(true);
  }, []);

  const applyPlaybackRate = useCallback((next: VideoPlaybackRate) => {
    playbackRateRef.current = next;
    setPlaybackRate(next);
  }, []);

  useEffect(() => {
    framesRef.current = session?.frames ?? [];
    sourceRef.current = session?.source ?? null;
    if (!session) return;
    timeRef.current = 0;
    indexRef.current = -1;
    setCurrentTimeMs(0);
    setHasFrame(false);
    paint(0);
    if (autoPlayRef.current && !userPausedRef.current) setPlaying(true);
  }, [paint, session]);

  useEffect(() => {
    if (!playing || !session) return;
    let frameId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      if (!scrubbingRef.current) {
        const duration = gifTimelineDurationMs(framesRef.current);
        timeRef.current = gifWrapPlaybackTimeMs(
          timeRef.current + delta * playbackRateRef.current,
          duration,
        );
        const index = gifFrameIndexAtTime(framesRef.current, timeRef.current);
        if (index !== indexRef.current) {
          indexRef.current = index;
          paint(index);
        }
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    const clock = window.setInterval(() => {
      if (!scrubbingRef.current) setCurrentTimeMs(timeRef.current);
    }, 100);
    return () => {
      cancelAnimationFrame(frameId);
      window.clearInterval(clock);
    };
  }, [paint, playing, session]);

  useEffect(() => {
    if (natural.w <= 0 || natural.h <= 0) return;
    const size = viewerDisplaySize(
      natural.w,
      natural.h,
      displayTransform.quarterTurns,
    );
    measureAndFit("reset", { w: size.width, h: size.height });
  }, [displayTransform.quarterTurns, measureAndFit, natural.h, natural.w]);

  useEffect(() => {
    if (fitRequestToken === undefined) return;
    fitToWindow();
  }, [fitRequestToken, fitToWindow]);

  useEffect(() => {
    if (keyboardShortcutsDisabled || !session) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (
        !isTypingKeyboardTarget(event.target) &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey &&
        isViewerFitShortcut(event)
      ) {
        event.preventDefault();
        event.stopPropagation();
        fitToWindow();
        return;
      }
      if (shouldHandleVideoSpaceKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        togglePlayback();
        return;
      }
      const action = matchVideoPlaybackSeekKey(event);
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        if (action.kind === "frame") {
          stepFrame(action.direction);
          return;
        }
        const durationSeconds = gifTimelineDurationMs(framesRef.current) / 1000;
        seekToMs(
          clampScrubTime(
            timeRef.current / 1000 + videoSeekDeltaSeconds(action),
            durationSeconds,
          ) * 1000,
        );
        return;
      }
      const rateStep = matchVideoPlaybackRateKey(event);
      if (!rateStep) return;
      event.preventDefault();
      event.stopPropagation();
      applyPlaybackRate(
        stepVideoPlaybackRate(playbackRateRef.current, rateStep),
      );
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    applyPlaybackRate,
    fitToWindow,
    keyboardShortcutsDisabled,
    seekToMs,
    session,
    stepFrame,
    togglePlayback,
  ]);

  useEffect(() => {
    if (keyboardShortcutsDisabled || !session) return;
    const shell = (window as RendererWindow).serpent?.shell;
    if (!shell?.setViewerVideoShortcutsActive || !shell.onViewerVideoShortcut) {
      return;
    }
    const syncArmed = () => {
      const typing = isTypingKeyboardTarget(document.activeElement);
      const modalOpen = Boolean(
        document.querySelector('[role="dialog"][aria-modal="true"]'),
      );
      shell.setViewerVideoShortcutsActive(!typing && !modalOpen);
    };
    shell.setViewerVideoShortcutsActive(true);
    syncArmed();
    document.addEventListener("focusin", syncArmed, true);
    document.addEventListener("focusout", syncArmed, true);
    window.addEventListener("keyup", syncArmed, true);
    const applyMainAction = (action: ViewerVideoShortcutAction) => {
      if (isTypingKeyboardTarget(document.activeElement)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      onUserActivity?.();
      if (action === "frame-prev") {
        stepFrame(-1);
        return;
      }
      if (action === "frame-next") {
        stepFrame(1);
        return;
      }
      applyPlaybackRate(
        stepVideoPlaybackRate(
          playbackRateRef.current,
          action === "rate-slower" ? "slower" : "faster",
        ),
      );
    };
    const unsubscribe = shell.onViewerVideoShortcut(applyMainAction);
    return () => {
      shell.setViewerVideoShortcutsActive(false);
      document.removeEventListener("focusin", syncArmed, true);
      document.removeEventListener("focusout", syncArmed, true);
      window.removeEventListener("keyup", syncArmed, true);
      unsubscribe();
    };
  }, [
    applyPlaybackRate,
    keyboardShortcutsDisabled,
    onUserActivity,
    session,
    stepFrame,
  ]);

  const durationMs = gifTimelineDurationMs(session?.frames ?? []);
  const durationSeconds = durationMs / 1000;
  const currentSeconds = currentTimeMs / 1000;
  const displayRatio =
    scrubRatio ?? scrubRatioFromTime(currentSeconds, durationSeconds);
  const displayTime =
    scrubRatio !== null
      ? scrubTimeFromRatio(scrubRatio, durationSeconds)
      : currentSeconds;
  const canvasStyle =
    natural.w > 0 && view.scale > 0
      ? {
          width: natural.w * view.scale,
          height: natural.h * view.scale,
          maxWidth: "none",
          maxHeight: "none",
          transform: `translate(${view.x}px, ${view.y}px) ${viewerDisplayTransformCss(displayTransform)}`,
          transformOrigin: "center center",
        }
      : undefined;

  const ratioFromPointer = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return scrubRatioFromClientX(clientX, { left: rect.left, width: rect.width });
  };

  return (
    <div className="preview-video-stage">
      <div
        className="preview-video-viewport is-pannable"
        ref={viewportRef}
        {...viewportPointerHandlers}
      >
        {placeholderSrc && !hasFrame ? (
          <img alt="" className="preview-video" src={placeholderSrc} />
        ) : null}
        <canvas
          aria-label={alt}
          className="preview-video"
          ref={canvasRef}
          style={canvasStyle}
        />
      </div>
      {session ? (
        <div className="preview-video-controls preview-chrome-fade">
          <button
            className="preview-video-playpause"
            onClick={togglePlayback}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
            type="button"
            {...iconActionAttrs(
              playing ? t("preview.videoPause") : t("preview.videoPlay"),
            )}
          >
            <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
          </button>
          <span aria-hidden="true" className="preview-video-time">
            {formatVideoClockTime(displayTime)}
          </span>
          <div
            aria-label={t("preview.videoScrubAria")}
            aria-valuemax={Math.round(durationSeconds)}
            aria-valuemin={0}
            aria-valuenow={Math.round(displayTime)}
            className="preview-video-track"
            onKeyDown={(event) => {
              let nextSeconds: number | null = null;
              if (event.key === "ArrowLeft") {
                nextSeconds = clampScrubTime(
                  currentSeconds - SCRUB_STEP_SECONDS,
                  durationSeconds,
                );
              } else if (event.key === "ArrowRight") {
                nextSeconds = clampScrubTime(
                  currentSeconds + SCRUB_STEP_SECONDS,
                  durationSeconds,
                );
              } else if (event.key === "Home") {
                nextSeconds = 0;
              } else if (event.key === "End") {
                nextSeconds = durationSeconds;
              }
              if (nextSeconds === null) return;
              event.preventDefault();
              seekToMs(nextSeconds * 1000);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.focus();
              scrubbingPointerId.current = event.pointerId;
              scrubbingRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              const ratio = ratioFromPointer(event.clientX);
              setScrubRatio(ratio);
              seekToMs(scrubTimeFromRatio(ratio, durationSeconds) * 1000);
            }}
            onPointerMove={(event) => {
              if (scrubbingPointerId.current !== event.pointerId) return;
              const ratio = ratioFromPointer(event.clientX);
              setScrubRatio(ratio);
              seekToMs(scrubTimeFromRatio(ratio, durationSeconds) * 1000);
            }}
            onPointerUp={(event) => {
              if (scrubbingPointerId.current !== event.pointerId) return;
              scrubbingPointerId.current = null;
              scrubbingRef.current = false;
              const ratio = ratioFromPointer(event.clientX);
              setScrubRatio(null);
              seekToMs(scrubTimeFromRatio(ratio, durationSeconds) * 1000);
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (scrubbingPointerId.current !== event.pointerId) return;
              scrubbingPointerId.current = null;
              scrubbingRef.current = false;
              setScrubRatio(null);
            }}
            ref={trackRef}
            role="slider"
            tabIndex={VIEWER_CHROME_TAB_INDEX}
          >
            <div
              className="preview-video-track-fill"
              style={{ width: `${displayRatio * 100}%` }}
            />
            <div
              className="preview-video-track-thumb"
              style={{ left: `${displayRatio * 100}%` }}
            />
          </div>
          <span aria-hidden="true" className="preview-video-time">
            {formatVideoClockTime(durationSeconds)}
          </span>
          <VideoPlaybackRateSelect
            onChange={applyPlaybackRate}
            onInteract={onUserActivity}
            value={playbackRate}
          />
          {onRotateCounterClockwise ? (
            <button
              className="preview-video-fit"
              onClick={onRotateCounterClockwise}
              tabIndex={VIEWER_CHROME_TAB_INDEX}
              type="button"
              {...iconActionAttrs(t("preview.rotateCounterClockwise"))}
            >
              <Icon name="rotate-ccw" size={14} />
            </button>
          ) : null}
          {onRotate ? (
            <button
              className="preview-video-fit"
              onClick={onRotate}
              tabIndex={VIEWER_CHROME_TAB_INDEX}
              type="button"
              {...iconActionAttrs(t("preview.rotateClockwise"))}
            >
              <Icon name="rotate-cw" size={14} />
            </button>
          ) : null}
          <button
            className="preview-video-fit"
            onClick={fitToWindow}
            tabIndex={VIEWER_CHROME_TAB_INDEX}
            type="button"
            {...iconActionAttrs(t("preview.fitWindow"))}
          >
            <Icon name="fit-window" size={14} />
          </button>
          {onFullscreen ? (
            <button
              className="preview-video-fullscreen"
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
