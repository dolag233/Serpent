import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AI_RELIABILITY_SETTINGS,
  normalizeAiReliabilitySettings,
} from '../../src/shared/ai-reliability';

describe('AI reliability settings', () => {
  it('uses conservative bounded defaults for non-streaming asset analysis', () => {
    expect(DEFAULT_AI_RELIABILITY_SETTINGS).toEqual({
      requestTimeoutMs: 120_000,
      maxAttempts: 3,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 30_000,
      retryJitterRatio: 0.2,
    });
  });

  it('normalizes malformed and out-of-range persisted values independently', () => {
    expect(normalizeAiReliabilitySettings({
      requestTimeoutMs: 5_000,
      maxAttempts: 99,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 9_999_999,
      retryJitterRatio: -1,
    })).toEqual({
      requestTimeoutMs: 15_000,
      maxAttempts: 10,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 600_000,
      retryJitterRatio: 0,
    });
  });
});
