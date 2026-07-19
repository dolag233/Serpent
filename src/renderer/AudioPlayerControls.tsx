import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";

import {
  AUDIO_WAVEFORM_COVER_HEIGHT,
  AUDIO_WAVEFORM_COVER_WIDTH,
} from "../shared/audio-media";
import {
  containContentBox,
  playheadLeftPercentInContainBox,
  playheadRatioFromTime,
  seekRatioFromWaveformClientX,
} from "./audio-waveform-timeline";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { createMediaSeekSession } from "./media-seek-session";
import {
  clampScrubTime,
  formatVideoClockTime,
  nextPlaybackIntent,
  scrubRatioFromClientX,
  scrubRatioFromTime,
  scrubTimeFromRatio,
  shouldHandleVideoSpaceKey,
} from "./video-player-controls";

export interface AudioPlayerControlsProps {
  onError(event: SyntheticEvent<HTMLAudioElement>): void;
  onReady?(): void;
  src: string;
  /** Waveform overview image (thumbnail artifact), optional until ready. */
  waveformUrl?: string;
}

const SCRUB_STEP_SECONDS = 5;

/**
 * Viewer chrome for audio (Serpent-0x5 / 13v / muc / vlx):
 * theme-backed shell + object-fit:contain so the full 4:3 waveform is visible;
 * playhead/scrub map through the contain content box; FL-style trail via CSS.
 * Seek/scrub uses `createMediaSeekSession` (Serpent-jh2).
 */
