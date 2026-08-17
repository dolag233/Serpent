/**
 * Decoder / media-job concurrency derived from physical CPU core count.
 *
 * Reserve two physical cores for the OS, then one more for the Serpent
 * process that is already running this work, so the pool is at most
 * `physicalCpus - 3`. Never hard-code a thread count at call sites.
 */
export function mediaDecodeConcurrency(physicalCpus: number): number {
  if (!Number.isFinite(physicalCpus) || physicalCpus < 1) return 1;
  return Math.max(1, Math.trunc(physicalCpus) - 3);
}

/** Keep the claim wave larger than the live pool so workers do not idle. */
export function mediaDecodeWaveSize(concurrency: number): number {
  const pool = Math.max(1, Math.trunc(concurrency));
  return pool * 2;
}
