import type { AssetSummary } from "../shared/asset-types";

export function shouldShowThumbnailFailureBadge(
  _asset: Pick<AssetSummary, "mediaType" | "displayName" | "thumbnailStatus">,
  _hasFailureRecord: boolean,
): boolean {
  void _asset;
  void _hasFailureRecord;
  return false;
}
