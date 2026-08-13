/**
 * Decoder / media-job concurrency derived from logical CPU count.
 *
 * Reserve 2 logical processors for the OS, then one more for the Serpent
 * process that is already running this work, so the pool is at most
 * `logicalCpus - 3`. Never hard-code a thread count at call sites.
 */
export function mediaDecodeConcurrency(logicalCpus: number): number {
  if (!Number.isFinite(logicalCpus) || logicalCpus < 1) return 1;
  return Math.max(1, Math.trunc(logicalCpus) - 3);
}

/** Keep the claim wave larger than the live pool so workers do not idle. */
export function mediaDecodeWaveSize(concurrency: number): number {
  const pool = Math.max(1, Math.trunc(concurrency));
  return pool * 2;
}
