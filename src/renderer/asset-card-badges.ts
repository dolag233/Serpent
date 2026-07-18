/** Corner labels for grid cards (Eagle-style type + duration chips). */

export function fileExtensionLabel(displayName: string): string {
  const value = displayName.split(".").pop();
  return value && value !== displayName ? value.slice(0, 5).toUpperCase() : "FILE";
}

/**
 * Bottom-right type chip: GIF / VIDEO only.
 * Still images stay unmarked so the grid does not fill with JPG/PNG noise.
 */
export function assetTypeBadgeLabel(
  mediaType: "image" | "video" | "audio" | "text" | "other",
  displayName: string,
): string | null {
  const ext = fileExtensionLabel(displayName);
  if (ext === "GIF") return "GIF";
  if (mediaType === "video") return "VIDEO";
  if (mediaType === "audio") return "AUDIO";
  if (mediaType === "text") return "TEXT";
  return null;
}

export function shouldShowDurationBadge(
  mediaType: "image" | "video" | "audio" | "text" | "other",
  displayName: string,
  durationMs: number | null | undefined,
): boolean {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return false;
  }
  if (mediaType === "video" || mediaType === "audio") return true;
  return fileExtensionLabel(displayName) === "GIF";
}
