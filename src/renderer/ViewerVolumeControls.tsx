import { useCallback, useRef, useState } from "react";

import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { scrubRatioFromClientX } from "./video-player-controls";
import { VIEWER_CHROME_TAB_INDEX } from "./viewer-focus-policy";

export type ViewerVolumeControlsProps = {
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onMutedChange: (muted: boolean) => void;
  /** Wake viewer chrome idle fade (pointer on volume chrome). */
  onInteract?: () => void;
};

/** Mute toggle + slider shared by video/audio viewer chrome (Serpent-8w6x). */
export function ViewerVolumeControls({
  volume,
  muted,
  onVolumeChange,
  onMutedChange,
  onInteract,
}: ViewerVolumeControlsProps) {
  const t = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const scrubbingPointerId = useRef<number | null>(null);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const effectiveMuted = muted || volume === 0;
  const displayRatio = scrubRatio ?? volume;

  // Volume alone owns mute when dragging: setVolume(v) sets muted = (v === 0).
  // Do not also call onMutedChange here — a stale unmute can overwrite the
  // just-written intermediate volume back to 0 or 1 (VIEWER-021).
  const applyRatio = useCallback(
    (ratio: number) => {
      onVolumeChange(Math.min(1, Math.max(0, ratio)));
    },
    [onVolumeChange],
  );

  const ratioFromPointer = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return scrubRatioFromClientX(clientX, { left: rect.left, width: rect.width });
  }, []);

  return (
    <div
      className={`preview-viewer-volume${adjusting ? " is-adjusting" : ""}`}
    >
      <button
        className="preview-video-playpause preview-viewer-volume-mute"
        onClick={() => {
          if (effectiveMuted) {
            onMutedChange(false);
          } else {
            onMutedChange(true);
          }
        }}
        tabIndex={VIEWER_CHROME_TAB_INDEX}
        type="button"
        {...iconActionAttrs(
          effectiveMuted ? t("preview.unmute") : t("preview.mute"),
        )}
      >
        <span aria-hidden="true">{effectiveMuted ? "🔇" : "🔊"}</span>
      </button>
      <div
        aria-label={t("preview.volumeAria")}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(displayRatio * 100)}
        className="preview-viewer-volume-track"
        onPointerCancel={(event) => {
          if (scrubbingPointerId.current !== event.pointerId) return;
          scrubbingPointerId.current = null;
          setAdjusting(false);
          setScrubRatio(null);
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onInteract?.();
          scrubbingPointerId.current = event.pointerId;
          setAdjusting(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          const ratio = ratioFromPointer(event.clientX);
          setScrubRatio(ratio);
          applyRatio(ratio);
        }}
        onPointerMove={(event) => {
          if (scrubbingPointerId.current !== event.pointerId) return;
          onInteract?.();
          const ratio = ratioFromPointer(event.clientX);
          setScrubRatio(ratio);
          applyRatio(ratio);
        }}
        onPointerUp={(event) => {
          if (scrubbingPointerId.current !== event.pointerId) return;
          scrubbingPointerId.current = null;
          setAdjusting(false);
          const ratio = ratioFromPointer(event.clientX);
          setScrubRatio(null);
          applyRatio(ratio);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        ref={trackRef}
        role="slider"
        tabIndex={VIEWER_CHROME_TAB_INDEX}
      >
        <div
          className="preview-viewer-volume-track-fill"
          style={{ width: `${displayRatio * 100}%` }}
        />
        <div
          className="preview-viewer-volume-track-thumb"
          style={{ left: `${displayRatio * 100}%` }}
        />
      </div>
    </div>
  );
}
