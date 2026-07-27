import { useEffect, useMemo, useRef, useState } from "react";

import type { ImageSequenceSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import { coverSrc } from "./asset-card-hover-preview";
import { iconActionAttrs } from "./icon-action-attrs";
import { Icon } from "./Icons";
import { useT } from "./i18n";
import type { ViewerDisplayTransform } from "./viewer-display-transform";
import { ZoomableImage } from "./zoomable-preview-image";

export interface ImageSequencePlayerProps {
  api: SerpentLibraryApi;
  displayTransform: ViewerDisplayTransform;
  isFullscreen: boolean;
  libraryId: string;
  onFullscreen(): void;
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
  sequence: ImageSequenceSummary;
}

export function ImageSequencePlayer({
  api,
  displayTransform,
  isFullscreen,
  libraryId,
  onFullscreen,
  onSwipeNext,
  onSwipePrevious,
  sequence,
}: ImageSequencePlayerProps) {
  const t = useT();
  const thumbnailUrls = useMemo(
    () =>
      sequence.frames.map((frame) =>
        frame.thumbnailArtifactId
          ? coverSrc(libraryId, frame.thumbnailArtifactId)
          : null,
      ),
    [libraryId, sequence.frames],
  );
  const [resolvedUrls, setResolvedUrls] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const lastTickRef = useRef<number | null>(null);

  useEffect(() => {
    for (const url of thumbnailUrls) {
      if (!url) continue;
      const image = new Image();
      image.src = url;
    }
  }, [thumbnailUrls]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (now: number) => {
      const previous = lastTickRef.current ?? now;
      const elapsed = now - previous;
      const frameDuration = 1000 / sequence.fps;
      if (elapsed >= frameDuration) {
        const steps = Math.max(1, Math.floor(elapsed / frameDuration));
        setFrameIndex((current) => (current + steps) % sequence.frames.length);
        lastTickRef.current = now - (elapsed % frameDuration);
      }
      frame = requestAnimationFrame(tick);
    };
    lastTickRef.current = null;
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, sequence.fps, sequence.frames.length]);

  const currentFrame = sequence.frames[frameIndex]!;
  useEffect(() => {
    if (playing && thumbnailUrls[frameIndex]) return;
    let cancelled = false;
    void api.requestPreview({
      libraryId,
      assetId: currentFrame.assetId,
      mode: "client",
    }).then((result) => {
      if (cancelled || !result.ok || !result.value.url) return;
      setResolvedUrls((current) => {
        const next = new Map(current);
        next.set(currentFrame.assetId, result.value.url!);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    api,
    currentFrame.assetId,
    frameIndex,
    libraryId,
    playing,
    thumbnailUrls,
  ]);

  const currentUrl =
    resolvedUrls.get(currentFrame.assetId) ??
    thumbnailUrls[frameIndex] ??
    thumbnailUrls.find((url): url is string => Boolean(url));

  return (
    <div className="preview-sequence-stage">
      {currentUrl ? (
        <ZoomableImage
          alt={currentFrame.displayName}
          displayTransform={displayTransform}
          isFullscreen={isFullscreen}
          onFullscreen={onFullscreen}
          onSwipeNext={onSwipeNext}
          onSwipePrevious={onSwipePrevious}
          placeholderSrc={thumbnailUrls[frameIndex] ?? undefined}
          src={currentUrl}
        />
      ) : (
        <div aria-busy="true" className="preview-state is-silent" role="status" />
      )}
      <div className="preview-sequence-controls preview-chrome-fade">
        <button
          onClick={() => setPlaying((current) => !current)}
          type="button"
          {...iconActionAttrs(
            playing ? t("preview.sequencePause") : t("preview.sequencePlay"),
          )}
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </button>
        <input
          aria-label={t("preview.sequenceFrame")}
          max={sequence.frames.length - 1}
          min={0}
          onChange={(event) => {
            setPlaying(false);
            setFrameIndex(Number(event.currentTarget.value));
          }}
          step={1}
          type="range"
          value={frameIndex}
        />
        <span>
          {frameIndex + 1} / {sequence.frames.length} · {sequence.fps} FPS
        </span>
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
