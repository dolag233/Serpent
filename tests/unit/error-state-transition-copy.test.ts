// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_ERROR_MESSAGES,
  type PublicErrorCode,
} from '../../src/shared/protocol/errors';
import { PUBLIC_ERROR_MESSAGES_ZH } from '../../src/renderer/error-utils';
import { messageForPublicError } from '../../src/renderer/error-utils';

/**
 * Serpent-50c466: the trash / restore / delete state conflicts used to fall back
 * to INVALID_IMPORT_DECISION, so the user read 「导入冲突处理选项无效」 for actions
 * that had nothing to do with imports. Each situation now has its own code, and
 * this suite pins the copy for both locales.
 */
const STATE_CONFLICT_CODES = [
  'ASSET_ALREADY_TRASHED',
  'ASSET_NOT_TRASHED',
  'ASSET_NOT_MANAGED',
  'INVALID_STATE_TRANSITION',
] as const satisfies readonly PublicErrorCode[];

describe('state-conflict error copy (Serpent-50c466)', () => {
  it.each(STATE_CONFLICT_CODES)('%s has English and zh-CN copy', (code) => {
    const english = PUBLIC_ERROR_MESSAGES[code];
    expect(english.length).toBeGreaterThan(0);
    const chinese = PUBLIC_ERROR_MESSAGES_ZH[code];
    expect(chinese, `missing zh-CN copy for ${code}`).toBeTruthy();
    expect(chinese).not.toBe(english);
  });

  it.each(STATE_CONFLICT_CODES)('%s resolves to its copy, not the fallback', (code) => {
    const zh = messageForPublicError({ code, message: PUBLIC_ERROR_MESSAGES[code] }, 'zh-CN', 'fallback');
    expect(zh).toBe(PUBLIC_ERROR_MESSAGES_ZH[code]);
    const en = messageForPublicError({ code, message: PUBLIC_ERROR_MESSAGES[code] }, 'en', 'fallback');
    expect(en).toBe(PUBLIC_ERROR_MESSAGES[code]);
  });

  it('never tells the user an unrelated import conflict happened', () => {
    for (const code of STATE_CONFLICT_CODES) {
      expect(PUBLIC_ERROR_MESSAGES_ZH[code]).not.toContain('导入');
      expect(PUBLIC_ERROR_MESSAGES[code].toLowerCase()).not.toContain('import conflict');
    }
  });
});
