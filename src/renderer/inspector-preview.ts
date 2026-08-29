import type { AssetSummary } from "../shared/asset-types";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { sourceSrc } from "./asset-card-hover-preview";

export function resolveInspectorPreviewSrc(
  asset: Pick<AssetSummary, "thumbnailStatus" | "thumbnailArtifactId">
    & Partial<
      Pick<
        AssetSummary,
        | "assetId"
        | "mediaType"
        | "availability"
        | "deletedAt"
        | "previewKind"
        | "previewRevisionId"
      >
    >,
  library: Pick<RendererLibrarySummary, "libraryId"> | null | undefined,
): string | null {
  if (
    asset.thumbnailStatus === "ready" &&
    asset.thumbnailArtifactId &&
    library
  ) {
    return `serpent://preview/${library.libraryId}/${asset.thumbnailArtifactId}`;
  }
  if (
    library
    && asset.assetId
    && asset.mediaType === "image"
    && asset.availability !== "missing"
    && !asset.deletedAt
    && asset.previewKind === "source"
    && asset.previewRevisionId
  ) {
    return sourceSrc(library.libraryId, asset.assetId, asset.previewRevisionId);
  }
  return null;
}
