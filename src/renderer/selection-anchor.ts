import type { BrowseSelectionAnchor } from './browse-selection-order';

/**
 * Resolve the anchor for Shift+click range selection.
 *
 * `browseSelectionAnchorRef` is only updated on canvas clicks, but import
 * reveal, select-all, invert, preview navigation, and session restore update
 * `selectionAnchorRef` alone — without this fallback Shift feels random.
 */
export function resolveShiftBrowseAnchor(input: {
  readonly browseAnchor: BrowseSelectionAnchor | null;
  readonly assetAnchorId: string | null;
  readonly folderAnchorId: string | null;
}): BrowseSelectionAnchor | null {
  if (input.browseAnchor) return input.browseAnchor;
  if (input.assetAnchorId) {
    return { kind: 'asset', id: input.assetAnchorId };
  }
  if (input.folderAnchorId) {
    return { kind: 'folder', id: input.folderAnchorId };
  }
  return null;
}

export function assetBrowseAnchor(assetId: string): BrowseSelectionAnchor {
  return { kind: 'asset', id: assetId };
}

export function folderBrowseAnchor(folderId: string): BrowseSelectionAnchor {
  return { kind: 'folder', id: folderId };
}
