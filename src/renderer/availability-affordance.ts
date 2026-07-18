import type { IconName } from './Icons';

/**
 * Serpent-6nb: only unavailable states get a distinctive icon.
 * Healthy linked folders look like managed folders (no accent link glyph).
 */
export function linkedFolderNavAffordance(status: string): {
  readonly icon: IconName;
  readonly iconColor?: string;
} {
  if (status === 'offline') {
    return { icon: 'link-off', iconColor: 'var(--tertiary)' };
  }
  return { icon: 'folder' };
}

export function shouldShowMissingAssetOverlay(availability: string): boolean {
  return availability === 'missing';
}
