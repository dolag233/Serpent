import { describe, expect, it } from 'vitest';

import { importSummaryMessage } from '../../src/renderer/import-summary';

const zh = 'zh-CN';

describe('importSummaryMessage (Serpent-1y9r)', () => {
  it('counts a detected image sequence as one logical asset in the toast', () => {
    // 151 frame files collapse into 1 sequence asset: the toast must say
    // "新增 1 项", not "新增 151 项".
    const message = importSummaryMessage({
      importedCount: 151,
      assetCount: 1,
      skippedCount: 0,
      replacedCount: 0,
    }, zh);
    expect(message).toContain('1');
    expect(message).not.toContain('151');
  });

  it('falls back to importedCount when assetCount is absent (plain imports)', () => {
    const message = importSummaryMessage({
      importedCount: 3,
      skippedCount: 1,
      replacedCount: 0,
    }, zh);
    expect(message).toContain('3');
    expect(message).toContain('跳过');
  });
});
