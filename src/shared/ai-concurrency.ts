/**
 * AI analysis parallelism (Serpent-opme).
 * Lane count for `ai.process-queue` and the provider semaphore share this cap
 * so we never start more in-flight vendor calls than the limiter allows.
 *
 * Override: SERPENT_AI_CONCURRENCY=1..16 (clamped).
 */
export const DEFAULT_AI_ANALYSIS_CONCURRENCY = 4;

export function resolveAiAnalysisConcurrency(
  raw: string | undefined = process.env.SERPENT_AI_CONCURRENCY,
): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_AI_ANALYSIS_CONCURRENCY;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_AI_ANALYSIS_CONCURRENCY;
  return Math.min(16, Math.max(1, Math.round(parsed)));
}
