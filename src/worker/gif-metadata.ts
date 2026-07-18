/**
 * GIF duration / frame-count helpers for extracted_metadata persistence.
 * Sharp exposes `pages` and per-frame `delay` (ms); browsers treat delay ≤ 0 as ~100ms.
 */

export const GIF_DEFAULT_FRAME_DELAY_MS = 100;

export function normalizeGifFrameDelayMs(delayMs: number): number {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return GIF_DEFAULT_FRAME_DELAY_MS;
  }
  return Math.round(delayMs);
}

/** Sum of per-frame delays for `pages` frames. */
export function computeGifDurationMs(
  delays: readonly number[] | undefined,
  pages: number,
): number {
  const frameCount = Math.max(0, Math.floor(pages));
  if (frameCount <= 0) return 0;
  if (!delays || delays.length === 0) {
    return frameCount * GIF_DEFAULT_FRAME_DELAY_MS;
  }
  let total = 0;
  for (let i = 0; i < frameCount; i += 1) {
    const raw =
      delays[i] ?? delays[delays.length - 1] ?? GIF_DEFAULT_FRAME_DELAY_MS;
    total += normalizeGifFrameDelayMs(raw);
  }
  return total;
}

export type GifExtractedMetadata = {
  container: "gif";
  durationMs: number;
  frameCount: number;
  width: number;
  height: number;
};

export function buildGifExtractedMetadata(input: {
  width: number;
  height: number;
  pages: number;
  delay?: readonly number[];
}): GifExtractedMetadata {
  const frameCount = Math.max(1, Math.floor(input.pages) || 1);
  // Single-frame GIFs are stills; avoid projecting a sub-second "0:00" badge.
  const durationMs =
    frameCount <= 1 ? 0 : computeGifDurationMs(input.delay, frameCount);
  return {
    container: "gif",
    durationMs,
    frameCount,
    width: Math.max(0, Math.floor(input.width) || 0),
    height: Math.max(0, Math.floor(input.height) || 0),
  };
}
