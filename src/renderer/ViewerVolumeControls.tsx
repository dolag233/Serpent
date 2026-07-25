import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export type ViewerVolumeControlsProps = {
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onMutedChange: (muted: boolean) => void;
};

/** Mute toggle + slider shared by video/audio viewer chrome (Serpent-8w6x). */
export function ViewerVolumeControls({
  volume,
  muted,
  onVolumeChange,
  onMutedChange,
}: ViewerVolumeControlsProps) {
  const t = useT();
  const effectiveMuted = muted || volume === 0;

  return (
    <div className="preview-viewer-volume">
      <button
        className="preview-video-playpause preview-viewer-volume-mute"
        onClick={() => onMutedChange(!effectiveMuted)}
        type="button"
        {...iconActionAttrs(
          effectiveMuted ? t("preview.unmute") : t("preview.mute"),
        )}
      >
        <span aria-hidden="true">{effectiveMuted ? "🔇" : "🔊"}</span>
      </button>
      <input
        aria-label={t("preview.volumeAria")}
        className="preview-viewer-volume-slider"
        max={100}
        min={0}
        onChange={(event) => {
          const next = Number(event.target.value) / 100;
          onVolumeChange(next);
          if (next > 0) onMutedChange(false);
        }}
        type="range"
        value={Math.round(volume * 100)}
      />
    </div>
  );
}
