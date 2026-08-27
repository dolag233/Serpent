import {
  closeSync,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";
import { open as openAsync } from "node:fs/promises";

export interface ImageDimensions {
  width: number;
  height: number;
}

const HEADER_BYTES = 128 * 1024;

function u16(buffer: Buffer, offset: number, littleEndian: boolean): number | null {
  if (offset < 0 || offset + 2 > buffer.length) return null;
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function u32(buffer: Buffer, offset: number, littleEndian: boolean): number | null {
  if (offset < 0 || offset + 4 > buffer.length) return null;
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function dimensions(width: number | null, height: number | null): ImageDimensions | null {
  return width !== null && height !== null && width > 0 && height > 0
    ? { width, height }
    : null;
}

function parseJpeg(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset]!;
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    const length = u16(buffer, offset, false);
    if (length === null || length < 2 || offset + length > buffer.length) return null;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      return dimensions(
        u16(buffer, offset + 5, false),
        u16(buffer, offset + 3, false),
      );
    }
    offset += length;
  }
  return null;
}

function parseTiff(buffer: Buffer): ImageDimensions | null {
  const littleEndian = buffer.toString("ascii", 0, 2) === "II";
  if (!littleEndian && buffer.toString("ascii", 0, 2) !== "MM") return null;
  if (u16(buffer, 2, littleEndian) !== 42) return null;
  const ifdOffset = u32(buffer, 4, littleEndian);
  if (ifdOffset === null) return null;
  return parseTiffIfd(buffer, ifdOffset, littleEndian);
}

function parseTiffIfd(
  buffer: Buffer,
  ifdOffset: number,
  littleEndian: boolean,
): ImageDimensions | null {
  const entryCount = u16(buffer, ifdOffset, littleEndian);
  if (entryCount === null) return null;
  let width: number | null = null;
  let height: number | null = null;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const tag = u16(buffer, entryOffset, littleEndian);
    const type = u16(buffer, entryOffset + 2, littleEndian);
    const count = u32(buffer, entryOffset + 4, littleEndian);
    if (tag === null || type === null || count === null || count < 1) return null;
    let value: number | null = null;
    if (count === 1 && type === 3) {
      value = u16(buffer, entryOffset + 8, littleEndian);
    } else if (count === 1 && type === 4) {
      value = u32(buffer, entryOffset + 8, littleEndian);
    }
    if (tag === 256) width = value;
    if (tag === 257) height = value;
  }
  return dimensions(width, height);
}

/**
 * TIFF permits the first IFD to live anywhere in the file. Camera/scanner
 * writers commonly place the pixel strip before it, which means the compact
 * header probe above cannot see the dimensions without reading the whole
 * source. Read only the bounded IFD instead; an oversized or truncated IFD
 * remains unknown and is handled by the decoder's normal safety fallback.
 */
const TIFF_IFD_MAX_BYTES = 256 * 1024;

function readTiffDimensionsSync(
  fd: number,
  fileSize: number,
  header: Buffer,
): ImageDimensions | null {
  const littleEndian = header.toString("ascii", 0, 2) === "II";
  if (!littleEndian && header.toString("ascii", 0, 2) !== "MM") return null;
  if (u16(header, 2, littleEndian) !== 42) return null;
  const ifdOffset = u32(header, 4, littleEndian);
  if (ifdOffset === null || ifdOffset > fileSize - 2) return null;

  const countBuffer = Buffer.allocUnsafe(2);
  if (readSync(fd, countBuffer, 0, countBuffer.length, ifdOffset) !== countBuffer.length) {
    return null;
  }
  const entryCount = u16(countBuffer, 0, littleEndian);
  if (entryCount === null) return null;
  const ifdBytes = 2 + entryCount * 12;
  if (ifdBytes > TIFF_IFD_MAX_BYTES || ifdOffset > fileSize - ifdBytes) return null;

  const ifd = Buffer.allocUnsafe(ifdBytes);
  if (readSync(fd, ifd, 0, ifd.length, ifdOffset) !== ifd.length) return null;
  return parseTiffIfd(ifd, 0, littleEndian);
}

