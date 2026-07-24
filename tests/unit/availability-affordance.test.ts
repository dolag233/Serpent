import { describe, expect, it } from 'vitest';

import {
  linkedFolderHoverDetail,
  linkedFolderNavAffordance,
  missingAssetAffordance,
  shouldShowMissingAssetOverlay,
} from '../../src/renderer/availability-affordance';

describe('availability affordance (Serpent-rc9)', () => {
  it('uses a link icon for available linked folders', () => {
    expect(linkedFolderNavAffordance('available')).toEqual({
      icon: 'link',
      iconColor: 'var(--secondary)',
    });
  });

  it('uses a gray disconnect icon when the linked folder is offline', () => {
    expect(linkedFolderNavAffordance('offline')).toEqual({
      icon: 'link-off',
      iconColor: 'var(--tertiary)',
    });
  });

  it('includes the original path in the hover detail', () => {
    expect(
      linkedFolderHoverDetail('available', '/Volumes/Art/refs', {
        online: '链接文件夹',
        offline: '离线',
        pathLabel: '原路径',
      }),
    ).toBe('链接文件夹\n原路径: /Volumes/Art/refs');
  });

  it('shows the missing overlay only for missing assets', () => {
    expect(shouldShowMissingAssetOverlay('missing')).toBe(true);
    expect(shouldShowMissingAssetOverlay('available')).toBe(false);
  });

  it('reuses the offline linked-folder disconnect affordance for missing assets', () => {
    expect(missingAssetAffordance()).toEqual(linkedFolderNavAffordance('offline'));
  });
});
