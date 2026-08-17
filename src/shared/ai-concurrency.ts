/**
 * AI analysis parallelism (Serpent-opme).
 * Lane count for `ai.process-queue` and the provider semaphore share this cap
 * so we never start more in-flight vendor calls than the limiter allows.
 *
 * The persisted user preference is the production source of truth. The
 * environment override remains useful for isolated development and test runs.
 */
export const AI_ANALYSIS_CONCURRENCY_MIN = 1;
export const AI_ANALYSIS_CONCURRENCY_MAX = 32;
export const DEFAULT_AI_ANALYSIS_CONCURRENCY = 16;

/**
 * A scheduler run must fetch at least as many jobs as the largest supported
 * lane count. Otherwise a user setting above the scheduler batch size would
 * silently be capped before the worker can start all configured lanes.
 */
export const AI_ANALYSIS_QUEUE_BATCH_SIZE = AI_ANALYSIS_CONCURRENCY_MAX;

/** Normalize the persisted/UI setting without consulting process state. */
export function normalizeAiAnalysisConcurrency(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_AI_ANALYSIS_CONCURRENCY;
  }
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_ANALYSIS_CONCURRENCY;
  return Math.min(
    AI_ANALYSIS_CONCURRENCY_MAX,
    Math.max(AI_ANALYSIS_CONCURRENCY_MIN, Math.round(parsed)),
  );
}

export function resolveAiAnalysisConcurrency(
  raw: string | undefined = process.env.SERPENT_AI_CONCURRENCY,
): number {
  return normalizeAiAnalysisConcurrency(raw);
}
