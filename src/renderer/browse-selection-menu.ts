/**
 * Resolve which browse-canvas context menu to open when right-clicking a
 * folder card or asset card under multi/mixed selection (Serpent-koy).
 *
 * Selection is preserved when the click target is already selected and the
 * combined selection has 2+ items; otherwise the click replaces selection
 * with the single target (existing single-item menu paths).
 */

export type BrowseContextMenuClick = {
  readonly kind: "asset" | "folder";
  readonly id: string;
};

export type BrowseContextMenuSelection = {
  readonly assetIds: readonly string[];
  readonly folderIds: readonly string[];
};

export type BrowseContextMenuIntent =
  | { readonly type: "single-asset"; readonly assetId: string }
  | { readonly type: "single-folder"; readonly folderId: string }
  | {
      readonly type: "multi";
      readonly assetIds: readonly string[];
      readonly folderIds: readonly string[];
    };

export function resolveBrowseContextMenuIntent(
  click: BrowseContextMenuClick,
  selection: BrowseContextMenuSelection,
): BrowseContextMenuIntent {
  const inSelection =
    click.kind === "asset"
      ? selection.assetIds.includes(click.id)
      : selection.folderIds.includes(click.id);

  if (!inSelection) {
    return click.kind === "asset"
      ? { type: "single-asset", assetId: click.id }
      : { type: "single-folder", folderId: click.id };
  }

  const total = selection.assetIds.length + selection.folderIds.length;
  if (total >= 2) {
    return {
      type: "multi",
      assetIds: selection.assetIds,
      folderIds: selection.folderIds,
    };
  }

  return click.kind === "asset"
    ? { type: "single-asset", assetId: click.id }
    : { type: "single-folder", folderId: click.id };
}
