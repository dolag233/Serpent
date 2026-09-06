/**
 * Native media decoding is memory-bound before it is CPU-bound. Keep the
 * queue small and let the per-decoder lanes apply their concurrency policy;
 * this is scheduling only, never a source-size or hardware capability gate.
 */
export const MEDIA_QUEUE_CONCURRENCY = 2;
/**
 * Interactive image cards get two extra bounded slots. The regular/background
 * queue remains capped at MEDIA_QUEUE_CONCURRENCY; this only prioritizes the
 * current viewport and does not reject large or high-resolution sources.
 */
export const MEDIA_INTERACTIVE_QUEUE_CONCURRENCY = 4;

export function mediaDecodeConcurrency(physicalCpus: number): number {
  if (!Number.isFinite(physicalCpus) || physicalCpus < 1) return 1;
  return Math.min(MEDIA_QUEUE_CONCURRENCY, Math.max(1, Math.trunc(physicalCpus)));
}

export function mediaInteractiveDecodeConcurrency(physicalCpus: number): number {
  if (!Number.isFinite(physicalCpus) || physicalCpus < 1) return 1;
  return Math.min(
    MEDIA_INTERACTIVE_QUEUE_CONCURRENCY,
    Math.max(1, Math.trunc(physicalCpus)),
  );
}

/** Keep the claim wave larger than the live pool so workers do not idle. */
export function mediaDecodeWaveSize(concurrency: number): number {
  const pool = Math.max(1, Math.trunc(concurrency));
  return pool * 2;
}
