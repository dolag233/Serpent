import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  extractRawEmbeddedJpegThumbnail,
  extractRawEmbeddedThumbnail,
  RAW_EMBEDDED_THUMBNAIL_MAX_BYTES,
} from '../../src/worker/raw-embedded-thumbnail';
import {
  extractRawImageMetadataDetailed,
  rawOrientationSwapsDimensions,
} from '../../src/worker/raw-image-metadata';

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
  orientation?: number,
): Buffer {
  const littleEndian = byteOrder === 'little';
  const tiffBase = prefix.length;
  const firstIfdOffset = 8;
  const secondIfdOffset = orientation === undefined ? 16 : 32;
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
  if (orientation !== undefined) {
    const write16 = (v: number, offset: number) => littleEndian ? output.writeUInt16LE(v, offset) : output.writeUInt16BE(v, offset);
    const write32 = (v: number, offset: number) => littleEndian ? output.writeUInt32LE(v, offset) : output.writeUInt32BE(v, offset);
    write16(1, tiffBase + firstIfdOffset);
    write16(0x0112, tiffBase + firstIfdOffset + 2);
    write16(3, tiffBase + firstIfdOffset + 4);
    write32(1, tiffBase + firstIfdOffset + 6);
    write16(orientation, tiffBase + firstIfdOffset + 10);
    write32(secondIfdOffset, tiffBase + firstIfdOffset + 14);
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
  it('recognizes numeric and translated camera orientation without treating 180 degrees as portrait', () => {
    for (const value of [5, 6, 7, 8, '6', 'Rotate 90 CW', 'Rotate 270 CW', 'Mirror horizontal and rotate 270 CW']) {
      expect(rawOrientationSwapsDimensions(value)).toBe(true);
    }
    for (const value of [null, 0, 1, 2, 3, 4, 'Rotate 180', 'Horizontal (normal)', '90', '9']) {
      expect(rawOrientationSwapsDimensions(value)).toBe(false);
    }
  });
  it.each(['little', 'big'] as const)('retains outer orientation in %s endian containers', order => {
    const file = temporaryFile(buildTiffRaw(JPEG, order, Buffer.alloc(0), 6));
    expect(extractRawEmbeddedThumbnail(file)).toEqual({ jpeg: JPEG, orientation: 6 });
    const invalid = temporaryFile(buildTiffRaw(JPEG, order, Buffer.alloc(0), 9));
    expect(extractRawEmbeddedThumbnail(invalid)).toEqual({ jpeg: JPEG, orientation: null });
  });
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

describe('extractRawImageMetadataDetailed', () => {
  it('separates empty metadata from parser failures', async () => {
    await expect(extractRawImageMetadataDetailed(
      '/tmp/metadata-empty.ARW',
      { parse: async () => ({}) },
    )).resolves.toEqual({ status: 'empty' });

    const failure = new Error('parser failed');
    await expect(extractRawImageMetadataDetailed(
      '/tmp/metadata-failed.ARW',
      { parse: async () => { throw failure; } },
    )).resolves.toMatchObject({ status: 'failed', error: failure });
  });

  it('lets queue cancellation release the caller before a non-cancellable parser settles', async () => {
    let release!: () => void;
    const parserGate = new Promise<void>((resolve) => { release = resolve; });
    const controller = new AbortController();
    const parsing = extractRawImageMetadataDetailed(
      '/tmp/metadata-cancelled.ARW',
      {
        parse: async () => {
          await parserGate;
          return { Make: 'Sony' };
        },
      },
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await expect(parsing).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });
});
