import { describe, expect, it } from 'vitest';

import {
  linkedFolderNavAffordance,
  shouldShowMissingAssetOverlay,
} from '../../src/renderer/availability-affordance';

describe('availability affordance (Serpent-6nb)', () => {
  it('uses a plain folder icon for available linked folders', () => {
    expect(linkedFolderNavAffordance('available')).toEqual({ icon: 'folder' });
  });

  it('uses a gray disconnect icon only when the linked folder is offline', () => {
    expect(linkedFolderNavAffordance('offline')).toEqual({
      icon: 'link-off',
      iconColor: 'var(--tertiary)',
    });
  });

  it('shows the missing overlay only for missing assets', () => {
    expect(shouldShowMissingAssetOverlay('missing')).toBe(true);
    expect(shouldShowMissingAssetOverlay('available')).toBe(false);
  });
});
