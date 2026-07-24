import type { AssetSummary } from "../shared/asset-types";
import { assetSupportsThumbnail } from "../shared/thumbnail-support";

export function shouldShowThumbnailFailureBadge(
  asset: Pick<AssetSummary, "mediaType" | "displayName" | "thumbnailStatus">,
  hasFailureRecord: boolean,
): boolean {
  if (!hasFailureRecord) return false;
  if (asset.thumbnailStatus === "ready") return false;
  return assetSupportsThumbnail(asset);
}
