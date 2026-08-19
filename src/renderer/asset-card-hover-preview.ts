import { fileExtensionLabel } from "./asset-card-badges";
import type { PreviewResolution } from "../shared/library-api";

/** GIF or video that can play in-place on the grid card via requestPreview. */
export function isCardHoverPreviewable(asset: {
  mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "other";
  displayName: string;
  availability?: "available" | "missing";
  deletedAt?: string | null;
  sequence?: { frameCount: number } | null;
}): boolean {
  if (asset.deletedAt) return false;
  if (asset.availability === "missing") return false;
  // Sequences animate from thumbnail artifacts in AssetCardMedia; do not also
  // request client preview (that stacks a second layer and flickers).
  if (asset.sequence && asset.sequence.frameCount >= 3) return false;
  if (asset.mediaType === "video") return true;
  // Audio plays in-place on hover (Serpent hover 音频工单).
  if (asset.mediaType === "audio") return true;
  return fileExtensionLabel(asset.displayName) === "GIF";
}

/** Whether the card should cycle sequence thumbnails on hover/selection. */
export function isCardSequencePlayable(asset: {
  availability?: "available" | "missing";
  sequence?: { frameCount: number } | null;
}): boolean {
  if (asset.availability === "missing") return false;
  return Boolean(asset.sequence && asset.sequence.frameCount >= 3);
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

/**
 * React identity for a card must include its library. Asset ids are only
 * unique inside a library, and preserving a key across a library switch can
 * leave a card component holding the previous library's media state.
 */
export function assetCardKey(
  libraryId: string | undefined,
  assetId: string,
): string {
  return `${libraryId ?? "no-library"}:${assetId}`;
}

/** Original-file URL used when the derived thumbnail is missing or failed. */
export function sourceSrc(libraryId: string, assetId: string): string {
  return `serpent://source/${libraryId}/${assetId}`;
}

export function resolveAssetCardCoverUrl(input: {
  libraryId: string | undefined;
  assetId: string;
  mediaType: "image" | "video" | "audio" | "text" | "model" | "document" | "other";
  availability?: "available" | "missing";
  deletedAt?: string | null;
  thumbnailStatus: "ready" | "pending" | "failed" | null;
  thumbnailArtifactId: string | null;
}): { url: string | null; usedSourceFallback: boolean } {
  const { libraryId } = input;
  if (!libraryId) return { url: null, usedSourceFallback: false };
  if (input.thumbnailStatus === "ready" && input.thumbnailArtifactId) {
    return {
      url: coverSrc(libraryId, input.thumbnailArtifactId),
      usedSourceFallback: false,
    };
  }
  return { url: null, usedSourceFallback: false };
}

export interface LivePreviewMedia {
  /** Playable URL, present only when this preview should actually render. */
  url: string | undefined;
  /** Which live element to render; `null` means fall back to the static cover. */
  kind: "gif" | "video" | "audio" | null;
}

/**
 * Decide which live media (if any) a hover/selection preview should render,
 * shared by the canvas card (`AssetCardMedia`) and the Inspector hero
 * (Serpent-a9n) so both use one tested rule: only an active, ready
 * resolution with a URL plays, and only images (GIFs) or videos are eligible
 * — anything else (including no active target, e.g. multi-selection) falls
 * back to the static cover/thumbnail.
 *
 * Serpent-azf6: an animated GIF resolved through its WebM proxy
 * (kind "webm_proxy", mediaType still "image") must render in a `<video>`
 * element — Chromium cannot decode video/webm inside `<img>` (crbug 791658
 * wontfix), so the proxy URL must take the video branch.
 */
export function resolveLivePreviewMedia(
  isActive: boolean,
  preview:
    | (Pick<PreviewResolution, "status" | "url" | "mediaType" | "posterUrl">
      & { kind?: PreviewResolution["kind"] })
    | null
    | undefined,
): LivePreviewMedia {
  const url = isActive && preview?.status === "ready" ? preview.url : undefined;
  if (!url) return { url: undefined, kind: null };
  if (preview?.kind === "webm_proxy") return { url, kind: "video" };
  if (preview?.mediaType === "image") return { url, kind: "gif" };
  if (preview?.mediaType === "video") return { url, kind: "video" };
  if (preview?.mediaType === "audio") return { url, kind: "audio" };
  return { url: undefined, kind: null };
}
