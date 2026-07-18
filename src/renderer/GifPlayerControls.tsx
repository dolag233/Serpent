import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import {
  captureImageElementFrame,
  clampGifFrameIndex,
  imageDecoderSupported,
  nextPlaybackIntent,
  shouldHandleGifSpaceKey,
  stepGifFrameIndex,
  type ImageDecoderLike,
} from "./gif-player-controls";
import { ZoomableImage } from "./zoomable-preview-image";

export interface GifPlayerControlsProps {
  alt: string;
  onFullscreen(): void;
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
  src: string;
}

/**
 * GIF viewer chrome: native animated `<img>` while playing; freeze via canvas
 * snapshot on pause. When ImageDecoder is available, prev/next step frames.
 *
 * Parent should remount on `src` change (`key={src}`) so playback state resets.
 */
export function GifPlayerControls({
  alt,
  onFullscreen,
  onSwipeNext,
  onSwipePrevious,
  src,
}: GifPlayerControlsProps) {
  const t = useT();
  const stageRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  const [displaySrc, setDisplaySrc] = useState(src);
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [canStepFrames, setCanStepFrames] = useState(false);
  const decoderRef = useRef<ImageDecoderLike | null>(null);
  const frameUrlsRef = useRef<Map<number, string>>(new Map());
  const playingRef = useRef(true);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    if (!imageDecoderSupported()) return;

    let cancelled = false;
    const frameUrls = frameUrlsRef.current;

    const load = async () => {
      try {
        const response = await fetch(src);
        if (!response.ok || cancelled) return;
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        const DecoderCtor = globalThis.ImageDecoder as unknown as new (init: {
          data: ArrayBuffer;
          type: string;
        }) => ImageDecoderLike;
        const decoder = new DecoderCtor({
          data: buffer,
          type: "image/gif",
        });
        await decoder.tracks.ready;
        if (cancelled) {
          decoder.close();
          return;
        }
        const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
        decoderRef.current = decoder;
        setFrameCount(count);
        setCanStepFrames(count > 1);
      } catch {
        // Fallback: play/pause via img freeze only.
      }
    };
    void load();

    return () => {
      cancelled = true;
      decoderRef.current?.close();
      decoderRef.current = null;
      for (const url of frameUrls.values()) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      frameUrls.clear();
    };
  }, [src]);

  const ensureFrameUrl = useCallback(
    async (index: number): Promise<string | null> => {
      const cached = frameUrlsRef.current.get(index);
      if (cached) return cached;
      const decoder = decoderRef.current;
      if (!decoder) return null;
      try {
        const result = await decoder.decode({ frameIndex: index });
        const frame = result.image;
        const width = frame.displayWidth ?? frame.codedWidth ?? 0;
        const height = frame.displayHeight ?? frame.codedHeight ?? 0;
        if (!width || !height) {
          frame.close();
          return null;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          frame.close();
          return null;
        }
        ctx.drawImage(frame, 0, 0);
        frame.close();
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((value) => resolve(value), "image/png");
        });
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        frameUrlsRef.current.set(index, url);
        return url;
      } catch {
        return null;
      }
    },
    [],
  );

  const showFrame = useCallback(
    async (index: number, pausePlayback: boolean) => {
      const clamped = clampGifFrameIndex(index, frameCount || 1);
      const url = await ensureFrameUrl(clamped);
      if (!url) return;
      if (pausePlayback) {
        setPlaying(false);
        playingRef.current = false;
      }
      setFrameIndex(clamped);
      setDisplaySrc(url);
    },
    [ensureFrameUrl, frameCount],
  );

  const freezeCurrentPaint = useCallback(() => {
    const image = stageRef.current?.querySelector(
      "img.preview-image",
    ) as HTMLImageElement | null;
    if (!image) return false;
    const dataUrl = captureImageElementFrame(image);
    if (!dataUrl) return false;
    setDisplaySrc(dataUrl);
    return true;
  }, []);

  const togglePlayback = useCallback(() => {
    const currentlyPaused = !playingRef.current;
    const next = nextPlaybackIntent(currentlyPaused);
    if (next === "pause") {
      freezeCurrentPaint();
      setPlaying(false);
      playingRef.current = false;
      return;
    }
    setPlaying(true);
    playingRef.current = true;
    setDisplaySrc(src);
  }, [freezeCurrentPaint, src]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleGifSpaceKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      togglePlayback();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [togglePlayback]);

  const frameLabel =
    canStepFrames && frameCount > 0
      ? t("preview.gifFrameOf", {
          current: frameIndex + 1,
          total: frameCount,
        })
      : null;

  return (
    <div className="preview-gif-stage" ref={stageRef}>
      <ZoomableImage
        alt={alt}
        fitKeybinds="f-only"
        onFullscreen={onFullscreen}
        onSwipeNext={onSwipeNext}
        onSwipePrevious={onSwipePrevious}
        src={playing ? src : displaySrc}
      />
      <div
        aria-label={t("preview.gifControls")}
        className="preview-gif-controls preview-chrome-fade"
      >
        <button
          disabled={!canStepFrames}
          onClick={() => {
            if (!canStepFrames) return;
            const next = stepGifFrameIndex(frameIndex, frameCount, -1);
            void showFrame(next, true);
          }}
          type="button"
          {...iconActionAttrs(t("preview.gifPrevFrame"))}
        >
          <Icon name="chevron-left" size={14} />
        </button>
        <button
          onClick={() => togglePlayback()}
          type="button"
          {...iconActionAttrs(
            playing ? t("preview.gifPause") : t("preview.gifPlay"),
          )}
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </button>
        <button
          disabled={!canStepFrames}
          onClick={() => {
            if (!canStepFrames) return;
            const next = stepGifFrameIndex(frameIndex, frameCount, 1);
            void showFrame(next, true);
          }}
          type="button"
          {...iconActionAttrs(t("preview.gifNextFrame"))}
        >
          <Icon name="chevron-right" size={14} />
        </button>
        {frameLabel && (
          <span className="preview-gif-frame-label">{frameLabel}</span>
        )}
      </div>
    </div>
  );
}
