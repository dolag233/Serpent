/**
 * Return the next playback frame, or keep the current frame when a queued
 * playback tick became stale after the user paused or scrubbed.
 */
export function advanceImageSequenceFrame(
  currentFrame: number,
  frameCount: number,
  isPlaying: boolean,
): number {
  if (!isPlaying) return currentFrame;
  return (currentFrame + 1) % frameCount;
}
