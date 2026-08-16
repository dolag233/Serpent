import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { isAudioFileName } from '../../src/shared/audio-media';
import {
  isSupportedImageExtension,
  isSupportedModelExtension,
  isSupportedVideoExtension,
} from '../../src/shared/media-formats';
import { isTextFileName } from '../../src/shared/text-media';
import {
  createComplexImageBytes,
  createObjModelBytes,
  createToneWavBytes,
  createUniqueVideoFile,
  createUnsupportedBytes,
  imageChannelVariance,
} from '../worker/large-library-media';
import {
  IMAGE_EXTENSIONS,
  IMAGE_SIZE_LONG_EDGE,
  VIDEO_EXTENSIONS,
  extensionForKind,
  imageGeometryForIndex,
  imagePoolKey,
  kindForIndex,
  mixCountsFor,
  sizeBucketForIndex,
} from '../worker/large-library-mix';

describe('large-library mix', () => {
  it('keeps 5/1/1/1/1 percent buckets and puts the remainder on images', () => {
    const counts = mixCountsFor(20_000);
    expect(counts).toMatchObject({
      assetCount: 20_000,
      imageCount: 18_200,
      videoCount: 1_000,
      modelCount: 200,
      textCount: 200,
      audioCount: 200,
      unsupportedCount: 200,
    });
    const tallies = {
      image: 0,
      video: 0,
      model: 0,
      text: 0,
      audio: 0,
      unsupported: 0,
    };
    for (let index = 0; index < counts.assetCount; index += 1) {
      tallies[kindForIndex(index, counts)] += 1;
    }
    expect(tallies).toEqual({
      image: 18_200,
      video: 1_000,
      model: 200,
      text: 200,
      audio: 200,
      unsupported: 200,
    });
  });

  it('uses unsupported extensions that are absent from product format registries', () => {
    for (let index = 0; index < 12; index += 1) {
      const filename = `asset.${extensionForKind('unsupported', index)}`;
      expect(isSupportedImageExtension(filename)).toBe(false);
      expect(isSupportedVideoExtension(filename)).toBe(false);
      expect(isSupportedModelExtension(filename)).toBe(false);
      expect(isAudioFileName(filename)).toBe(false);
      expect(isTextFileName(filename)).toBe(false);
    }
  });

  it('covers gif/tiff stills, mp4/webm/mov, and 8K/4K/2K/1K image buckets', () => {
    expect([...IMAGE_EXTENSIONS]).toEqual(['jpg', 'png', 'webp', 'gif', 'tiff']);
    expect([...VIDEO_EXTENSIONS]).toEqual(['mp4', 'webm', 'mov']);
    for (const extension of IMAGE_EXTENSIONS) {
      expect(isSupportedImageExtension(`asset.${extension}`)).toBe(true);
    }
    for (const extension of VIDEO_EXTENSIONS) {
      expect(isSupportedVideoExtension(`asset.${extension}`)).toBe(true);
    }

    const counts = mixCountsFor(20_000);
    const buckets = { '1k': 0, '2k': 0, '4k': 0, '8k': 0 };
    const imageExtensions = new Set<string>();
    const longEdges = new Set<number>();
    const keys = new Set<string>();
    for (let index = 0; index < counts.imageCount; index += 1) {
      const bucket = sizeBucketForIndex(index);
      buckets[bucket] += 1;
      const extension = extensionForKind('image', index);
      const geometry = imageGeometryForIndex(index);
      imageExtensions.add(extension);
      longEdges.add(Math.max(geometry.width, geometry.height));
      keys.add(imagePoolKey(extension, geometry));
      expect(Math.max(geometry.width, geometry.height)).toBe(IMAGE_SIZE_LONG_EDGE[bucket]);
    }
    expect(buckets).toEqual({
      '8k': 182,
      '4k': 546,
      '2k': 5_460,
      '1k': 12_012,
    });
    expect(imageExtensions).toEqual(new Set(IMAGE_EXTENSIONS));
    expect([...longEdges].sort((left, right) => left - right)).toEqual([1024, 2048, 4096, 8192]);
    expect(keys.size).toBeGreaterThanOrEqual(40);
  });
});

describe('large-library media bytes', () => {
  it('creates non-solid mosaic images that sharp can decode at 1K geometry', async () => {
    const geometry = imageGeometryForIndex(34);
    expect(Math.max(geometry.width, geometry.height)).toBe(1024);
    const first = await createComplexImageBytes(34, 'jpg', geometry);
    const second = await createComplexImageBytes(35, 'jpg', imageGeometryForIndex(35));
    const firstMeta = await sharp(first).metadata();
    expect(firstMeta.format).toBe('jpeg');
    expect(firstMeta.width).toBe(geometry.width);
    expect(firstMeta.height).toBe(geometry.height);
    expect(first.byteLength).toBeGreaterThan(20_000);
    expect(await imageChannelVariance(first)).toBeGreaterThan(80);
    expect(await imageChannelVariance(second)).toBeGreaterThan(80);
    expect(first.equals(second)).toBe(false);
  });

  it('encodes gif and tiff stills that sharp can decode', async () => {
    const geometry = { width: 1024, height: 576 };
    const gif = await createComplexImageBytes(38, 'gif', geometry);
    const tiff = await createComplexImageBytes(39, 'tiff', geometry);
    const gifMeta = await sharp(gif).metadata();
    const tiffMeta = await sharp(tiff).metadata();
    expect(gifMeta.format).toBe('gif');
    expect(tiffMeta.format).toBe('tiff');
    expect(gifMeta.width).toBe(1024);
    expect(tiffMeta.height).toBe(576);
  });

  it('creates a real WAV tone and a parseable OBJ', () => {
    const wav = createToneWavBytes(9);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(createObjModelBytes(4).toString('utf8')).toContain('f 1 2 3');
    expect(createUnsupportedBytes(3).includes(Buffer.from('SERPENT-UNSUPPORTED'))).toBe(true);
  });

  it('encodes short unique mp4 and webm clips when ffmpeg is available', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'serpent-large-video-'));
    try {
      const mp4Path = path.join(directory, 'clip.mp4');
      createUniqueVideoFile(mp4Path, 21, 'mp4');
      const mp4 = readFileSync(mp4Path);
      expect(mp4.byteLength).toBeGreaterThan(1_000);
      expect(mp4.includes(Buffer.from('ftyp'))).toBe(true);

      const webmPath = path.join(directory, 'clip.webm');
      createUniqueVideoFile(webmPath, 22, 'webm');
      const webm = readFileSync(webmPath);
      expect(webm.byteLength).toBeGreaterThan(1_000);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
