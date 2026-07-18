/**
 * Pick a representative still page for animated GIF thumbnails.
 * Many marketing GIFs open on a black/near-black intro frame; pinning page 0
 * yields a pure-black grid card while the viewer plays the colored animation.
 */

export const GIF_THUMBNAIL_MAX_PAGE_SAMPLES = 24;
export const GIF_THUMBNAIL_PROBE_SIZE = 64;

/** Uniform sample of page indices across [0, pages). Always includes 0. */
export function sampleGifPageIndices(
  pages: number,
  maxSamples = GIF_THUMBNAIL_MAX_PAGE_SAMPLES,
): number[] {
  if (pages <= 1) return [0];
  const count = Math.min(pages, Math.max(1, maxSamples));
  if (count === pages) {
    return Array.from({ length: pages }, (_, i) => i);
  }
  const indices = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    indices.add(Math.round((i * (pages - 1)) / (count - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * Score a raw RGB(A) buffer: mean luminance × fraction of non-near-black pixels.
 * Higher is better for a recognizable still.
 */
export function scoreRawRgbFrame(
  data: Uint8Array,
  channels: number,
  nearBlackThreshold = 16,
): number {
  if (channels < 3 || data.length < channels) return 0;
  const pixelCount = Math.floor(data.length / channels);
  if (pixelCount === 0) return 0;

  let sum = 0;
  let nonBlack = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * channels;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const mean = (r + g + b) / 3;
    sum += mean;
    if (mean > nearBlackThreshold) nonBlack += 1;
  }
  const meanRgb = sum / pixelCount;
  const nonBlackPct = nonBlack / pixelCount;
  return meanRgb * nonBlackPct;
}

export function pickBestGifPage(
  scored: ReadonlyArray<{ page: number; score: number }>,
  pages: number,
): number {
  if (scored.length === 0) {
    return pages > 1 ? Math.floor((pages - 1) * 0.25) : 0;
  }
  let best = scored[0]!;
  for (let i = 1; i < scored.length; i += 1) {
    const candidate = scored[i]!;
    if (
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.page < best.page)
    ) {
      best = candidate;
    }
  }
  if (best.score <= 0 && pages > 1) {
    return Math.floor((pages - 1) * 0.25);
  }
  return best.page;
}
