import { describe, expect, it } from 'vitest';

import { requestTimeoutForCommand } from '../../src/main/worker-client';

describe('requestTimeoutForCommand', () => {
  it('allows browser capture to finish its bounded download before Main times out', () => {
    expect(requestTimeoutForCommand('extension.save-from-url')).toBe(5 * 60_000);
  });

  it('keeps ordinary requests on the short timeout', () => {
    expect(requestTimeoutForCommand('asset.list')).toBe(15_000);
  });

  it('gives AI queue processing a long timeout (Serpent-iokf)', () => {
    expect(requestTimeoutForCommand('ai.process-queue')).toBe(10 * 60_000);
    expect(requestTimeoutForCommand('asset.analyze')).toBe(10 * 60_000);
  });

  it('waits for all bounded request waves when a user lowers AI concurrency', () => {
    expect(requestTimeoutForCommand({
      type: 'ai.process-queue',
      libraryId: 'library-1',
      apiFormat: 'dashscope_native',
      model: 'qwen3-vl-plus',
      apiKey: 'ephemeral-key',
      enabledFields: { description: true, tags: true, rating: false },
      analysisSettings: {
        forceExistingTags: false,
        maxTags: 8,
        maxDescriptionCharsZh: 100,
        maxDescriptionWordsEn: 60,
        outputStyle: 'normal',
        ratingRubric: 'score 1-5',
        customDescriptionPrompt: '',
        customTagPrompt: '',
      },
      languages: ['zh-CN'],
      concurrencyLimit: 1,
      requestTimeoutMs: 120_000,
      maxAttempts: 3,
      maxJobs: 20,
    })).toBe(2_460_000);
  });
});
