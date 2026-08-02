export const CONTENT_REPLACE_MAX_BYTES = 32 * 1024 * 1024;
export const CONTENT_REPLACE_MAX_BASE64_LENGTH = Math.ceil(CONTENT_REPLACE_MAX_BYTES / 3) * 4;

/**
 * Batch requests carry only small inline values. Larger plugin outputs use
 * asset.content.stage and cross the Worker boundary in bounded chunks.
 */
export const CONTENT_REPLACE_STAGE_CHUNK_MAX_BYTES = 1024 * 1024;
export const CONTENT_REPLACE_STAGE_CHUNK_MAX_BASE64_LENGTH = Math.ceil(
  CONTENT_REPLACE_STAGE_CHUNK_MAX_BYTES / 3,
) * 4;
export const CONTENT_REPLACE_BATCH_INLINE_MAX_BYTES = 2 * 1024 * 1024;
export const CONTENT_REPLACE_BATCH_INLINE_MAX_BASE64_LENGTH = Math.ceil(
  CONTENT_REPLACE_BATCH_INLINE_MAX_BYTES / 3,
) * 4;
export const CONTENT_REPLACE_BATCH_MAX_ITEMS = 10_000;
