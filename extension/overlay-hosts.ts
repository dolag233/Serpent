const OVERLAY_HOST_SUFFIXES = [
  'pinterest.com',
  'pin.it',
  'behance.net',
  'behance.com',
  'google.com',
  'google.com.hk',
  'google.co.jp',
  'google.co.uk',
] as const;

export function isOverlayHostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  return OVERLAY_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

export function shouldUseOverlayMenu(
  target: Element | null,
  hostname: string,
): boolean {
  if (isOverlayHostHostname(hostname)) return true;
  if (!target) return false;
  if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement) {
    return false;
  }
  return true;
}
