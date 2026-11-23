import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
} from 'node:fs';

import BetterSqlite3 from 'better-sqlite3';

type PreviewDatabase = {
  pragma(source: string): unknown;
  prepare(source: string): { get(): unknown };
  close(): void;
};

const Database = BetterSqlite3 as new (
  source: Buffer,
  options: { readonly: true },
) => PreviewDatabase;

/**
 * CLIP STUDIO `.clip` stores a canvas preview inside an embedded SQLite
 * database. The database sits in a `CHNKSQLi` chunk; some files are the
 * database itself. This reads that preview image and does not decode layers.
 */

export const CLIP_PREVIEW_MAX_SQLITE_BYTES = 64 * 1024 * 1024;
export const CLIP_PREVIEW_MAX_IMAGE_BYTES = 32 * 1024 * 1024;

const CHUNK_HEADER_BYTES = 16;
const ROOT_HEADER_BYTES = 24;
const MAX_CHUNKS = 100_000;
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'utf8');
const SQLI_TAG = 'CHNKSQLi';

function readExact(
  handle: number,
  fileSize: number,
  offset: number,
  length: number,
): Buffer | null {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > fileSize
  ) return null;
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const count = readSync(handle, buffer, bytesRead, length - bytesRead, offset + bytesRead);
    if (count <= 0) return null;
    bytesRead += count;
  }
  return buffer;
}

function readChunkPayload(filePath: string): Buffer | null {
  const handle = openSync(filePath, 'r');
  try {
    const fileSize = fstatSync(handle).size;
    if (!Number.isSafeInteger(fileSize) || fileSize < SQLITE_MAGIC.length) return null;
    const root = readExact(handle, fileSize, 0, Math.min(ROOT_HEADER_BYTES, fileSize));
    if (!root) return null;
    if (root.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) {
      if (fileSize > CLIP_PREVIEW_MAX_SQLITE_BYTES) return null;
      return readExact(handle, fileSize, 0, fileSize);
    }
    if (root.length < ROOT_HEADER_BYTES || root.subarray(0, 8).toString('ascii') !== 'CSFCHUNK') {
      return null;
    }
    const firstChunk = Number(root.readBigUInt64BE(16));
    if (!Number.isSafeInteger(firstChunk) || firstChunk < ROOT_HEADER_BYTES || firstChunk >= fileSize) {
      return null;
    }
    let offset = firstChunk;
    for (let index = 0; index < MAX_CHUNKS; index += 1) {
      const header = readExact(handle, fileSize, offset, CHUNK_HEADER_BYTES);
      if (!header) return null;
      const tag = header.subarray(0, 8).toString('ascii');
      const payloadLength = Number(header.readBigUInt64BE(8));
      if (!Number.isSafeInteger(payloadLength) || payloadLength < 0) return null;
      const payloadOffset = offset + CHUNK_HEADER_BYTES;
      if (payloadOffset + payloadLength > fileSize) return null;
      if (tag === SQLI_TAG) {
        if (payloadLength > CLIP_PREVIEW_MAX_SQLITE_BYTES || payloadLength < SQLITE_MAGIC.length) return null;
        const payload = readExact(handle, fileSize, payloadOffset, payloadLength);
        if (!payload || !payload.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)) return null;
        return payload;
      }
      offset = payloadOffset + payloadLength;
      if (offset >= fileSize) return null;
    }
    return null;
  } finally {
    closeSync(handle);
  }
}

function isPreviewImage(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.length > CLIP_PREVIEW_MAX_IMAGE_BYTES) return false;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

/** Returns the embedded canvas preview, or null when the file has none. */
export function extractClipCanvasPreview(filePath: string): Buffer | null {
  const databaseBytes = readChunkPayload(filePath);
  if (!databaseBytes) return null;
  let database: PreviewDatabase | undefined;
  try {
    database = new Database(databaseBytes, { readonly: true });
    database.pragma('query_only = ON');
    database.pragma('temp_store = MEMORY');
    database.pragma('trusted_schema = OFF');
    const row = database.prepare(
      `SELECT ImageData AS image
       FROM CanvasPreview
       WHERE length(ImageData) BETWEEN 12 AND ${CLIP_PREVIEW_MAX_IMAGE_BYTES}
       ORDER BY length(ImageData) DESC
       LIMIT 1`,
    ).get() as { image?: Buffer } | undefined;
    const image = row?.image;
    if (!Buffer.isBuffer(image) || !isPreviewImage(image)) return null;
    return Buffer.from(image);
  } catch {
    return null;
  } finally {
    database?.close();
  }
}
