import { describe, expect, it } from 'vitest';

import {
  corruptAssetAffordance,
  isCorruptAsset,
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

  it('uses a cracked-file affordance for missing assets', () => {
    expect(missingAssetAffordance()).toEqual({
      icon: 'broken-file',
      iconColor: 'var(--danger)',
    });
  });

  it('distinguishes a dangling revision row from an ordinary missing file', () => {
    expect(
      isCorruptAsset({
        availability: 'missing',
        currentRevisionId: 'corrupt:asset-1',
      }),
    ).toBe(true);
    expect(
      isCorruptAsset({
        availability: 'missing',
        currentRevisionId: 'revision-1',
      }),
    ).toBe(false);
    expect(
      isCorruptAsset({
        availability: 'available',
        currentRevisionId: 'corrupt:asset-2',
      }),
    ).toBe(false);
  });

  it('uses a warning-colored cracked-file affordance for damaged rows', () => {
    expect(corruptAssetAffordance()).toEqual({
      icon: 'broken-file',
      iconColor: 'var(--warning)',
    });
  });
});
