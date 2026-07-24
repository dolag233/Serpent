/**
 * Whether Serpent should generate or surface raster thumbnail failures for an
 * asset. Text and most `other` formats only show the generic file icon; EXR/TGA
 * are the OIIO-backed exceptions.
 */

export type ThumbnailSupportMediaType =
  | "image"
  | "video"
  | "audio"
  | "text"
  | "other";

export function assetSupportsThumbnail(asset: {
  mediaType: ThumbnailSupportMediaType;
  displayName: string;
}): boolean {
  if (asset.mediaType === "text") return false;
  if (asset.mediaType !== "other") return true;
  const lower = asset.displayName.toLowerCase();
  return lower.endsWith(".exr") || lower.endsWith(".tga");
}

/** Error codes that mean "no thumbnail expected" rather than a user-actionable failure. */
export function isBenignThumbnailErrorCode(errorCode: string | undefined): boolean {
  return errorCode === "UNSUPPORTED_FORMAT";
}
