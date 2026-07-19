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
