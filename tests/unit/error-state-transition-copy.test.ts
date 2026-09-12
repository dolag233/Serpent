// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { PUBLIC_ERROR_MESSAGES, type PublicErrorCode } from '../../src/shared/protocol/errors';
import { PUBLIC_ERROR_MESSAGES_ZH, messageForPublicError } from '../../src/renderer/error-utils';
import { en as enCatalog } from '../../src/renderer/i18n/catalogs/en';

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
  // Serpent-50c466 audit (2026-09-12): argument/selection guards got their own
  // code instead of borrowing the "state race" copy.
  'INVALID_SELECTION',
  'ASSET_STATE_CONFLICT',
  // Serpent-50c466 review (2026-09-12): content-level and settings-level causes.
  'ASSET_CONTENT_INVALID',
  'IMPORT_AWAITING_DECISION',
  'AI_SETTINGS_INCOMPLETE',
] as const satisfies readonly PublicErrorCode[];

/** Codes the audit moved off INVALID_IMPORT_DECISION onto existing codes. */
const REUSED_CODES = [
  'INVALID_SMART_COLLECTION_QUERY',
  'INVALID_FOLDER_NAME',
  'ASSET_FILE_NAME_CONFLICT',
  'LIBRARY_IO_ERROR',
  'AI_ANALYSIS_FAILED',
  'FOLDER_NOT_FOUND',
  'UNSUPPORTED_MEDIA_TYPE',
  'CONFIRMATION_REQUIRED',
] as const satisfies readonly PublicErrorCode[];

const zhFor = (code: PublicErrorCode) =>
  PUBLIC_ERROR_MESSAGES_ZH[code] ??
  messageForPublicError({ code, message: PUBLIC_ERROR_MESSAGES[code] }, 'zh-CN');

/**
 * The English catalog owns the UI wording. Assert the catalog text itself (the
 * review's F18): accepting the protocol string too would hide drift between what
 * the user reads and what the wire carries. The protocol rule is covered by the
 * schema refinement in `errors.ts` and its own tests.
 */
const enFor = (code: PublicErrorCode): string => {
  const catalog = (enCatalog.error.code as Partial<Record<PublicErrorCode, string>>)[code];
  expect(catalog, `missing en catalog copy for ${code}`).toBeTruthy();
  return catalog!;
};

describe('state-conflict error copy (Serpent-50c466)', () => {
  it.each(STATE_CONFLICT_CODES)('%s has English and zh-CN copy', (code) => {
    const english = PUBLIC_ERROR_MESSAGES[code];
    expect(english.length).toBeGreaterThan(0);
    const chinese = PUBLIC_ERROR_MESSAGES_ZH[code];
    expect(chinese, `missing zh-CN copy for ${code}`).toBeTruthy();
    expect(chinese).not.toBe(english);
  });

  it.each([...STATE_CONFLICT_CODES, ...REUSED_CODES])(
    '%s resolves to its copy, not the fallback',
    (code) => {
      const zh = messageForPublicError(
        { code, message: PUBLIC_ERROR_MESSAGES[code] },
        'zh-CN',
        'fallback',
      );
      expect(zh).toBe(zhFor(code));
      const en = messageForPublicError(
        { code, message: PUBLIC_ERROR_MESSAGES[code] },
        'en',
        'fallback',
      );
      expect(en).toBe(enFor(code));
    },
  );

  // Serpent-50c466 audit §5.3: the user sees code + reason composed by
  // error.withReason — pin the whole sentence, not just the code.
  it('composes the image-sequence reason into the sentence the user reads', () => {
    expect(
      messageForPublicError(
        {
          code: 'INVALID_SELECTION',
          message: PUBLIC_ERROR_MESSAGES.INVALID_SELECTION,
          reason: 'IMAGE_SEQUENCE_SELECTION',
        },
        'zh-CN',
      ),
    ).toBe(
      '所选内容不适用于这项操作。请重新选择，或刷新列表后重试。 原因：创建序列图需要同一文件夹内、文件名按编号连续的一组图片（至少 3 张）。',
    );
  });

  it('composes the permanent-delete reason into the sentence the user reads', () => {
    expect(
      messageForPublicError(
        {
          code: 'ASSET_NOT_TRASHED',
          message: PUBLIC_ERROR_MESSAGES.ASSET_NOT_TRASHED,
          reason: 'PERMANENT_DELETE_NEEDS_TRASH',
        },
        'zh-CN',
      ),
    ).toBe(
      '该资产不在回收站里，可能已经被恢复。请刷新回收站列表后重试。 原因：永久删除只对回收站里的资产生效：请先把它移入回收站。',
    );
  });

  it('never tells the user an unrelated import conflict happened', () => {
    // IMPORT_AWAITING_DECISION really is about an import, so it is the one code
    // where import wording is truthful.
    const importWordingIsTruthful = new Set<PublicErrorCode>(['IMPORT_AWAITING_DECISION']);
    for (const code of [...STATE_CONFLICT_CODES, ...REUSED_CODES]) {
      if (importWordingIsTruthful.has(code)) continue;
      expect(PUBLIC_ERROR_MESSAGES_ZH[code] ?? '').not.toContain('导入');
      expect(enFor(code).toLowerCase()).not.toContain('import');
    }
  });

  it('keeps the state-race copy out of the selection-guard code', () => {
    expect(zhFor('INVALID_SELECTION')).toContain('请重新选择');
    expect(zhFor('INVALID_SELECTION')).not.toContain('另一个窗口');
    expect(zhFor('INVALID_STATE_TRANSITION')).toContain('另一个窗口');
  });

  it('states the real cause for unsupported content and pending decisions', () => {
    // Review F3: the file type is supported, its content is not text.
    expect(zhFor('ASSET_CONTENT_INVALID')).toContain('内容不是文本');
    // Review F4: the import waits on the user, not on another window.
    expect(zhFor('IMPORT_AWAITING_DECISION')).toContain('等你决定');
    expect(zhFor('IMPORT_AWAITING_DECISION')).not.toContain('另一个窗口');
    // Review F7: saving AI settings is not a failed analysis.
    expect(zhFor('AI_SETTINGS_INCOMPLETE')).toContain('自动分析还没开启');
  });
});
