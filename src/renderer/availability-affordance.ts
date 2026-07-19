import type { IconName } from './Icons';

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
