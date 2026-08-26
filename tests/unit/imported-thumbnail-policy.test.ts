import { describe, expect, it } from 'vitest';

import {
  IMPORTED_THUMBNAIL_MAX_BYTES,
  IMPORTED_THUMBNAIL_MAX_EDGE,
  importedThumbnailNeedsNormalization,
  isImportedThumbnailGenerator,
  isLegacyImportedThumbnailGenerator,
} from '../../src/worker/imported-thumbnail-policy';

describe('imported thumbnail policy', () => {
  it('normalizes an imported preview when its dimensions exceed the card bound', () => {
    expect(importedThumbnailNeedsNormalization({
      byteSize: 2_000,
      width: IMPORTED_THUMBNAIL_MAX_EDGE + 1,
      height: 320,
    })).toBe(true);
  });

  it('normalizes a byte-heavy preview even when dimensions are unavailable', () => {
    expect(importedThumbnailNeedsNormalization({
      byteSize: IMPORTED_THUMBNAIL_MAX_BYTES + 1,
      width: null,
      height: null,
    })).toBe(true);
  });

  it('probes a small-byte preview when its dimensions are unavailable', () => {
    expect(importedThumbnailNeedsNormalization({
      byteSize: IMPORTED_THUMBNAIL_MAX_BYTES,
      width: null,
      height: null,
    })).toBe(true);
  });

  it('does not require re-encoding after a bounded preview is validated', () => {
    expect(importedThumbnailNeedsNormalization({
      byteSize: IMPORTED_THUMBNAIL_MAX_BYTES,
      width: IMPORTED_THUMBNAIL_MAX_EDGE,
      height: IMPORTED_THUMBNAIL_MAX_EDGE,
    })).toBe(false);
  });

  it('recognizes legacy and normalized generator families', () => {
    expect(isLegacyImportedThumbnailGenerator('eagle-thumbnail@1')).toBe(true);
    expect(isLegacyImportedThumbnailGenerator('billfish-thumbnail@1;source=copy')).toBe(true);
    expect(isImportedThumbnailGenerator('eagle-thumbnail@1')).toBe(true);
    expect(isImportedThumbnailGenerator('import-thumbnail@2;sharp@0.35.3;max=512')).toBe(true);
    expect(isImportedThumbnailGenerator('sharp@0.35.3-gifstill1')).toBe(false);
  });
});
