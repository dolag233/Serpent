/**
 * Resolve where OS clipboard file paste should land in the browse canvas.
 *
 * - `string` — paste into that managed folder
 * - `null` — paste into library Assets root (all / root scope)
 * - `undefined` — paste unavailable (trash, tag management, etc.)
 */

export type BrowsePasteDestination = string | null | undefined;

export function resolveBrowsePasteDestination(input: {
  libraryOpen: boolean;
  showTrash: boolean;
  showTagManagement: boolean;
  showPluginSidebarView?: boolean;
  assetScope: string;
  selectedFolderId: string | undefined;
}): BrowsePasteDestination {
  if (!input.libraryOpen || input.showTrash || input.showTagManagement || input.showPluginSidebarView) {
    return undefined;
  }
  if (input.selectedFolderId !== undefined) {
    return input.selectedFolderId;
  }
  if (input.assetScope === "all" || input.assetScope === "root") {
    return null;
  }
  return undefined;
}
