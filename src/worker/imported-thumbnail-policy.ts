/**
 * Policy for thumbnails copied from Eagle/Billfish libraries.
 *
 * The import path keeps the source preview copy-only so conversion can publish
 * assets quickly. A bounded background Sharp job then normalizes oversized
 * previews before they become a recurring visible-window decode cost.
 */

export const IMPORTED_THUMBNAIL_MAX_EDGE = 512;
export const IMPORTED_THUMBNAIL_MAX_BYTES = 256 * 1024;
export const IMPORTED_THUMBNAIL_NORMALIZATION_JOB = 'IMPORT_THUMBNAIL_NORMALIZE';
export const IMPORTED_THUMBNAIL_GENERATOR_PREFIX = 'import-thumbnail@2';

const LEGACY_IMPORTED_THUMBNAIL_GENERATORS = [
  'eagle-thumbnail@1',
  'billfish-thumbnail@1',
] as const;

export function isImportedThumbnailGenerator(generatorVersion: string): boolean {
  return LEGACY_IMPORTED_THUMBNAIL_GENERATORS.some((prefix) =>
    generatorVersion.startsWith(prefix),
  ) || generatorVersion.startsWith(IMPORTED_THUMBNAIL_GENERATOR_PREFIX);
}

export function isLegacyImportedThumbnailGenerator(generatorVersion: string): boolean {
  return LEGACY_IMPORTED_THUMBNAIL_GENERATORS.some((prefix) =>
    generatorVersion.startsWith(prefix),
  );
}

export function importedThumbnailNeedsNormalization(input: {
  byteSize: number;
  width: number | null | undefined;
  height: number | null | undefined;
}): boolean {
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) return false;
  if (input.byteSize > IMPORTED_THUMBNAIL_MAX_BYTES) return true;
  if (input.width === null || input.width === undefined
    || input.height === null || input.height === undefined) {
    return false;
  }
  return input.width > IMPORTED_THUMBNAIL_MAX_EDGE
    || input.height > IMPORTED_THUMBNAIL_MAX_EDGE;
}
