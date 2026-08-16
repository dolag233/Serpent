import type { IconName } from './Icons';
import type { AssetSummary } from '../shared/asset-types';

/**
 * Serpent-rc9: linked folders always show a link glyph (online or offline).
 * Offline uses the disconnect icon + muted color.
 */
export function linkedFolderNavAffordance(status: string): {
  readonly icon: IconName;
  readonly iconColor?: string;
} {
  if (status === 'offline') {
    return { icon: 'link-off', iconColor: 'var(--tertiary)' };
  }
  return { icon: 'link', iconColor: 'var(--secondary)' };
}

/** Tooltip body for a linked folder row (name handled by NavRow). */
export function linkedFolderHoverDetail(
  status: string,
  absoluteRootPath: string | null | undefined,
  copy: { online: string; offline: string; pathLabel: string },
): string {
  const base = status === 'offline' ? copy.offline : copy.online;
  const path = absoluteRootPath?.trim();
  if (!path) return base;
  return `${base}\n${copy.pathLabel}: ${path}`;
}

export function shouldShowMissingAssetOverlay(availability: string): boolean {
  return availability === 'missing';
}

/**
 * A missing asset whose revision row disappeared is different from an
 * ordinary offline file. The Worker keeps this row visible with a synthetic
 * `corrupt:<assetId>` revision id until refreshManagedAssets can rebuild it.
 */
export function isCorruptAsset(
  asset: Pick<AssetSummary, 'availability' | 'currentRevisionId'>,
): boolean {
  return (
    asset.availability === 'missing' &&
    asset.currentRevisionId.startsWith('corrupt:')
  );
}

/** Cracked-file affordance for a source that is no longer available. */
export function missingAssetAffordance(): {
  readonly icon: IconName;
  readonly iconColor: string;
} {
  return {
    icon: 'broken-file',
    iconColor: 'var(--danger)',
  };
}

/** Cracked-file affordance for a damaged database row or unreadable revision. */
export function corruptAssetAffordance(): {
  readonly icon: IconName;
  readonly iconColor: string;
} {
  return {
    icon: 'broken-file',
    iconColor: 'var(--warning)',
  };
}
