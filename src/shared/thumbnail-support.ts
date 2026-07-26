/**
 * Whether Serpent should generate or surface raster thumbnail failures for an
 * asset. Text and unknown `other` formats show the generic file icon. Supported
 * image formats are categorized as `image` even when their preview must first
 * be derived by OIIO, so every supported image receives the same card and
 * Inspector thumbnail treatment.
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
  return asset.mediaType !== "other";
}

/** Error codes that mean "no thumbnail expected" rather than a user-actionable failure. */
export function isBenignThumbnailErrorCode(errorCode: string | undefined): boolean {
  return errorCode === "UNSUPPORTED_FORMAT";
}
