import { describe, expect, it, vi } from 'vitest';

import {
  NativeAssetDragCache,
  startNativeAssetDrag,
  type NativeDragImage,
} from '../../src/main/native-asset-drag';

function image(
  label: string,
  size: { width: number; height: number } = { width: 96, height: 72 },
): NativeDragImage & { readonly label: string } {
  const result = {
    label,
    isEmpty: () => false,
    getSize: () => size,
    resize: vi.fn(),
  };
  result.resize.mockReturnValue(result);
  return result;
}

describe('native asset drag', () => {
  it('starts immediately with the visible asset thumbnail from the Main-only cache', () => {
    const cache = new NativeAssetDragCache();
    cache.replace('library-1', [{
      assetId: 'asset-1',
      absolutePath: '/library/assets/asset-1.jpg',
      thumbnailAbsolutePath: '/library/.serpent/artifacts/asset-1.webp',
    }]);
    const thumbnail = image('thumbnail');
    const fallback = image('fallback');
    const createFromPath = vi.fn(() => thumbnail);
    const startDrag = vi.fn();

    expect(startNativeAssetDrag({
      cache,
      libraryId: 'library-1',
      assetIds: ['asset-1'],
      imageFactory: { createFromPath },
      fallbackIcon: () => fallback,
      startDrag,
    })).toBe(true);

    expect(createFromPath).toHaveBeenCalledWith(
      '/library/.serpent/artifacts/asset-1.webp',
    );
    expect(thumbnail.resize).toHaveBeenCalledWith({ width: 96, height: 72 });
    expect(startDrag).toHaveBeenCalledWith({
      file: '/library/assets/asset-1.jpg',
      files: ['/library/assets/asset-1.jpg'],
      icon: thumbnail,
    });
    expect(fallback.resize).not.toHaveBeenCalled();
  });

  it('does not start a native drag when any selected asset was not preheated', () => {
    const cache = new NativeAssetDragCache();
    const startDrag = vi.fn();

    expect(startNativeAssetDrag({
      cache,
      libraryId: 'library-1',
      assetIds: ['missing-asset'],
      imageFactory: { createFromPath: vi.fn(() => image('unused')) },
      fallbackIcon: () => image('fallback'),
      startDrag,
    })).toBe(false);

    expect(startDrag).not.toHaveBeenCalled();
  });

  it('retries the current source image when a derived thumbnail cannot decode', () => {
    const cache = new NativeAssetDragCache();
    cache.replace('library-1', [{
      assetId: 'asset-1',
      absolutePath: '/library/assets/asset-1.avif',
      thumbnailAbsolutePath: '/library/.serpent/artifacts/asset-1.webp',
    }]);
    const emptyThumbnail: NativeDragImage = {
      isEmpty: () => true,
      getSize: () => ({ width: 1, height: 1 }),
      resize: vi.fn(),
    };
    const fallback = image('fallback');
    const source = image('source');
    const createFromPath = vi
      .fn()
      .mockReturnValueOnce(emptyThumbnail)
      .mockReturnValueOnce(source);
    const startDrag = vi.fn();

    expect(startNativeAssetDrag({
      cache,
      libraryId: 'library-1',
      assetIds: ['asset-1'],
      imageFactory: { createFromPath },
      fallbackIcon: () => fallback,
      startDrag,
    })).toBe(true);

    expect(createFromPath).toHaveBeenNthCalledWith(
      2,
      '/library/assets/asset-1.avif',
    );
    expect(source.resize).toHaveBeenCalledWith({ width: 96, height: 72 });
    expect(fallback.resize).not.toHaveBeenCalled();
    expect(startDrag).toHaveBeenCalledWith(expect.objectContaining({ icon: source }));
  });

  it('uses a compact generic icon only when neither current image can decode', () => {
    const cache = new NativeAssetDragCache();
    cache.replace('library-1', [{
      assetId: 'asset-1',
      absolutePath: '/library/assets/asset-1.avif',
      thumbnailAbsolutePath: '/library/.serpent/artifacts/asset-1.webp',
    }]);
    const empty: NativeDragImage = {
      isEmpty: () => true,
      getSize: () => ({ width: 1, height: 1 }),
      resize: vi.fn(),
    };
    const fallback = image('fallback');
    const startDrag = vi.fn();

    expect(startNativeAssetDrag({
      cache,
      libraryId: 'library-1',
      assetIds: ['asset-1'],
      imageFactory: { createFromPath: vi.fn(() => empty) },
      fallbackIcon: () => fallback,
      startDrag,
    })).toBe(true);

    expect(fallback.resize).toHaveBeenCalledWith({ width: 96, height: 72 });
    expect(startDrag).toHaveBeenCalledWith(expect.objectContaining({ icon: fallback }));
  });

  it('fits a square icon inside the native drag bounds without stretching it', () => {
    const cache = new NativeAssetDragCache();
    cache.replace('library-1', [{
      assetId: 'asset-1',
      absolutePath: '/library/assets/MetaHorizonLink.ico',
      thumbnailAbsolutePath: '/library/.serpent/artifacts/meta.webp',
    }]);
    const square = image('square', { width: 256, height: 256 });
    const startDrag = vi.fn();

    expect(startNativeAssetDrag({
      cache,
      libraryId: 'library-1',
      assetIds: ['asset-1'],
      imageFactory: { createFromPath: vi.fn(() => square) },
      fallbackIcon: () => undefined,
      startDrag,
    })).toBe(true);

    expect(square.resize).toHaveBeenCalledWith({ width: 72, height: 72 });
  });
});
