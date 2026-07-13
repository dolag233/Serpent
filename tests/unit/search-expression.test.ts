import { describe, expect, it } from 'vitest';

import { parseSearchExpression } from '../../src/renderer/App';

describe('renderer search expression parser', () => {
  it('keeps a field-qualified quoted phrase together', () => {
    expect(parseSearchExpression('label:"hero concept"')).toEqual([
      { field: 'label', values: ['hero concept'], exclude: false },
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
