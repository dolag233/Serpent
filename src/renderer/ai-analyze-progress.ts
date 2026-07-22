/**
 * Batch AI analysis progress helpers (Serpent-k3dw / iokf).
 * Keeps determinate progress math out of App.tsx.
 */

export interface AiQueueCounters {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
}

export interface AiBatchProgressSnapshot {
  /** Assets enqueued for this user-started batch (0 when unknown). */
  batchTotal: number;
  done: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  /** 0–1 when batchTotal > 0; otherwise null (indeterminate). */
  ratio: number | null;
}

export function computeAiBatchProgress(
  batchTotal: number,
  baseline: { succeeded: number; failed: number },
  counters: AiQueueCounters,
): AiBatchProgressSnapshot {
  const succeeded = Math.max(0, counters.succeeded - baseline.succeeded);
  const failed = Math.max(0, counters.failed - baseline.failed);
  const done = succeeded + failed;
  const total = Math.max(0, batchTotal);
  const ratio =
    total > 0 ? Math.min(1, Math.max(0, done / total)) : null;
  return {
    batchTotal: total,
    done: Math.min(done, total > 0 ? total : done),
    succeeded,
    failed,
    running: counters.running,
    queued: counters.queued,
    ratio,
  };
}

/** Distinct recent failure codes for toast summary (stable order). */
export function collectRecentAiFailureCodes(
  jobs: ReadonlyArray<{ status: string; errorCode: string | null }>,
  limit = 3,
): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const job of jobs) {
    if (job.status !== "failed" || !job.errorCode) continue;
    if (seen.has(job.errorCode)) continue;
    seen.add(job.errorCode);
    codes.push(job.errorCode);
    if (codes.length >= limit) break;
  }
  return codes;
}

/**
 * Infer batch total for auto-analyze after import when no explicit user batch
 * was recorded (Serpent-qabe).
 */
export function inferAutoAnalyzeBatchTotal(
  explicitBatchTotal: number,
  counters: AiQueueCounters,
  baseline: { succeeded: number; failed: number },
): number {
  if (explicitBatchTotal > 0) return explicitBatchTotal;
  const inFlight = counters.queued + counters.running;
  if (inFlight <= 0) return 0;
  const done = Math.max(
    0,
    counters.succeeded -
      baseline.succeeded +
      (counters.failed - baseline.failed),
  );
  return inFlight + done;
}
