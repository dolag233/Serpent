import type { AssetSummary } from "../shared/asset-types";

export function shouldShowThumbnailFailureBadge(
  _asset: Pick<AssetSummary, "mediaType" | "displayName" | "thumbnailStatus">,
  _hasFailureRecord: boolean,
  _usedSourceFallback = false,
): boolean {
  return false;
}
