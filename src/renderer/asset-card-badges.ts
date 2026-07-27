/**
 * Grid corner badges (type / duration / source folder / extension).
 * Tiny cards hide all badges (Serpent-7zt).
 *
 * Layout (Serpent-i07 / CANVAS-025):
 * - Bottom-left: duration
 * - Bottom-right: extension (non-images); type chip only when no extension
 *   (e.g. GIF). Still images never show an extension chip.
 */

export const ASSET_CARD_BADGE_MIN_SIZE = 140;

export function shouldShowAssetCardBadges(cardSize: number): boolean {
  return Number.isFinite(cardSize) && cardSize >= ASSET_CARD_BADGE_MIN_SIZE;
}

/** Corner labels for grid cards (Eagle-style type + duration chips). */

export function fileExtensionLabel(displayName: string): string {
  const value = displayName.split(".").pop();
  return value && value !== displayName ? value.slice(0, 5).toUpperCase() : "FILE";
}

/**
 * Bottom-right type chip when extension is not shown: GIF / VIDEO / TEXT.
 * Audio uses the extension chip (MP3) at bottom-right instead of "AUDIO".
 * Still images stay unmarked so the grid does not fill with JPG/PNG noise.
 */
export function assetTypeBadgeLabel(
  mediaType: "image" | "video" | "audio" | "text" | "other",
  displayName: string,
): string | null {
  const ext = fileExtensionLabel(displayName);
  if (ext === "GIF") return "GIF";
  if (mediaType === "video") return "VIDEO";
  if (mediaType === "text") return "TEXT";
  return null;
}

/**
 * Bottom-right extension chip for non-image assets (Serpent-i07).
 * Images never show an extension corner badge.
 */
export function shouldShowExtensionBadge(
  mediaType: "image" | "video" | "audio" | "text" | "other",
): boolean {
  return mediaType !== "image";
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

/** Display duration for an image sequence using its frame count and FPS. */
export function formatSequenceDuration(
  frameCount: number,
  fps: number,
): string {
  if (
    !Number.isFinite(frameCount) ||
    frameCount <= 0 ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    return "0.00s";
  }
  const totalSeconds = frameCount / fps;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds < 10 ? 2 : 1)}s`;
  }
  const totalSecondsRounded = Math.round(totalSeconds);
  const hours = Math.floor(totalSecondsRounded / 3_600);
  const minutes = Math.floor((totalSecondsRounded % 3_600) / 60);
  const seconds = totalSecondsRounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Type chip shares bottom-right with extension — prefer extension when both
 * would show (video MP4 beats generic VIDEO).
 */
export function shouldShowTypeBadgeAlongsideExtension(
  showingExtension: boolean,
): boolean {
  return !showingExtension;
}
