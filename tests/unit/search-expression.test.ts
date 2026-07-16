import { describe, expect, it } from 'vitest';

import { formatDuration, parseNumericRange, parseSearchExpression } from '../../src/renderer/App';

describe('renderer search expression parser', () => {
  it('keeps a field-qualified quoted phrase together', () => {
    expect(parseSearchExpression('filename:"hero concept"')).toEqual([
      { field: 'filename', values: ['hero concept'], exclude: false },
    ]);
  });

  it('supports NOT and same-field OR syntax', () => {
    expect(parseSearchExpression('tags:角色 OR tags:道具 NOT tags:草图')).toEqual([
      { field: 'tags', values: ['角色', '道具'], exclude: false },
      { field: 'tags', values: ['草图'], exclude: true },
    ]);
  });

  it('supports concise minus and comma syntax', () => {
    expect(parseSearchExpression('-folder_path:archive tags:角色,道具')).toEqual([
      { field: 'folder_path', values: ['archive'], exclude: true },
      { field: 'tags', values: ['角色', '道具'], exclude: false },
    ]);
  });
});

describe('renderer technical metadata formatting', () => {
  it('formats media duration for humans', () => {
    expect(formatDuration(5_000)).toBe('0:05');
    expect(formatDuration(65_999)).toBe('1:05');
    expect(formatDuration(3_665_000)).toBe('1:01:05');
  });

  it('creates scaled numeric ranges without string comparison syntax', () => {
    expect(parseNumericRange('1.5', '30', 1_000)).toEqual({ min: 1_500, max: 30_000 });
    expect(parseNumericRange('1.7', '1.8', 1, false)).toEqual({ min: 1.7, max: 1.8 });
    expect(parseNumericRange('', '')).toBeNull();
    expect(parseNumericRange('20', '10')).toBeNull();
  });
});
