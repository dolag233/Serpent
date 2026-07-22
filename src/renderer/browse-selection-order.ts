/**
 * Unified browse canvas selection order (Serpent-qi05).
 *
 * Folder cards render before the asset grid; Shift+click range selection must
 * follow that visual order across both kinds instead of slicing each list alone.
 */

export type BrowseSelectionKind = 'folder' | 'asset';

export type BrowseSelectionItem = {
  readonly kind: BrowseSelectionKind;
  readonly id: string;
};

export type BrowseSelectionAnchor = BrowseSelectionItem;

export function buildBrowseSelectionOrder(
  folderIds: readonly string[],
  assetIds: readonly string[],
): BrowseSelectionItem[] {
  return [
    ...folderIds.map((id) => ({ kind: 'folder' as const, id })),
    ...assetIds.map((id) => ({ kind: 'asset' as const, id })),
  ];
}

export function indexInBrowseOrder(
  items: readonly BrowseSelectionItem[],
  anchor: BrowseSelectionAnchor,
): number {
  return items.findIndex(
    (item) => item.kind === anchor.kind && item.id === anchor.id,
  );
}

export type ShiftBrowseRangeResult = {
  readonly folderIds: string[];
  readonly assetIds: string[];
  readonly anchor: BrowseSelectionAnchor;
};

/**
 * Resolve a Shift+click range on the unified browse list.
 * When `additive` is true (⌘/Ctrl+Shift), unions the range with the current
 * selection instead of replacing it.
 */
export function resolveShiftBrowseRange(input: {
  readonly items: readonly BrowseSelectionItem[];
  readonly anchor: BrowseSelectionAnchor | null;
  readonly target: BrowseSelectionAnchor;
  readonly currentFolderIds: readonly string[];
  readonly currentAssetIds: readonly string[];
  readonly additive: boolean;
}): ShiftBrowseRangeResult | null {
  if (!input.anchor) return null;

  const anchorIndex = indexInBrowseOrder(input.items, input.anchor);
  const targetIndex = indexInBrowseOrder(input.items, input.target);
  if (anchorIndex < 0 || targetIndex < 0) return null;

  const slice = input.items.slice(
    Math.min(anchorIndex, targetIndex),
    Math.max(anchorIndex, targetIndex) + 1,
  );
  const rangeFolders = slice
    .filter((item) => item.kind === 'folder')
    .map((item) => item.id);
  const rangeAssets = slice
    .filter((item) => item.kind === 'asset')
    .map((item) => item.id);

  if (input.additive) {
    return {
      folderIds: [...new Set([...input.currentFolderIds, ...rangeFolders])],
      assetIds: [...new Set([...input.currentAssetIds, ...rangeAssets])],
      anchor: input.anchor,
    };
  }

  return {
    folderIds: rangeFolders,
    assetIds: rangeAssets,
    anchor: input.anchor,
  };
}