export function AudioPlayerControls({
  onError,
  onReady,
  src,
  waveformUrl,
}: AudioPlayerControlsProps) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);
  const scrubbingPointerId = useRef<number | null>(null);
  const waveformScrubbingPointerId = useRef<number | null>(null);
  const seekSessionRef = useRef(
    createMediaSeekSession(
      () => audioRef.current,
      (time) => {
        const audio = audioRef.current;
        if (audio) audio.currentTime = time;
      },
    ),
  );
  const [paused, setPaused] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (nextPlaybackIntent(audio.paused) === "play") {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleVideoSpaceKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      togglePlayback();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [togglePlayback]);

  useEffect(() => {
    const session = seekSessionRef.current;
    session.cancel();
    return () => session.cancel();
  }, [src]);

  const seekToRatio = useCallback((ratio: number, mode: "coalesce" | "commit") => {
    const audio = audioRef.current;
    if (!audio) return;
    const time = scrubTimeFromRatio(ratio, audio.duration);
    if (mode === "commit") {
      seekSessionRef.current.commit(time);
      return;
    }
    seekSessionRef.current.request(time);
  }, []);

  const ratioFromPointer = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return scrubRatioFromClientX(clientX, { left: rect.left, width: rect.width });
  }, []);

  const ratioFromWaveformPointer = useCallback((clientX: number): number => {
    const waveform = waveformRef.current;
    if (!waveform) return 0;
    const rect = waveform.getBoundingClientRect();
    const box = containContentBox(
      rect.width,
      rect.height,
      AUDIO_WAVEFORM_COVER_WIDTH,
      AUDIO_WAVEFORM_COVER_HEIGHT,
    );
    return seekRatioFromWaveformClientX(clientX, {
      left: rect.left + box.left,
      width: box.width,
    });
  }, []);

  const displayRatio =
    scrubRatio ?? scrubRatioFromTime(currentTime, duration);
  const displayTime =
    scrubRatio !== null ? scrubTimeFromRatio(scrubRatio, duration) : currentTime;
  const shellWidth = waveformRef.current?.clientWidth ?? 0;
  const shellHeight = waveformRef.current?.clientHeight ?? 0;
  const containBox = containContentBox(
    shellWidth,
    shellHeight,
    AUDIO_WAVEFORM_COVER_WIDTH,
    AUDIO_WAVEFORM_COVER_HEIGHT,
  );
  const playheadPercent = playheadLeftPercentInContainBox(
    scrubRatio ?? playheadRatioFromTime(currentTime, duration),
    shellWidth,
    containBox,
  );

  const applyKeySeek = (nextTime: number) => {
    seekSessionRef.current.commit(nextTime);
    setCurrentTime(nextTime);
  };

  return (
    <div className="preview-audio-stage">
      <div
        aria-label={t("preview.videoScrubAria")}
        aria-valuemax={Math.round(duration)}
        aria-valuemin={0}
        aria-valuenow={Math.round(displayTime)}
        className="preview-audio-waveform-shell"
        onKeyDown={(event) => {
          const audio = audioRef.current;
          if (!audio) return;
          let nextTime: number | null = null;
          if (event.key === "ArrowLeft") {
            nextTime = clampScrubTime(
              audio.currentTime - SCRUB_STEP_SECONDS,
              duration,
            );
          } else if (event.key === "ArrowRight") {
            nextTime = clampScrubTime(
              audio.currentTime + SCRUB_STEP_SECONDS,
              duration,
            );
          } else if (event.key === "Home") {
            nextTime = 0;
          } else if (event.key === "End") {
            nextTime = clampScrubTime(duration, duration);
          }
          if (nextTime === null) return;
          event.preventDefault();
          applyKeySeek(nextTime);
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.focus();
          waveformScrubbingPointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          const ratio = ratioFromWaveformPointer(event.clientX);
          setScrubRatio(ratio);
          seekToRatio(ratio, "coalesce");
        }}
        onPointerMove={(event) => {
          if (waveformScrubbingPointerId.current !== event.pointerId) return;
          const ratio = ratioFromWaveformPointer(event.clientX);
          setScrubRatio(ratio);
          seekToRatio(ratio, "coalesce");
        }}
        onPointerUp={(event) => {
          if (waveformScrubbingPointerId.current !== event.pointerId) return;
          waveformScrubbingPointerId.current = null;
          const ratio = ratioFromWaveformPointer(event.clientX);
          setScrubRatio(null);
          seekToRatio(ratio, "commit");
          setCurrentTime(audioRef.current?.currentTime ?? 0);
        }}
        ref={waveformRef}
        role="slider"
        tabIndex={0}
      >
        {waveformUrl ? (
          <img
            alt=""
            className="preview-audio-waveform"
            draggable={false}
            src={waveformUrl}
          />
        ) : (
          <div aria-hidden="true" className="preview-audio-waveform is-placeholder" />
        )}
        <div
          aria-hidden="true"
          className="preview-audio-playhead"
          style={{ left: `${playheadPercent}%` }}
        />
      </div>
      <audio
        autoPlay
        className="preview-audio"
        onDurationChange={(event) =>
          setDuration(event.currentTarget.duration || 0)
        }
        onEnded={() => setPaused(true)}
        onError={onError}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          onReady?.();
        }}
        onPause={() => setPaused(true)}
        onPlay={() => setPaused(false)}
        onSeeked={() => {
          seekSessionRef.current.onSeeked();
          if (
            scrubbingPointerId.current === null &&
            waveformScrubbingPointerId.current === null &&
            audioRef.current
          ) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onTimeUpdate={(event) => {
          if (
            scrubbingPointerId.current !== null ||
            waveformScrubbingPointerId.current !== null
          ) {
            return;
          }
          setCurrentTime(event.currentTarget.currentTime);
        }}
        preload="auto"
        ref={audioRef}
        src={src}
      >
        {t("preview.videoUnsupported")}
      </audio>
      <div className="preview-video-controls preview-audio-controls preview-chrome-fade">
        <button
          className="preview-video-playpause"
          onClick={togglePlayback}
          type="button"
          {...iconActionAttrs(
            paused ? t("preview.videoPlay") : t("preview.videoPause"),
          )}
        >
          <span aria-hidden="true">{paused ? "▶" : "❚❚"}</span>
        </button>
        <span aria-hidden="true" className="preview-video-time">
          {formatVideoClockTime(displayTime)} / {formatVideoClockTime(duration)}
        </span>
        <div
          aria-label={t("preview.videoScrubAria")}
          aria-valuemax={Math.round(duration)}
          aria-valuemin={0}
          aria-valuenow={Math.round(displayTime)}
          className="preview-video-track"
          onKeyDown={(event) => {
            const audio = audioRef.current;
            if (!audio) return;
            let nextTime: number | null = null;
            if (event.key === "ArrowLeft") {
              nextTime = clampScrubTime(
                audio.currentTime - SCRUB_STEP_SECONDS,
                duration,
              );
            } else if (event.key === "ArrowRight") {
              nextTime = clampScrubTime(
                audio.currentTime + SCRUB_STEP_SECONDS,
                duration,
              );
            } else if (event.key === "Home") {
              nextTime = 0;
            } else if (event.key === "End") {
              nextTime = clampScrubTime(duration, duration);
            }
            if (nextTime === null) return;
            event.preventDefault();
            applyKeySeek(nextTime);
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.focus();
            scrubbingPointerId.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            const ratio = ratioFromPointer(event.clientX);
            setScrubRatio(ratio);
            seekToRatio(ratio, "coalesce");
          }}
          onPointerMove={(event) => {
            if (scrubbingPointerId.current !== event.pointerId) return;
            const ratio = ratioFromPointer(event.clientX);
            setScrubRatio(ratio);
            seekToRatio(ratio, "coalesce");
          }}
          onPointerUp={(event) => {
            if (scrubbingPointerId.current !== event.pointerId) return;
            scrubbingPointerId.current = null;
            const ratio = ratioFromPointer(event.clientX);
            setScrubRatio(null);
            seekToRatio(ratio, "commit");
            setCurrentTime(audioRef.current?.currentTime ?? 0);
          }}
          ref={trackRef}
          role="slider"
          tabIndex={0}
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
      </div>
    </div>
  );
}
