import { describe, expect, it } from 'vitest';

import {
  disconnectedMenuHint,
  saveMenuTitle,
} from '../../extension/connection-ui';

describe('extension connection menu copy', () => {
  it('labels the save menu by connection state', () => {
    expect(saveMenuTitle(true)).toBe('保存到 Serpent');
    expect(saveMenuTitle(false)).toBe('保存到 Serpent（未连接）');
  });

  it('explains how to reconnect when offline', () => {
    expect(disconnectedMenuHint()).toContain('Serpent');
  });
});
