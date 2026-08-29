import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readImageDimensions, readImageDimensionsSync } from "../../src/worker/image-dimensions";

function tiffWithDistantIfd(): Buffer {
  const ifdOffset = 140_000;
  const output = Buffer.alloc(ifdOffset + 2 + (2 * 12) + 4);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(ifdOffset, 4);
  output.writeUInt16LE(2, ifdOffset);

  const widthEntry = ifdOffset + 2;
  output.writeUInt16LE(256, widthEntry);
  output.writeUInt16LE(4, widthEntry + 2);
  output.writeUInt32LE(1, widthEntry + 4);
  output.writeUInt32LE(576, widthEntry + 8);

  const heightEntry = widthEntry + 12;
  output.writeUInt16LE(257, heightEntry);
  output.writeUInt16LE(4, heightEntry + 2);
  output.writeUInt32LE(1, heightEntry + 4);
  output.writeUInt32LE(1024, heightEntry + 8);
  return output;
}

function tiffWithBigEndianIfd(): Buffer {
  const ifdOffset = 8;
  const output = Buffer.alloc(ifdOffset + 2 + (2 * 12) + 4);
  output.write("MM", 0, "ascii");
  output.writeUInt16BE(42, 2);
  output.writeUInt32BE(ifdOffset, 4);
  output.writeUInt16BE(2, ifdOffset);

  const widthEntry = ifdOffset + 2;
  output.writeUInt16BE(256, widthEntry);
  output.writeUInt16BE(4, widthEntry + 2);
  output.writeUInt32BE(1, widthEntry + 4);
  output.writeUInt32BE(2048, widthEntry + 8);

  const heightEntry = widthEntry + 12;
  output.writeUInt16BE(257, heightEntry);
  output.writeUInt16BE(4, heightEntry + 2);
  output.writeUInt32BE(1, heightEntry + 4);
  output.writeUInt32BE(1536, heightEntry + 8);
  return output;
}

function tiffWithMultipleIfds(): Buffer {
  const firstIfdOffset = 8;
  const secondIfdOffset = firstIfdOffset + 2 + (2 * 12) + 4;
  const output = Buffer.alloc(secondIfdOffset + 2 + (2 * 12) + 4);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(firstIfdOffset, 4);
  output.writeUInt16LE(2, firstIfdOffset);
  output.writeUInt16LE(256, firstIfdOffset + 2);
  output.writeUInt16LE(4, firstIfdOffset + 4);
  output.writeUInt32LE(1, firstIfdOffset + 6);
  output.writeUInt32LE(640, firstIfdOffset + 10);
  output.writeUInt16LE(257, firstIfdOffset + 14);
  output.writeUInt16LE(4, firstIfdOffset + 16);
  output.writeUInt32LE(1, firstIfdOffset + 18);
  output.writeUInt32LE(480, firstIfdOffset + 22);
  output.writeUInt32LE(secondIfdOffset, firstIfdOffset + 26);
  output.writeUInt16LE(2, secondIfdOffset);
  return output;
}

function tiffWithTruncatedIfd(): Buffer {
  const output = Buffer.alloc(8 + 2 + 12);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(8, 4);
  output.writeUInt16LE(2, 8);
  return output;
}

function tiffWithOversizedIfd(): Buffer {
  const output = Buffer.alloc(10);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(8, 4);
  output.writeUInt16LE(0xffff, 8);
  return output;
}

function bigTiffHeader(): Buffer {
  const output = Buffer.alloc(16);
  output.write("II", 0, "ascii");
  output.writeUInt16LE(43, 2);
  return output;
}

async function expectDimensionsForBothReaders(
  sourcePath: string,
  expected: { width: number; height: number } | null,
): Promise<void> {
  expect(readImageDimensionsSync(sourcePath)).toEqual(expected);
  await expect(readImageDimensions(sourcePath)).resolves.toEqual(expected);
}

describe("TIFF dimension probes", () => {
  it("reads an IFD that is outside the bounded prefix synchronously", () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-image-dimensions-"));
    try {
      const sourcePath = path.join(root, "distant-ifd.tiff");
      writeFileSync(sourcePath, tiffWithDistantIfd());
      expect(readImageDimensionsSync(sourcePath)).toEqual({ width: 576, height: 1024 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the same bounded random read in the async probe", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-image-dimensions-"));
    try {
      const sourcePath = path.join(root, "distant-ifd.tiff");
      writeFileSync(sourcePath, tiffWithDistantIfd());
      await expect(readImageDimensions(sourcePath)).resolves.toEqual({ width: 576, height: 1024 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("supports big-endian and multi-page classic TIFFs without reading pixel data", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-image-dimensions-"));
    try {
      const bigEndianPath = path.join(root, "big-endian.tiff");
      const multiPagePath = path.join(root, "multi-page.tiff");
      writeFileSync(bigEndianPath, tiffWithBigEndianIfd());
      writeFileSync(multiPagePath, tiffWithMultipleIfds());
      await expectDimensionsForBothReaders(bigEndianPath, { width: 2048, height: 1536 });
      await expectDimensionsForBothReaders(multiPagePath, { width: 640, height: 480 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects truncated, oversized, and BigTIFF headers as unknown", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "serpent-image-dimensions-"));
    try {
      const cases = [
        ["truncated.tiff", tiffWithTruncatedIfd()],
        ["oversized.tiff", tiffWithOversizedIfd()],
        ["bigtiff.tiff", bigTiffHeader()],
      ] as const;
      for (const [name, bytes] of cases) {
        const sourcePath = path.join(root, name);
        writeFileSync(sourcePath, bytes);
        await expectDimensionsForBothReaders(sourcePath, null);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
