import { fileExtensionLabel } from "./asset-card-badges";

/** GIF or video that can play in-place on the grid card. */
export function isCardHoverPreviewable(asset: {
  mediaType: "image" | "video" | "other";
  displayName: string;
  availability?: "available" | "missing";
  deletedAt?: string | null;
}): boolean {
  if (asset.deletedAt) return false;
  if (asset.availability === "missing") return false;
  if (asset.mediaType === "video") return true;
  return fileExtensionLabel(asset.displayName) === "GIF";
}

/**
 * At most one active card preview. Hover wins over primary selection when both
 * would qualify.
 */
export function resolveActivePreviewAssetId(input: {
  hoveredAssetId: string | null;
  primarySelectedAssetId: string | null | undefined;
  isPreviewable: (assetId: string) => boolean;
}): string | null {
  const { hoveredAssetId, primarySelectedAssetId, isPreviewable } = input;
  if (hoveredAssetId != null && isPreviewable(hoveredAssetId)) {
    return hoveredAssetId;
  }
  if (
    primarySelectedAssetId != null &&
    isPreviewable(primarySelectedAssetId)
  ) {
    return primarySelectedAssetId;
  }
  return null;
}

/** Static cover URL for a ready thumbnail artifact. */
export function coverSrc(
  libraryId: string,
  thumbnailArtifactId: string,
): string {
  return `serpent://preview/${libraryId}/${thumbnailArtifactId}`;
}
