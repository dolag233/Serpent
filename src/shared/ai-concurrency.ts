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
