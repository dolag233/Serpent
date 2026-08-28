type NativeDragAssetSummary = {
  readonly assetId: string;
  readonly sequence?: {
    readonly frames: readonly { readonly assetId: string }[];
  } | null;
};

type NativeDragAssetResult = {
  readonly ok: boolean;
  readonly type?: string;
  readonly assets?: unknown;
  readonly items?: unknown;
  readonly asset?: unknown;
  readonly completion?: unknown;
  readonly result?: unknown;
};

const ASSET_ARRAY_RESULT_TYPES = new Set([
  "asset.list",
  "collection.assets.list",
  "asset.list-trash",
  "asset.refreshed",
  "linked-folder.assets.copied",
  "linked-folder.converted",
  "asset.restored",
  "asset.moved",
  "asset.move-undone",
  "asset.trash-undone",
  "asset.copied",
  "asset.copy-undone",
  "asset.files-renamed",
  "asset.restored-if-original-vacant",
  "asset.relink-batch.applied",
]);

const ASSET_ITEM_RESULT_TYPES = new Set([
  "asset.search.result",
  "smart-collection.executed",
  "browse.session.opened",
  "browse.session.page",
]);

const SINGLE_ASSET_RESULT_TYPES = new Set([
  "asset.sequence.created",
  "asset.file-renamed",
  "asset.text.saved",
  "asset.relinked",
  "extension.asset-saved",
]);

function isNativeDragAssetSummary(value: unknown): value is NativeDragAssetSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { assetId?: unknown }).assetId === "string"
  );
}

function assetSummaryArray(value: unknown): readonly NativeDragAssetSummary[] {
  if (!Array.isArray(value)) return [];
  return value.every(isNativeDragAssetSummary)
    ? value
    : value.filter(isNativeDragAssetSummary);
}

function nestedAssetArray(value: unknown): readonly NativeDragAssetSummary[] {
  if (typeof value !== "object" || value === null) return [];
  return assetSummaryArray((value as { assets?: unknown }).assets);
}

/**
 * Return every card summary that Main can receive before native dragstart.
 * Browse sessions replaced the old search/list response for the main canvas,
 * while mutation/import responses use several other shapes. Keeping the
 * complete mapping centralized prevents any response rename or new result
 * shape from silently disabling native dragging again.
 */
export function nativeDragAssetsForResult(
  result: NativeDragAssetResult,
): readonly NativeDragAssetSummary[] {
  if (!result.ok) return [];
  const type = result.type ?? "";
  if (ASSET_ARRAY_RESULT_TYPES.has(type)) {
    return assetSummaryArray(result.assets);
  }
  if (ASSET_ITEM_RESULT_TYPES.has(type)) {
    return assetSummaryArray(result.items);
  }
  if (SINGLE_ASSET_RESULT_TYPES.has(type)) {
    return isNativeDragAssetSummary(result.asset) ? [result.asset] : [];
  }
  if (type === "asset.import.completed") {
    return nestedAssetArray(result.completion);
  }
  if (
    type === "asset.import-eagle.completed" ||
    type === "asset.import-billfish.completed"
  ) {
    return nestedAssetArray(result.result);
  }
  return [];
}
