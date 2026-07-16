import type { AssetSummary } from "../shared/asset-types";
import type { RendererLibrarySummary } from "../shared/protocol/responses";

export function resolveInspectorPreviewSrc(
  asset: Pick<AssetSummary, "thumbnailStatus" | "thumbnailArtifactId">,
  library: Pick<RendererLibrarySummary, "libraryId"> | null | undefined,
): string | null {
  if (
    asset.thumbnailStatus === "ready" &&
    asset.thumbnailArtifactId &&
    library
  ) {
    return `serpent://preview/${library.libraryId}/${asset.thumbnailArtifactId}`;
  }
  return null;
}
