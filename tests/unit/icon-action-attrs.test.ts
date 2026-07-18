import { describe, expect, it } from 'vitest';

import { iconActionAttrs } from '../../src/renderer/icon-action-attrs';

describe('iconActionAttrs (REQ-SHELL-013)', () => {
  it('mirrors the label onto aria-label, data-tooltip, and title', () => {
    expect(iconActionAttrs('添加文件夹')).toEqual({
      'aria-label': '添加文件夹',
      'data-tooltip': '添加文件夹',
      title: '添加文件夹',
    });
    expect(iconActionAttrs('Import linked folder')).toEqual({
      'aria-label': 'Import linked folder',
      'data-tooltip': 'Import linked folder',
      title: 'Import linked folder',
    });
  });
});
