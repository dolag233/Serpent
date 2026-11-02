import type { BrowseSelectionAnchor } from './browse-selection-order';

/**
 * Resolve the anchor for Shift+click range selection.
 *
 * Programmatic restore/reveal/select-all writes the unified browse anchor
 * through `setAssetSelectionAnchor`; this fallback preserves compatibility
 * for call sites that still update only one of the typed anchor refs.
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
