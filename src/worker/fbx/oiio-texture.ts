/**
 * Decode an FBX texture that Chromium cannot open.
 *
 * OpenImageIO is the decoder already used for TGA and the other formats
 * sharp does not read. The temporary PNG is only oiiotool's output file;
 * the caller keeps the raw pixels and deletes the file. When oiiotool is
 * unavailable, uncompressed and RLE truecolor TGA still decode locally.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveOiiotoolPath } from '../binary-resolver';
import { literalOiioArgs } from '../oiio-invocation';
import { decodeTgaRgba } from './tga-image';

export interface DecodedTextureRgba {
  readonly width: number;
  readonly height: number;
  readonly rgba: Buffer;
}

export async function decodeTextureToRgba(
  bytes: Buffer,
  filename: string,
): Promise<DecodedTextureRgba | null> {
  const decoded = await decodeWithOiio(bytes, filename);
  if (decoded) return decoded;
  const tga = decodeTgaRgba(bytes);
  if (!tga) return null;
  return { width: tga.width, height: tga.height, rgba: tga.rgba };
}

async function decodeWithOiio(
  bytes: Buffer,
  filename: string,
): Promise<DecodedTextureRgba | null> {
  const extension = safeExtension(filename);
  const directory = await mkdtemp(path.join(tmpdir(), 'serpent-tex-'));
  try {
    const input = path.join(directory, `source${extension}`);
    const output = path.join(directory, 'decoded.png');
    await writeFile(input, bytes);
    const exitCode = await runOiio([input, '-d', 'uint8', '-o', output]);
    if (exitCode !== 0) return null;
    const png = await readFile(output);
    const { default: sharp } = await import('sharp');
    const image = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (image.info.channels !== 4 || image.info.width <= 0 || image.info.height <= 0) {
      return null;
    }
    return {
      width: image.info.width,
      height: image.info.height,
      rgba: image.data,
    };
  } catch {
    return null;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function safeExtension(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/u.test(extension) ? extension : '.tga';
}

function runOiio(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    execFile(resolveOiiotoolPath(), literalOiioArgs(args), { timeout: 120_000 }, (error) => {
      if (!error) {
        resolve(0);
        return;
      }
      const code = (error as { code?: unknown }).code;
      resolve(typeof code === 'number' ? code : 1);
    });
  });
}
