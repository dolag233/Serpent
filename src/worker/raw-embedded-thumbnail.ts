import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
} from 'node:fs';

/**
 * RAW camera files often contain a small, already demosaiced JPEG preview.
 * Reading that preview avoids asking LibRaw/OIIO to allocate and demosaic the
 * full sensor frame just to paint a 512px card. The parser is deliberately
 * conservative: unsupported/malformed containers return null and the caller
 * keeps the OIIO path as the correctness fallback.
 */

export const RAW_EMBEDDED_THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;

const TIFF_HEADER_BYTES = 8;
const TIFF_ENTRY_BYTES = 12;
const MAX_IFD_ENTRIES = 4096;
const MAX_IFD_CHAIN = 8;
const TIFF_HEADER_SCAN_BYTES = 64 * 1024;

type TiffByteOrder = 'little' | 'big';

interface ParsedIfd {
  jpegOffset: number | null;
  jpegLength: number | null;
  nextOffset: number;
}

function readUInt16(buffer: Buffer, offset: number, byteOrder: TiffByteOrder): number | null {
  if (offset < 0 || offset + 2 > buffer.length) return null;
  return byteOrder === 'little'
    ? buffer.readUInt16LE(offset)
    : buffer.readUInt16BE(offset);
}

function readUInt32(buffer: Buffer, offset: number, byteOrder: TiffByteOrder): number | null {
  if (offset < 0 || offset + 4 > buffer.length) return null;
  return byteOrder === 'little'
    ? buffer.readUInt32LE(offset)
    : buffer.readUInt32BE(offset);
}

function safeAdd(left: number, right: number): number | null {
  const result = left + right;
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

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
  ) return null;
  const end = safeAdd(offset, length);
  if (end === null || end > fileSize) return null;
  const buffer = Buffer.alloc(length);
  let bytesRead = 0;
  while (bytesRead < length) {
    const count = readSync(
      handle,
      buffer,
      bytesRead,
      length - bytesRead,
      offset + bytesRead,
    );
    if (count <= 0) return null;
    bytesRead += count;
  }
  return buffer;
}

function readInlineScalar(
  entry: Buffer,
  type: number,
  count: number,
  byteOrder: TiffByteOrder,
): number | null {
  if (count !== 1) return null;
  // The two tags used by the classic JPEG thumbnail convention are normally
  // LONG values. SHORT/BYTE are accepted because a few camera writers emit
  // those legal scalar variants.
  if (type === 4) return readUInt32(entry, 8, byteOrder);
  if (type === 3) return readUInt16(entry, 8, byteOrder);
  if (type === 1 && entry.length > 8) return entry[8] ?? null;
  return null;
}

function parseIfd(
  handle: number,
  fileSize: number,
  baseOffset: number,
  ifdOffset: number,
  byteOrder: TiffByteOrder,
): ParsedIfd | null {
  if (!Number.isSafeInteger(ifdOffset) || ifdOffset <= 0) return null;
  const absoluteOffset = safeAdd(baseOffset, ifdOffset);
  if (absoluteOffset === null) return null;
  const countBuffer = readExact(handle, fileSize, absoluteOffset, 2);
  if (!countBuffer) return null;
  const entryCount = readUInt16(countBuffer, 0, byteOrder);
  if (entryCount === null || entryCount > MAX_IFD_ENTRIES) return null;
  const tableLength = 2 + entryCount * TIFF_ENTRY_BYTES + 4;
  const table = readExact(handle, fileSize, absoluteOffset, tableLength);
  if (!table) return null;

  let jpegOffset: number | null = null;
  let jpegLength: number | null = null;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = 2 + index * TIFF_ENTRY_BYTES;
    const tag = readUInt16(table, entryOffset, byteOrder);
    const type = readUInt16(table, entryOffset + 2, byteOrder);
    const count = readUInt32(table, entryOffset + 4, byteOrder);
    if (tag === null || type === null || count === null) return null;
    if (tag !== 0x0201 && tag !== 0x0202) continue;
    const value = readInlineScalar(
      table.subarray(entryOffset, entryOffset + TIFF_ENTRY_BYTES),
      type,
      count,
      byteOrder,
    );
    if (tag === 0x0201) jpegOffset = value;
    else jpegLength = value;
  }

  const nextOffset = readUInt32(table, table.length - 4, byteOrder);
  return {
    jpegOffset,
    jpegLength,
    nextOffset: nextOffset ?? 0,
  };
}

