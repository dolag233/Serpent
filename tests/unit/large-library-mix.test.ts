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
import { extensionForKind, kindForIndex, mixCountsFor } from '../worker/large-library-mix';

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
});

describe('large-library media bytes', () => {
  it('creates non-solid unique images that sharp can decode', async () => {
    const first = await createComplexImageBytes(12, 'jpg');
    const second = await createComplexImageBytes(13, 'jpg');
    const firstMeta = await sharp(first).metadata();
    const secondMeta = await sharp(second).metadata();
    expect(firstMeta.format).toBe('jpeg');
    expect(firstMeta.width).toBeGreaterThan(64);
    expect(firstMeta.height).toBeGreaterThan(64);
    expect(await imageChannelVariance(first)).toBeGreaterThan(80);
    expect(await imageChannelVariance(second)).toBeGreaterThan(80);
    expect(first.equals(second)).toBe(false);
  });

  it('creates a real WAV tone and a parseable OBJ', () => {
    const wav = createToneWavBytes(9);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(createObjModelBytes(4).toString('utf8')).toContain('f 1 2 3');
    expect(createUnsupportedBytes(3).includes(Buffer.from('SERPENT-UNSUPPORTED'))).toBe(true);
  });

  it('encodes a short unique testsrc video when ffmpeg is available', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'serpent-large-video-'));
    const outputPath = path.join(directory, 'clip.mp4');
    try {
      createUniqueVideoFile(outputPath, 21);
      const bytes = readFileSync(outputPath);
      expect(bytes.byteLength).toBeGreaterThan(1_000);
      expect(bytes.includes(Buffer.from('ftyp'))).toBe(true);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
