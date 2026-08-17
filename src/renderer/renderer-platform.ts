export type RendererPlatform = "macos" | "windows" | "other";

export function resolveRendererPlatform(userAgent: string): RendererPlatform {
  if (/\b(?:Windows|Win32|Win64)\b/iu.test(userAgent)) return "windows";
  if (/\b(?:Macintosh|Mac OS X)\b/iu.test(userAgent)) return "macos";
  return "other";
}

export function applyRendererPlatform(
  root: Pick<HTMLElement, "dataset">,
  userAgent: string,
): RendererPlatform {
  const platform = resolveRendererPlatform(userAgent);
  root.dataset.platform = platform;
  return platform;
}
