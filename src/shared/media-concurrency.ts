/**
 * Native media decoding is memory-bound before it is CPU-bound. A high-core
 * machine must not turn every physical core into a simultaneous FFmpeg/Sharp
 * process: one 4K video can retain hundreds of decoded frames, and libvips
 * also has its own internal thread pool. Keep the queue small and let the
 * per-decoder lanes apply their stricter limits.
 */
export const MEDIA_QUEUE_CONCURRENCY = 2;

export function mediaDecodeConcurrency(physicalCpus: number): number {
  if (!Number.isFinite(physicalCpus) || physicalCpus < 1) return 1;
  return Math.min(MEDIA_QUEUE_CONCURRENCY, Math.max(1, Math.trunc(physicalCpus)));
}

/** Keep the claim wave larger than the live pool so workers do not idle. */
export function mediaDecodeWaveSize(concurrency: number): number {
  const pool = Math.max(1, Math.trunc(concurrency));
  return pool * 2;
}
