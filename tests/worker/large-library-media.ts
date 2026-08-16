import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { resolveFfmpegPath } from '../../src/worker/binary-resolver';
import { pad, type LargeLibraryAssetKind } from './large-library-mix';

const IMAGE_WIDTH = 160;
const IMAGE_HEIGHT = 120;

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

export async function createComplexImageBytes(index: number, extension: string): Promise<Buffer> {
  const hue = (index * 47) % 360;
  const background = {
    r: channel(index, 11),
    g: channel(index, 29),
    b: channel(index, 47),
  };
  const overlay = Buffer.alloc(IMAGE_WIDTH * IMAGE_HEIGHT * 3);
  for (let y = 0; y < IMAGE_HEIGHT; y += 1) {
    for (let x = 0; x < IMAGE_WIDTH; x += 1) {
      const offset = (y * IMAGE_WIDTH + x) * 3;
      const noise = hash32(index * 997 + x * 13 + y * 29) % 48;
      const stripe = ((x + y + index) % 17) < 4 ? 40 : 0;
      const radial = Math.hypot(x - IMAGE_WIDTH / 2, y - IMAGE_HEIGHT / 2);
      overlay[offset] = Math.min(255, background.r + noise + stripe);
      overlay[offset + 1] = Math.min(255, background.g + (x % 24) + (radial % 18));
      overlay[offset + 2] = Math.min(255, background.b + (y % 19) + noise);
    }
  }
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_WIDTH}" height="${IMAGE_HEIGHT}">
      <rect x="${8 + (index % 20)}" y="${6 + (index % 15)}" width="48" height="28" fill="hsl(${hue},70%,45%)"/>
      <circle cx="${40 + (index % 80)}" cy="${40 + (index % 50)}" r="18" fill="hsl(${(hue + 80) % 360},65%,55%)"/>
      <polygon points="${120},${20 + (index % 30)} ${150},${90} ${90 + (index % 25)},${100}" fill="hsl(${(hue + 160) % 360},60%,40%)"/>
    </svg>`,
    'utf8',
  );
  const image = sharp(overlay, {
    raw: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT, channels: 3 },
  }).composite([{ input: svg }]);
  if (extension === 'png') return image.png({ compressionLevel: 4 }).toBuffer();
  if (extension === 'webp') return image.webp({ quality: 72 }).toBuffer();
  return image.jpeg({ quality: 78 }).toBuffer();
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

export async function createAssetBytes(kind: LargeLibraryAssetKind, index: number, extension: string): Promise<Buffer> {
  switch (kind) {
    case 'image':
      return createComplexImageBytes(index, extension);
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

export function createUniqueVideoFile(outputPath: string, index: number): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  const hue = (index * 13) % 360;
  const ffmpeg = resolveFfmpegPath();
  execFileSync(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=160x90:rate=12:duration=0.5,hue=h=${hue}:s=1.2`,
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      '-crf',
      '32',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { timeout: 20_000 },
  );
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