function extractFromTiffBase(
  handle: number,
  fileSize: number,
  baseOffset: number,
): Buffer | null {
  const header = readExact(handle, fileSize, baseOffset, TIFF_HEADER_BYTES);
  if (!header) return null;
  const byteOrder = header[0] === 0x49 && header[1] === 0x49
    ? 'little'
    : header[0] === 0x4d && header[1] === 0x4d
      ? 'big'
      : null;
  if (!byteOrder || readUInt16(header, 2, byteOrder) !== 42) return null;
  const firstIfdOffset = readUInt32(header, 4, byteOrder);
  if (firstIfdOffset === null) return null;

  let currentOffset = firstIfdOffset;
  for (let depth = 0; depth < MAX_IFD_CHAIN && currentOffset > 0; depth += 1) {
    const ifd = parseIfd(handle, fileSize, baseOffset, currentOffset, byteOrder);
    if (!ifd) return null;
    if (ifd.jpegOffset !== null && ifd.jpegLength !== null) {
      const absoluteJpegOffset = safeAdd(baseOffset, ifd.jpegOffset);
      if (
        absoluteJpegOffset !== null
        && ifd.jpegLength > 0
        && ifd.jpegLength <= RAW_EMBEDDED_THUMBNAIL_MAX_BYTES
      ) {
        const jpeg = readExact(handle, fileSize, absoluteJpegOffset, ifd.jpegLength);
        if (
          jpeg
          && jpeg.length >= 3
          && jpeg[0] === 0xff
          && jpeg[1] === 0xd8
          && jpeg[2] === 0xff
        ) {
          return jpeg;
        }
      }
    }
    currentOffset = ifd.nextOffset;
  }
  return null;
}

function tiffSignatureAt(buffer: Buffer, offset: number): boolean {
  return (
    offset >= 0
    && offset + TIFF_HEADER_BYTES <= buffer.length
    && (
      (buffer[offset] === 0x49 && buffer[offset + 1] === 0x49)
      || (buffer[offset] === 0x4d && buffer[offset + 1] === 0x4d)
    )
    && (
      buffer[offset + 2] === 42
      || buffer[offset + 2] === 0
    )
  );
}

/**
 * Extract a bounded embedded JPEG preview from a classic TIFF-based RAW file.
 * CR3/ISO-BMFF and maker-specific previews that do not use IFD JPEG tags
 * intentionally return null and continue through the OIIO/LibRaw fallback.
 */
export function extractRawEmbeddedJpegThumbnail(absoluteFilePath: string): Buffer | null {
  let handle: number | undefined;
  try {
    handle = openSync(absoluteFilePath, 'r');
    const fileSize = fstatSync(handle).size;
    if (!Number.isSafeInteger(fileSize) || fileSize < TIFF_HEADER_BYTES) return null;

    const scanLength = Math.min(fileSize, TIFF_HEADER_SCAN_BYTES);
    const scan = readExact(handle, fileSize, 0, scanLength);
    if (!scan) return null;
    const candidates = [0];
    for (let offset = 1; offset + TIFF_HEADER_BYTES <= scan.length; offset += 1) {
      if (tiffSignatureAt(scan, offset)) candidates.push(offset);
    }
    for (const candidate of candidates) {
      const jpeg = extractFromTiffBase(handle, fileSize, candidate);
      if (jpeg) return jpeg;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}
