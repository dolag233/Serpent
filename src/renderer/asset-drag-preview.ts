// ---------------------------------------------------------------------------
// Asset drag preview (REQ-DND-003)
//
// Chromium's default drag ghost is a full-size, opaque snapshot of the whole
// asset card. This module builds the small custom ghost handed to
// DataTransfer.setDragImage instead: a ~96x72 tile with the asset thumbnail
// (or a file-name chip when the card has no thumbnail), rounded corners and a
// lowered opacity (see .asset-drag-preview in styles.css), plus a count badge
// for multi-asset drags. The decision logic is pure and unit-tested without
// the DOM, matching asset-drag-drop.ts; only the create/show functions touch
// document, so they run in the renderer exclusively.
// ---------------------------------------------------------------------------

/** Ghost tile size; App.tsx centers the drag image on half of each axis. */
export const ASSET_DRAG_PREVIEW_WIDTH = 96;
export const ASSET_DRAG_PREVIEW_HEIGHT = 72;

export interface AssetDragPreviewOptions {
  /** Thumbnail URL reused from the card's preview <img>; null shows a name chip. */
  readonly thumbnailUrl: string | null;
  readonly fileName: string;
  /** Dragged asset count; anything above 1 adds a badge with the number. */
  readonly count: number;
}

export interface AssetDragPreviewModel {
  readonly thumbnailUrl: string | null;
  readonly fileName: string;
  /** Badge label for multi-asset drags; null for a single asset. */
  readonly badgeText: string | null;
}

/** Pure view model: what the ghost shows for a given drag. */
export function assetDragPreviewModel(
  options: AssetDragPreviewOptions,
): AssetDragPreviewModel {
  return {
    thumbnailUrl: options.thumbnailUrl,
    fileName: options.fileName,
    badgeText: options.count > 1 ? String(options.count) : null,
  };
}

/**
 * Build the ghost node. Chromium only rasterizes attached elements for
 * setDragImage, so callers go through showAssetDragPreview, which mounts the
 * node offscreen and returns it for setDragImage.
 */
export function createAssetDragPreview(
  options: AssetDragPreviewOptions,
): HTMLElement {
  const model = assetDragPreviewModel(options);
  const node = document.createElement('div');
  node.className = 'asset-drag-preview';
  if (model.thumbnailUrl) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = model.thumbnailUrl;
    node.appendChild(img);
  } else {
    const chip = document.createElement('span');
    chip.className = 'asset-drag-preview-name';
    chip.textContent = model.fileName;
    node.appendChild(chip);
  }
  if (model.badgeText) {
    const badge = document.createElement('span');
    badge.className = 'asset-drag-preview-count';
    badge.textContent = model.badgeText;
    node.appendChild(badge);
  }
  return node;
}

/**
 * Mount a fresh ghost offscreen (the CSS class parks it at left: -10000px)
 * and return it for setDragImage. Any stale ghost from a previous drag is
 * removed first, so a missed dragend never leaks nodes.
 */
export function showAssetDragPreview(
  options: AssetDragPreviewOptions,
): HTMLElement {
  document
    .querySelectorAll('.asset-drag-preview')
    .forEach((stale) => stale.remove());
  const node = createAssetDragPreview(options);
  document.body.appendChild(node);
  return node;
}

/** Remove the ghost on dragend; safe to call with null. */
export function dismissAssetDragPreview(node: HTMLElement | null): void {
  node?.remove();
}
