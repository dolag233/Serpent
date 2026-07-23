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
  cancelled: number;
  skipped: number;
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
    cancelled: 0,
    skipped: 0,
    running: counters.running,
    queued: counters.queued,
    ratio,
  };
}

/**
 * Progress for one explicit user action. Queue-wide counters intentionally do
 * not participate: they include completed jobs from earlier actions and jobs
 * created by background automation.
 */
export function computeAiBatchProgressForJobs(
  jobIds: readonly string[],
  jobs: ReadonlyArray<{
    jobId: string;
    status: "queued" | "running" | "paused" | "succeeded" | "failed" | "cancelled";
  }>,
  options: { skipped?: number } = {},
): AiBatchProgressSnapshot {
  const batchJobIds = new Set(jobIds);
  let queued = 0;
  let running = 0;
  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;

  for (const job of jobs) {
    if (!batchJobIds.has(job.jobId)) continue;
    switch (job.status) {
      case "queued":
      case "paused":
        queued++;
        break;
      case "running":
        running++;
        break;
      case "succeeded":
        succeeded++;
        break;
      case "failed":
        failed++;
        break;
      case "cancelled":
        cancelled++;
        break;
    }
  }

  const skipped = Math.max(0, options.skipped ?? 0);
  const batchTotal = batchJobIds.size + skipped;
  const done = succeeded + failed + cancelled + skipped;
  return {
    batchTotal,
    done: Math.min(done, batchTotal),
    succeeded,
    failed,
    cancelled,
    skipped,
    running,
    queued,
    ratio: batchTotal > 0 ? Math.min(1, done / batchTotal) : null,
  };
}

/** Whether a panel cancellation targets any job in the active user batch. */
export function cancellationAffectsAiBatch(
  activeJobIds: readonly string[],
  cancelledJobIds?: readonly string[],
): boolean {
  return !cancelledJobIds || cancelledJobIds.some((jobId) => activeJobIds.includes(jobId));
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
