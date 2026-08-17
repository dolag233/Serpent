import { describe, expect, it } from 'vitest';

import {
  ASSET_DRAG_PREVIEW_HEIGHT,
  ASSET_DRAG_PREVIEW_WIDTH,
  assetDragPreviewModel,
} from '../../src/renderer/asset-drag-preview';

// REQ-DND-003: the ghost view model is pure and node-testable. DOM node
// construction (createAssetDragPreview/showAssetDragPreview) runs renderer-
// side only — vitest's node environment has no document.

describe('assetDragPreviewModel (REQ-DND-003)', () => {
  it('carries the thumbnail url and shows no badge for a single-asset drag', () => {
    const model = assetDragPreviewModel({
      thumbnailUrl: 'serpent://preview/lib/artifact',
      fileName: 'hero.png',
      count: 1,
    });
    expect(model.thumbnailUrl).toBe('serpent://preview/lib/artifact');
    expect(model.fileName).toBe('hero.png');
    expect(model.badgeText).toBeNull();
    expect(model.showCopyBadge).toBe(false);
  });

  it('labels the badge with the dragged count for multi-asset drags', () => {
    expect(
      assetDragPreviewModel({ thumbnailUrl: null, fileName: 'hero.png', count: 7 })
        .badgeText,
    ).toBe('7');
  });

  it('keeps a null thumbnail so the ghost falls back to the file-name chip', () => {
    expect(
      assetDragPreviewModel({ thumbnailUrl: null, fileName: 'model.fbx', count: 2 })
        .thumbnailUrl,
    ).toBeNull();
  });

  it('shows the copy "+" badge when Option/Alt copy mode is active (Serpent-aa3)', () => {
    expect(
      assetDragPreviewModel({
        thumbnailUrl: null,
        fileName: 'hero.png',
        count: 1,
        copyMode: true,
      }).showCopyBadge,
    ).toBe(true);
  });
});

describe('drag preview geometry (REQ-DND-003)', () => {
  it('stays at the small target tile size', () => {
    expect(ASSET_DRAG_PREVIEW_WIDTH).toBe(96);
    expect(ASSET_DRAG_PREVIEW_HEIGHT).toBe(72);
  });
});
