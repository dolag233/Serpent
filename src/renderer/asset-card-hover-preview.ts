import { fileExtensionLabel } from "./asset-card-badges";
import type { PreviewResolution } from "../shared/library-api";

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

export interface LivePreviewMedia {
  /** Playable URL, present only when this preview should actually render. */
  url: string | undefined;
  /** Which live element to render; `null` means fall back to the static cover. */
  kind: "gif" | "video" | null;
}

/**
 * Decide which live media (if any) a hover/selection preview should render,
 * shared by the canvas card (`AssetCardMedia`) and the Inspector hero
 * (Serpent-a9n) so both use one tested rule: only an active, ready
 * resolution with a URL plays, and only images (GIFs) or videos are eligible
 * — anything else (including no active target, e.g. multi-selection) falls
 * back to the static cover/thumbnail.
 */
export function resolveLivePreviewMedia(
  isActive: boolean,
  preview:
    | Pick<PreviewResolution, "status" | "url" | "mediaType" | "posterUrl">
    | null
    | undefined,
): LivePreviewMedia {
  const url = isActive && preview?.status === "ready" ? preview.url : undefined;
  if (!url) return { url: undefined, kind: null };
  if (preview?.mediaType === "image") return { url, kind: "gif" };
  if (preview?.mediaType === "video") return { url, kind: "video" };
  return { url: undefined, kind: null };
}
