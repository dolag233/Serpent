import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ImageSequenceSummary } from "../shared/asset-types";
import { resolveSequenceFrameUrl } from "./sequence-frame-preview";

interface SequenceFrameCanvasProps {
  alt: string;
  fallbackUrl?: string | null;
  frameIndex: number;
  frames: ImageSequenceSummary["frames"];
  libraryId: string;
  onPresentationReady?: () => void;
}

/**
 * Paints decoded sequence frames directly to one canvas.
 *
 * Changing an img.src can expose a browser loading gap on every frame even
 * when a second DOM image is used as a buffer. This component waits for the
 * target bitmap to decode, then replaces the canvas pixels in one paint
 * operation. The old pixels remain visible until the new frame is ready.
 */
export function SequenceFrameCanvas({
  alt,
  fallbackUrl,
  frameIndex,
  frames,
  libraryId,
  onPresentationReady,
}: SequenceFrameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const drawRef = useRef<() => void>(() => undefined);
  const [readyVersion, setReadyVersion] = useState(0);
  const [readyUrls, setReadyUrls] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const frameUrls = useMemo(
    () =>
      frames.map((frame) => resolveSequenceFrameUrl(libraryId, frame)),
    [frames, libraryId],
  );
  const currentUrl = frameUrls[frameIndex] ?? null;
  const currentImageReady = Boolean(currentUrl && readyUrls.has(currentUrl));

  useEffect(() => {
    if (currentImageReady) onPresentationReady?.();
  }, [currentImageReady, onPresentationReady]);

  useEffect(() => {
    let cancelled = false;
    const cache = imageCacheRef.current;
    const wantedUrls = new Set(
      frameUrls.filter((url): url is string => Boolean(url)),
    );
    for (const url of cache.keys()) {
      if (!wantedUrls.has(url)) cache.delete(url);
    }

    for (const url of wantedUrls) {
      let image = cache.get(url);
      if (!image) {
        image = new Image();
        image.decoding = "async";
        cache.set(url, image);
      }
      const markReady = () => {
        if (!cancelled && image && image.complete && image.naturalWidth > 0) {
          setReadyUrls((current) => {
            if (current.has(url)) return current;
            return new Set(current).add(url);
          });
          setReadyVersion((version) => version + 1);
        }
      };
      image.onload = markReady;
      image.onerror = () => undefined;
      if (!image.src) image.src = url;
      if (image.complete) markReady();
    }

    return () => {
      cancelled = true;
      for (const url of wantedUrls) {
        const image = cache.get(url);
        if (image) {
          image.onload = null;
          image.onerror = null;
        }
      }
    };
  }, [frameUrls]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const url = frameUrls[frameIndex] ?? null;
    const image = url ? imageCacheRef.current.get(url) : undefined;
    if (!canvas || !image || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      return;
    }
    const parent = canvas.parentElement;
    const cssWidth = parent?.clientWidth ?? canvas.clientWidth;
    const cssHeight = parent?.clientHeight ?? canvas.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) return;

    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d");
    if (!context) return;
    const scale = Math.min(
      width / image.naturalWidth,
      height / image.naturalHeight,
    );
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.clearRect(0, 0, width, height);
    context.drawImage(
      image,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  }, [frameIndex, frameUrls]);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  useLayoutEffect(() => {
    draw();
  }, [draw, readyVersion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => drawRef.current());
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-label={alt}
      className="sequence-frame-canvas"
      role="img"
    >
      {!currentImageReady && fallbackUrl ? (
        <img
          alt=""
          className="sequence-frame-canvas-fallback"
          decoding="async"
          draggable={false}
          onLoad={() => onPresentationReady?.()}
          src={fallbackUrl}
        />
      ) : null}
      <canvas
        aria-hidden="true"
        className="sequence-frame-canvas-paint"
        ref={canvasRef}
      />
    </div>
  );
}
