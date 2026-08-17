import type { AssetMetadataResult, AssetSummary } from "../shared/asset-types";

/**
 * The Inspector can paint these fields before its heavier metadata request
 * returns. The result is display-only until the real metadata identity lands.
 */
export function buildInspectorSummaryMetadata(
  asset: Pick<AssetSummary, "assetId" | "rating" | "favorite" | "modifiedAt">,
): AssetMetadataResult {
  return {
    assetId: asset.assetId,
    description: null,
    rating: asset.rating,
    favorite: asset.favorite,
    palette: null,
    automaticPalette: [],
    effectivePalette: [],
    paletteSource: null,
    sourcePageUrl: null,
    author: null,
    tags: [],
    entityVersion: 0,
    updatedAt: asset.modifiedAt,
  };
}
