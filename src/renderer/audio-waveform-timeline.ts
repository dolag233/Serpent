/**
 * Pure helpers for the audio viewer waveform timeline / playhead (Serpent-13v).
 * Reuses the same 0..1 ratio math as video scrub so unit tests stay DOM-free.
 */

import {
  scrubRatioFromClientX,
  scrubRatioFromTime,
  scrubTimeFromRatio,
  type ScrubTrackGeometry,
} from "./video-player-controls";

/** Playback time → 0..1 ratio along the waveform timeline. */
export function playheadRatioFromTime(
  currentTime: number,
  duration: number,
): number {
  return scrubRatioFromTime(currentTime, duration);
}

/** Ratio → CSS `left` percentage for the waveform playhead. */
export function playheadLeftPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(100, Math.max(0, ratio * 100));
}

/**
 * Content box for `object-fit: contain` inside a shell (Serpent-vlx).
 * Returns offsets/size in the same coordinate space as the shell.
 */
export function containContentBox(
  shellWidth: number,
  shellHeight: number,
  contentWidth: number,
  contentHeight: number,
): { left: number; top: number; width: number; height: number } {
  if (
    shellWidth <= 0 ||
    shellHeight <= 0 ||
    contentWidth <= 0 ||
    contentHeight <= 0
  ) {
    return { left: 0, top: 0, width: shellWidth, height: shellHeight };
  }
  const shellRatio = shellWidth / shellHeight;
  const contentRatio = contentWidth / contentHeight;
  if (shellRatio > contentRatio) {
    const height = shellHeight;
    const width = height * contentRatio;
    return { left: (shellWidth - width) / 2, top: 0, width, height };
  }
  const width = shellWidth;
  const height = width / contentRatio;
  return { left: 0, top: (shellHeight - height) / 2, width, height };
}

/** Ratio → CSS left % relative to the shell, mapped through a contain box. */
export function playheadLeftPercentInContainBox(
  ratio: number,
  shellWidth: number,
  box: { left: number; width: number },
): number {
  if (shellWidth <= 0 || box.width <= 0) return playheadLeftPercent(ratio);
  const clamped = Math.min(1, Math.max(0, ratio));
  return ((box.left + clamped * box.width) / shellWidth) * 100;
}

/** Pointer X on the waveform → seek ratio (0..1). */
export function seekRatioFromWaveformClientX(
  clientX: number,
  geometry: ScrubTrackGeometry,
): number {
  return scrubRatioFromClientX(clientX, geometry);
}

/** Ratio → seek time in seconds. */
export function seekTimeFromWaveformRatio(
  ratio: number,
  duration: number,
): number {
  return scrubTimeFromRatio(ratio, duration);
}
