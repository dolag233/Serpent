const BAKEABLE_STILL_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".jfif",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
  ".avif",
]);

/** Still images whose pixels can be rotated and written back as the same format. */
export function isBakeableStillImageFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return false;
  return BAKEABLE_STILL_IMAGE_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}
