import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { resolveFfmpegPath } from '../../src/worker/binary-resolver';
import {
  imageGeometryForIndex,
  pad,
  videoGeometry,
  type LargeLibraryAssetKind,
  type LargeLibraryImageGeometry,
} from './large-library-mix';

/** Pattern is authored as 200×200 noise tiles, then stamped into the asset geometry. */
export const IMAGE_MOSAIC_TILE_PX = 200;
const MOSAIC_PALETTE_SIZE = 8;
const MOSAIC_CELL_TILES = 4;
const VIDEO_DURATION_SECONDS = 0.5;

function hash32(value: number): number {
  let hash = value >>> 0;
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  return hash >>> 0;
}

function channel(seed: number, salt: number): number {
  return hash32(seed * 1103515245 + salt) % 256;
}

function blitTile(
  dest: Buffer,
  destWidth: number,
  src: Buffer,
  tileSize: number,
  destX: number,
  destY: number,
): void {
  for (let y = 0; y < tileSize; y += 1) {
    const srcStart = y * tileSize * 3;
    const destStart = ((destY + y) * destWidth + destX) * 3;
    src.copy(dest, destStart, srcStart, srcStart + tileSize * 3);
  }
}

function createNoiseTile(seed: number, size: number): Buffer {
  const bytes = Buffer.alloc(size * size * 3);
  const background = {
    r: channel(seed, 11),
    g: channel(seed, 29),
    b: channel(seed, 47),
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 3;
      const noise = hash32(seed * 997 + x * 13 + y * 29) % 72;
      bytes[offset] = Math.min(255, background.r + noise);
      bytes[offset + 1] = Math.min(255, background.g + ((x ^ y) % 28) + (noise % 18));
      bytes[offset + 2] = Math.min(255, background.b + (y % 19) + noise);
    }
  }
  return bytes;
}

async function createMosaicImage(
  index: number,
  geometry: LargeLibraryImageGeometry,
): Promise<sharp.Sharp> {
  const tileSize = IMAGE_MOSAIC_TILE_PX;
  const palette = Array.from({ length: MOSAIC_PALETTE_SIZE }, (_, tile) => (
    createNoiseTile(index * 31 + tile * 17, tileSize)
  ));
  const cell = tileSize * MOSAIC_CELL_TILES;
  const cellBytes = Buffer.alloc(cell * cell * 3);
  for (let tileY = 0; tileY < MOSAIC_CELL_TILES; tileY += 1) {
    for (let tileX = 0; tileX < MOSAIC_CELL_TILES; tileX += 1) {
      const paletteIndex = hash32(index * 13 + tileX * 41 + tileY * 73) % MOSAIC_PALETTE_SIZE;
      blitTile(
        cellBytes,
        cell,
        palette[paletteIndex]!,
        tileSize,
        tileX * tileSize,
        tileY * tileSize,
      );
    }
  }
  const cellPng = await sharp(cellBytes, {
    raw: { width: cell, height: cell, channels: 3 },
  }).png({ compressionLevel: 1 }).toBuffer();
  const cols = Math.max(1, Math.ceil(geometry.width / cell));
  const rows = Math.max(1, Math.ceil(geometry.height / cell));
  const pieceCache = new Map<string, Buffer>();
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const left = col * cell;
      const top = row * cell;
      const pieceWidth = Math.min(cell, geometry.width - left);
      const pieceHeight = Math.min(cell, geometry.height - top);
      if (pieceWidth <= 0 || pieceHeight <= 0) continue;
      const cacheKey = `${pieceWidth}x${pieceHeight}`;
      let piece = pieceCache.get(cacheKey);
      if (!piece) {
        piece = pieceWidth === cell && pieceHeight === cell
          ? cellPng
          : await sharp(cellPng)
            .extract({ left: 0, top: 0, width: pieceWidth, height: pieceHeight })
            .png({ compressionLevel: 0 })
            .toBuffer();
        pieceCache.set(cacheKey, piece);
      }
      composites.push({ input: piece, left, top });
    }
  }
  return sharp({
    create: {
      width: geometry.width,
      height: geometry.height,
      channels: 3,
      background: { r: channel(index, 11), g: channel(index, 29), b: channel(index, 47) },
    },
  }).composite(composites);
}

export async function createComplexImageBytes(
  index: number,
  extension: string,
  geometry: LargeLibraryImageGeometry = imageGeometryForIndex(index),
): Promise<Buffer> {
  const image = await createMosaicImage(index, geometry);
  const longEdge = Math.max(geometry.width, geometry.height);
  const highRes = longEdge >= 4096;
  if (extension === 'png') return image.png({ compressionLevel: 3 }).toBuffer();
  if (extension === 'webp') return image.webp({ quality: highRes ? 68 : 72, effort: 0 }).toBuffer();
  if (extension === 'gif') return image.gif().toBuffer();
  if (extension === 'tiff' || extension === 'tif') {
    return image.tiff({ compression: 'lzw' }).toBuffer();
  }
  return image.jpeg({ quality: highRes ? 68 : 78 }).toBuffer();
}

