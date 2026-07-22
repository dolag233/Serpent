export interface AiReliabilitySettings {
  /** Per non-streaming model request. Does not include time spent waiting in the queue. */
  requestTimeoutMs: number;
  /** Total attempts, including the first attempt. */
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  /** Symmetric random delay around the exponential backoff, from 0 to 0.5. */
  retryJitterRatio: number;
}

export const DEFAULT_AI_RELIABILITY_SETTINGS: AiReliabilitySettings = {
  requestTimeoutMs: 120_000,
  maxAttempts: 3,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 30_000,
  retryJitterRatio: 0.2,
};

function integerInRange(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function ratioInRange(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(0.5, Math.max(0, value));
}

/**
 * Accepts old / hand-edited config files without allowing an unbounded retry
 * loop or a request timeout short enough to create a failure storm.
 */
export function normalizeAiReliabilitySettings(
  value: unknown,
): AiReliabilitySettings {
  const source = value && typeof value === 'object'
    ? value as Partial<AiReliabilitySettings>
    : {};
  const retryBaseDelayMs = integerInRange(
    source.retryBaseDelayMs,
    DEFAULT_AI_RELIABILITY_SETTINGS.retryBaseDelayMs,
    100,
    60_000,
  );
  const retryMaxDelayMs = integerInRange(
    source.retryMaxDelayMs,
    DEFAULT_AI_RELIABILITY_SETTINGS.retryMaxDelayMs,
    1_000,
    600_000,
  );
  return {
    requestTimeoutMs: integerInRange(
      source.requestTimeoutMs,
      DEFAULT_AI_RELIABILITY_SETTINGS.requestTimeoutMs,
      15_000,
      600_000,
    ),
    maxAttempts: integerInRange(
      source.maxAttempts,
      DEFAULT_AI_RELIABILITY_SETTINGS.maxAttempts,
      1,
      10,
    ),
    retryBaseDelayMs: Math.min(retryBaseDelayMs, retryMaxDelayMs),
    retryMaxDelayMs: Math.max(retryBaseDelayMs, retryMaxDelayMs),
    retryJitterRatio: ratioInRange(
      source.retryJitterRatio,
      DEFAULT_AI_RELIABILITY_SETTINGS.retryJitterRatio,
    ),
  };
}
