import { describe, expect, it } from 'vitest';

import { iconActionAttrs } from '../../src/renderer/icon-action-attrs';

describe('iconActionAttrs (REQ-SHELL-013)', () => {
  it('mirrors the label onto aria-label and data-hover-tip', () => {
    expect(iconActionAttrs('添加文件夹')).toEqual({
      'aria-label': '添加文件夹',
      'data-hover-tip': '添加文件夹',
    });
  });
});
