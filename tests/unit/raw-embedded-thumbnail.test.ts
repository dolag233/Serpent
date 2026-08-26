import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  extractRawEmbeddedJpegThumbnail,
  RAW_EMBEDDED_THUMBNAIL_MAX_BYTES,
} from '../../src/worker/raw-embedded-thumbnail';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function buildTiffRaw(
  jpeg: Buffer,
  byteOrder: 'little' | 'big',
  prefix = Buffer.alloc(0),
): Buffer {
  const littleEndian = byteOrder === 'little';
  const tiffBase = prefix.length;
  const firstIfdOffset = 8;
  const secondIfdOffset = 16;
  const secondIfdLength = 2 + 2 * 12 + 4;
  const jpegOffset = secondIfdOffset + secondIfdLength;
  const output = Buffer.alloc(jpegOffset + jpeg.length + prefix.length);
  prefix.copy(output, 0);
  output.write(byteOrder === 'little' ? 'II' : 'MM', tiffBase, 'ascii');
  if (littleEndian) {
    output.writeUInt16LE(42, tiffBase + 2);
    output.writeUInt32LE(firstIfdOffset, tiffBase + 4);
    output.writeUInt16LE(0, tiffBase + firstIfdOffset);
    output.writeUInt32LE(secondIfdOffset, tiffBase + firstIfdOffset + 2);
    output.writeUInt16LE(2, tiffBase + secondIfdOffset);
    output.writeUInt16LE(0x0201, tiffBase + secondIfdOffset + 2);
    output.writeUInt16LE(4, tiffBase + secondIfdOffset + 4);
    output.writeUInt32LE(1, tiffBase + secondIfdOffset + 6);
    output.writeUInt32LE(jpegOffset, tiffBase + secondIfdOffset + 10);
    output.writeUInt16LE(0x0202, tiffBase + secondIfdOffset + 14);
    output.writeUInt16LE(4, tiffBase + secondIfdOffset + 16);
    output.writeUInt32LE(1, tiffBase + secondIfdOffset + 18);
    output.writeUInt32LE(jpeg.length, tiffBase + secondIfdOffset + 22);
    output.writeUInt32LE(0, tiffBase + secondIfdOffset + 26);
  } else {
    output.writeUInt16BE(42, tiffBase + 2);
    output.writeUInt32BE(firstIfdOffset, tiffBase + 4);
    output.writeUInt16BE(0, tiffBase + firstIfdOffset);
    output.writeUInt32BE(secondIfdOffset, tiffBase + firstIfdOffset + 2);
    output.writeUInt16BE(2, tiffBase + secondIfdOffset);
    output.writeUInt16BE(0x0201, tiffBase + secondIfdOffset + 2);
    output.writeUInt16BE(4, tiffBase + secondIfdOffset + 4);
    output.writeUInt32BE(1, tiffBase + secondIfdOffset + 6);
    output.writeUInt32BE(jpegOffset, tiffBase + secondIfdOffset + 10);
    output.writeUInt16BE(0x0202, tiffBase + secondIfdOffset + 14);
    output.writeUInt16BE(4, tiffBase + secondIfdOffset + 16);
    output.writeUInt32BE(1, tiffBase + secondIfdOffset + 18);
    output.writeUInt32BE(jpeg.length, tiffBase + secondIfdOffset + 22);
    output.writeUInt32BE(0, tiffBase + secondIfdOffset + 26);
  }
  jpeg.copy(output, tiffBase + jpegOffset);
  return output;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

function temporaryFile(bytes: Buffer): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-raw-embedded-'));
  temporaryRoots.push(root);
  const filePath = path.join(root, 'sample.ARW');
  writeFileSync(filePath, bytes);
  return filePath;
}

describe('extractRawEmbeddedJpegThumbnail', () => {
  it('reads the standard IFD1 JPEG preview in little-endian RAW/TIFF files', () => {
    const filePath = temporaryFile(buildTiffRaw(JPEG, 'little'));

    expect(extractRawEmbeddedJpegThumbnail(filePath)).toEqual(JPEG);
  });

  it('reads big-endian previews and TIFF headers embedded after a prefix', () => {
    const filePath = temporaryFile(buildTiffRaw(JPEG, 'big', Buffer.alloc(32, 0x7f)));

    expect(extractRawEmbeddedJpegThumbnail(filePath)).toEqual(JPEG);
  });

  it('rejects malformed, non-JPEG, out-of-range, and oversized previews', () => {
    const nonJpegPath = temporaryFile(buildTiffRaw(Buffer.from('not-jpeg'), 'little'));
    expect(extractRawEmbeddedJpegThumbnail(nonJpegPath)).toBeNull();

    const malformed = buildTiffRaw(JPEG, 'little');
    malformed.writeUInt32LE(malformed.length + 1, 38);
    const malformedPath = temporaryFile(malformed);
    expect(extractRawEmbeddedJpegThumbnail(malformedPath)).toBeNull();

    const oversized = buildTiffRaw(Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(RAW_EMBEDDED_THUMBNAIL_MAX_BYTES),
    ]), 'little');
    const oversizedPath = temporaryFile(oversized);
    expect(extractRawEmbeddedJpegThumbnail(oversizedPath)).toBeNull();
  });
});
