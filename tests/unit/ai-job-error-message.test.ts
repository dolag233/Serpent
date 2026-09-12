// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { messageForAiErrorCode, summarizeAiFailureCodes } from '../../src/renderer/ai-job-error-message';
import { PUBLIC_ERROR_MESSAGES } from '../../src/shared/protocol/errors';
import { PUBLIC_ERROR_MESSAGES_ZH } from '../../src/renderer/error-utils';

/**
 * Serpent-50c466 review F9: `jobs.error_code` can hold a *public error code*
 * (the Worker refuses a thumbnail for an unsupported media type and the AI
 * image-input path rethrows it). Only `error.reason.*` used to be looked up, so
 * the AI-failure dialog showed the bare identifier `UNSUPPORTED_MEDIA_TYPE`.
 */
describe('AI job failure messages (Serpent-50c466 review F9)', () => {
  it('renders a public error code through its code copy instead of the raw id', () => {
    const zh = messageForAiErrorCode('UNSUPPORTED_MEDIA_TYPE', 'zh-CN');
    expect(zh).toBe(PUBLIC_ERROR_MESSAGES_ZH.UNSUPPORTED_MEDIA_TYPE);
    expect(zh).not.toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(zh).not.toContain('UNSUPPORTED_MEDIA_TYPE');

    const en = messageForAiErrorCode('UNSUPPORTED_MEDIA_TYPE', 'en');
    expect(en.length).toBeGreaterThan(0);
    expect(en).not.toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('still prefers a reason entry when one exists', () => {
    // A known reason key keeps its specific wording.
    expect(messageForAiErrorCode('UNSUPPORTED_FORMAT', 'zh-CN')).not.toBe('UNSUPPORTED_FORMAT');
  });

  it('falls back to the raw identifier only when nothing matches', () => {
    expect(messageForAiErrorCode('NOT_A_REAL_CODE_ANYWHERE', 'zh-CN')).toBe('NOT_A_REAL_CODE_ANYWHERE');
  });

  it('summarizes several codes for the blocking dialog', () => {
    const summary = summarizeAiFailureCodes(['UNSUPPORTED_MEDIA_TYPE', 'AI_NOT_CONFIGURED'], 'zh-CN');
    expect(summary).toContain(PUBLIC_ERROR_MESSAGES_ZH.UNSUPPORTED_MEDIA_TYPE!);
    expect(summary).not.toContain('UNSUPPORTED_MEDIA_TYPE');
    expect(PUBLIC_ERROR_MESSAGES.UNSUPPORTED_MEDIA_TYPE.length).toBeGreaterThan(0);
  });
});
