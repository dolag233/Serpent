/**
 * Transport chunking for content write paths. These bound single IPC
 * payloads, not the total content size — any asset size is supported by
 * staging in chunks (product decision Serpent-c32ce6: no usage-size caps).
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