async function readTiffDimensions(
  handle: Awaited<ReturnType<typeof openAsync>>,
  fileSize: number,
  header: Buffer,
): Promise<ImageDimensions | null> {
  const littleEndian = header.toString("ascii", 0, 2) === "II";
  if (!littleEndian && header.toString("ascii", 0, 2) !== "MM") return null;
  if (u16(header, 2, littleEndian) !== 42) return null;
  const ifdOffset = u32(header, 4, littleEndian);
  if (ifdOffset === null || ifdOffset > fileSize - 2) return null;

  const countBuffer = Buffer.allocUnsafe(2);
  const countRead = await handle.read(countBuffer, 0, countBuffer.length, ifdOffset);
  if (countRead.bytesRead !== countBuffer.length) return null;
  const entryCount = u16(countBuffer, 0, littleEndian);
  if (entryCount === null) return null;
  const ifdBytes = 2 + entryCount * 12;
  if (ifdBytes > TIFF_IFD_MAX_BYTES || ifdOffset > fileSize - ifdBytes) return null;

  const ifd = Buffer.allocUnsafe(ifdBytes);
  const ifdRead = await handle.read(ifd, 0, ifd.length, ifdOffset);
  if (ifdRead.bytesRead !== ifd.length) return null;
  return parseTiffIfd(ifd, 0, littleEndian);
}

function parseWebp(buffer: Buffer): ImageDimensions | null {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  if (buffer.toString("ascii", 12, 16) === "VP8X" && buffer.length >= 30) {
    const width = 1 + buffer[24]! + (buffer[25]! << 8) + (buffer[26]! << 16);
    const height = 1 + buffer[27]! + (buffer[28]! << 8) + (buffer[29]! << 16);
    return dimensions(width, height);
  }
  return null;
}

/**
 * Read dimensions without decoding the image. Automatic sequence grouping is
 * deliberately conservative: unknown or malformed formats return null rather
 * than allowing a filename-only match to become a sequence.
 */
export function readImageDimensionsSync(filePath: string): ImageDimensions | null {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const fileSize = Number(fstatSync(fd).size);
    const size = Math.min(HEADER_BYTES, fileSize);
    if (size <= 0) return null;
    const buffer = Buffer.allocUnsafe(size);
    const bytesRead = readSync(fd, buffer, 0, size, 0);
    const header = buffer.subarray(0, bytesRead);
    const parsed = parseImageDimensions(header);
    if (parsed) return parsed;
    if (header.toString("ascii", 0, 2) === "II" || header.toString("ascii", 0, 2) === "MM") {
      return readTiffDimensionsSync(fd, fileSize, header);
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseImageDimensions(header: Buffer): ImageDimensions | null {
  if (header.length >= 24 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return dimensions(u32(header, 16, false), u32(header, 20, false));
  }
  if (header.toString("ascii", 0, 6) === "GIF87a" || header.toString("ascii", 0, 6) === "GIF89a") {
    return dimensions(u16(header, 6, true), u16(header, 8, true));
  }
  if (header.toString("ascii", 0, 2) === "BM") {
    return dimensions(u32(header, 18, true), u32(header, 22, true));
  }
  if (header.toString("ascii", 0, 4) === "8BPS") {
    return dimensions(u32(header, 14, false), u32(header, 18, false));
  }
  if (header.toString("ascii", 0, 4) === "RIFF") return parseWebp(header);
  if (header.toString("ascii", 0, 2) === "II" || header.toString("ascii", 0, 2) === "MM") {
    return parseTiff(header);
  }
  return parseJpeg(header);
}

/**
 * Async counterpart used by interactive Worker paths. The synchronous probe
 * remains for import/sequence code that already runs inside a bounded write,
 * but visible-window reporting must not block the Worker while opening and
 * reading source headers on a cold or remote volume.
 */
export async function readImageDimensions(filePath: string): Promise<ImageDimensions | null> {
  let handle: Awaited<ReturnType<typeof openAsync>> | undefined;
  try {
    handle = await openAsync(filePath, "r");
    const { size: fileSize } = await handle.stat();
    const size = Math.min(HEADER_BYTES, Number(fileSize));
    if (size <= 0) return null;
    const buffer = Buffer.allocUnsafe(size);
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    const header = buffer.subarray(0, bytesRead);
    const parsed = parseImageDimensions(header);
    if (parsed) return parsed;
    if (header.toString("ascii", 0, 2) === "II" || header.toString("ascii", 0, 2) === "MM") {
      return await readTiffDimensions(handle, Number(fileSize), header);
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