export function createToneWavBytes(index: number): Buffer {
  const sampleRate = 8_000;
  const durationSeconds = 0.25;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const frequency = 220 + (index % 48) * 17;
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const value = Math.sin((2 * Math.PI * frequency * sample) / sampleRate);
    buffer.writeInt16LE(Math.round(value * 12_000), 44 + sample * 2);
  }
  return buffer;
}

export function createObjModelBytes(index: number): Buffer {
  const scale = 1 + (index % 9) * 0.15;
  return Buffer.from(
    `# serpent large-library obj ${index}\n` +
      `v 0 0 0\nv ${scale} 0 0\nv 0 ${scale} 0\nv 0 0 ${scale}\n` +
      'f 1 2 3\nf 1 2 4\nf 1 3 4\nf 2 3 4\n',
    'utf8',
  );
}

export function createStlModelBytes(index: number): Buffer {
  const scale = 1 + (index % 7) * 0.2;
  return Buffer.from(
    `solid serpent-${index}\n` +
      `  facet normal 0 0 1\n    outer loop\n` +
      `      vertex 0 0 0\n      vertex ${scale} 0 0\n      vertex 0 ${scale} 0\n` +
      `    endloop\n  endfacet\nendsolid serpent-${index}\n`,
    'utf8',
  );
}

export function createGltfModelBytes(index: number): Buffer {
  return Buffer.from(
    JSON.stringify({
      asset: { version: '2.0', generator: `serpent-large-library-${index}` },
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${Buffer.alloc(36, index % 255).toString('base64')}` }],
    }),
    'utf8',
  );
}

export function createTextBytes(index: number, extension: string): Buffer {
  const body = `Serpent large-library ${index}\nseed-token line\n`;
  if (extension === 'json') {
    return Buffer.from(`${JSON.stringify({ index, kind: 'text', body }, null, 2)}\n`, 'utf8');
  }
  if (extension === 'csv') {
    return Buffer.from(`index,kind\n${index},text\n`, 'utf8');
  }
  if (extension === 'md') {
    return Buffer.from(`# Asset ${index}\n\n${body}`, 'utf8');
  }
  return Buffer.from(body, 'utf8');
}

export function createUnsupportedBytes(index: number): Buffer {
  const header = Buffer.from(`SERPENT-UNSUPPORTED-${pad(index)}`, 'utf8');
  const noise = Buffer.alloc(256);
  for (let offset = 0; offset < noise.length; offset += 1) {
    noise[offset] = hash32(index + offset * 17) % 256;
  }
  return Buffer.concat([header, noise]);
}

export async function createAssetBytes(
  kind: LargeLibraryAssetKind,
  index: number,
  extension: string,
  geometry?: LargeLibraryImageGeometry,
): Promise<Buffer> {
  switch (kind) {
    case 'image':
      return createComplexImageBytes(index, extension, geometry ?? imageGeometryForIndex(index));
    case 'audio':
      return createToneWavBytes(index);
    case 'model':
      if (extension === 'stl') return createStlModelBytes(index);
      if (extension === 'gltf') return createGltfModelBytes(index);
      return createObjModelBytes(index);
    case 'text':
      return createTextBytes(index, extension);
    case 'unsupported':
      return createUnsupportedBytes(index);
    case 'video':
      throw new Error('Video bytes must be created with createUniqueVideoFile.');
  }
}

export function videoDurationMs(): number {
  return Math.round(VIDEO_DURATION_SECONDS * 1000);
}

function videoEncoderArgs(extension: string, index: number): string[] {
  const { width, height } = videoGeometry();
  const hue = (index * 13) % 360;
  const common = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${width}x${height}:rate=12:duration=${VIDEO_DURATION_SECONDS},hue=h=${hue}:s=1.2`,
    '-an',
  ];
  if (extension === 'webm') {
    return [
      ...common,
      '-c:v',
      'libvpx-vp9',
      '-deadline',
      'realtime',
      '-cpu-used',
      '8',
      '-b:v',
      '400k',
      '-pix_fmt',
      'yuv420p',
    ];
  }
  // Product ffmpeg is LGPL: no libx264. mpeg4 is available on both platforms.
  const mpeg4 = [
    ...common,
    '-c:v',
    'mpeg4',
    '-q:v',
    '12',
    '-pix_fmt',
    'yuv420p',
  ];
  if (extension === 'mov') return [...mpeg4, '-f', 'mov'];
  return [...mpeg4, '-movflags', '+faststart'];
}

export function createUniqueVideoFile(outputPath: string, index: number, extension = 'mp4'): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const ffmpeg = resolveFfmpegPath();
  execFileSync(ffmpeg, [...videoEncoderArgs(extension, index), outputPath], { timeout: 30_000 });
}

export async function imageChannelVariance(bytes: Buffer): Promise<number> {
  const { data } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let total = 0;
  for (let offset = 0; offset < data.length; offset += 1) total += data[offset]!;
  const mean = total / data.length;
  let squares = 0;
  for (let offset = 0; offset < data.length; offset += 1) {
    const delta = data[offset]! - mean;
    squares += delta * delta;
  }
  return squares / data.length;
}
