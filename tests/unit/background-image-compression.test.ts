import { describe, expect, it, vi } from 'vitest';

import {
  BACKGROUND_IMAGE_DOWNSCALE_FACTOR,
  BACKGROUND_IMAGE_ENCODE_QUALITIES,
  BACKGROUND_IMAGE_MAX_DIMENSION,
  BACKGROUND_IMAGE_MIN_DIMENSION,
  backgroundImageEncodeAttempts,
  compressBackgroundImage,
  fitWithinMaxDimension,
  formatBackgroundBytes,
  type BackgroundImageCodec,
} from '../../src/renderer/theme/background-image-compression';
import { MAX_BACKGROUND_IMAGE_DATA_URL_BYTES } from '../../src/renderer/theme/background-preferences';

/** Builds a data URL of roughly the requested UTF-8 byte size. */
function dataUrlOfBytes(mime: string, bytes: number): string {
  const prefix = `data:${mime};base64,`;
  const payloadBytes = Math.max(0, bytes - prefix.length);
  return `${prefix}${'A'.repeat(payloadBytes)}`;
}

function makeFile(name: string, type: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function passThroughCodec(): BackgroundImageCodec {
  return {
    decode: async (file) => ({
      dataUrl: dataUrlOfBytes(file.type, file.size * 1.33),
      width: 1920,
      height: 1080,
    }),
    encode: async (dataUrl) => ({ dataUrl, width: 1920, height: 1080 }),
  };
}

describe('fitWithinMaxDimension', () => {
  it('passes through images already within the bound', () => {
    expect(fitWithinMaxDimension(1920, 1080, 2560)).toEqual({ width: 1920, height: 1080 });
  });

  it('downscales the longest edge to the bound, preserving aspect ratio', () => {
    expect(fitWithinMaxDimension(5120, 2880, 2560)).toEqual({ width: 2560, height: 1440 });
  });

  it('never produces a zero dimension and tolerates garbage input', () => {
    expect(fitWithinMaxDimension(1, 10000, 2560)).toEqual({ width: 1, height: 2560 });
    expect(fitWithinMaxDimension(0, -5, 2560)).toEqual({ width: 0, height: -5 });
  });
});

describe('backgroundImageEncodeAttempts', () => {
  it('tries the full quality ladder before downscaling', () => {
    const attempts = [...backgroundImageEncodeAttempts(5120, 2880)];
    const firstStep = attempts.slice(0, BACKGROUND_IMAGE_ENCODE_QUALITIES.length);
    expect(firstStep.map((attempt) => attempt.quality)).toEqual([...BACKGROUND_IMAGE_ENCODE_QUALITIES]);
    expect(firstStep.every((attempt) => attempt.width === 4096 && attempt.height === 2304)).toBe(true);
    expect(attempts[BACKGROUND_IMAGE_ENCODE_QUALITIES.length]!.width).toBeLessThan(4096);
  });

  it('stops once the canvas hits the minimum dimension', () => {
    // Square input: width and height hit the floor in the same step, so the
    // width sequence runs the full 10 downscale steps (4096 → … → 320).
    const attempts = [...backgroundImageEncodeAttempts(8000, 8000)];
    const widths = attempts.map((attempt) => attempt.width);
    expect(widths[0]).toBe(4096);
    expect(Math.min(...widths)).toBe(BACKGROUND_IMAGE_MIN_DIMENSION);
    expect(new Set(widths).size).toBe(10);
    expect(attempts.length).toBe(10 * BACKGROUND_IMAGE_ENCODE_QUALITIES.length);
  });
});

describe('compressBackgroundImage', () => {
  it('passes through small files untouched without touching the encoder', () => {
    const encode = vi.fn(async (dataUrl: string) => ({ dataUrl, width: 1, height: 1 }));
    const codec: BackgroundImageCodec = { decode: passThroughCodec().decode, encode };

    const file = makeFile('photo.png', 'image/png', 1024);
    return compressBackgroundImage(file, 10_000, codec).then((result) => {
      expect(result.compressed).toBe(false);
      expect(result.animationLost).toBe(false);
      expect(result.originalBytes).toBe(1024);
      expect(encode).not.toHaveBeenCalled();
    });
  });

  it('re-encodes oversized files until the payload fits the budget', async () => {
    const encode = vi
      .fn<BackgroundImageCodec['encode']>()
      .mockResolvedValueOnce({ dataUrl: dataUrlOfBytes('image/webp', 20_000), width: 2560, height: 1440 })
      .mockResolvedValueOnce({ dataUrl: dataUrlOfBytes('image/webp', 5_000), width: 2560, height: 1440 });

    const file = makeFile('huge.png', 'image/png', 100_000);
    const result = await compressBackgroundImage(file, 10_000, {
      decode: passThroughCodec().decode,
      encode,
    });

    expect(encode).toHaveBeenCalledTimes(2);
    expect(result.compressed).toBe(true);
    expect(result.dataUrl).toHaveLength(5_000);
    expect(result.animationLost).toBe(false);
  });

  it('falls back to the last attempt when every encode exceeds the budget', async () => {
    const encode = vi.fn<BackgroundImageCodec['encode']>(async (dataUrl) => ({
      dataUrl,
      width: 320,
      height: 180,
    }));
    const file = makeFile('x.webp', 'image/webp', 100_000);
    const result = await compressBackgroundImage(file, 512, {
      decode: passThroughCodec().decode,
      encode,
    });

    expect(encode.mock.calls.length).toBeGreaterThan(1);
    expect(result.width).toBe(320);
  });

  it('does not claim compression when every encode attempt failed', async () => {
    // Regression: a fully-failing codec used to report `compressed: true`
    // with the original payload ("compressed to 8 MB (was 8 MB)").
    const encode = vi
      .fn<BackgroundImageCodec['encode']>()
      .mockRejectedValue(new Error('codec broken'));
    const file = makeFile('x.png', 'image/png', 100_000);
    const result = await compressBackgroundImage(file, 512, {
      decode: passThroughCodec().decode,
      encode,
    });

    expect(encode).toHaveBeenCalled();
    expect(result.compressed).toBe(false);
    expect(result.animationLost).toBe(false);
    expect(result.width).toBe(1920); // original passthrough dimensions
  });

  it('flags animated GIFs that had to be re-encoded', async () => {
    const encode = vi.fn<BackgroundImageCodec['encode']>(async (dataUrl) => ({
      dataUrl,
      width: 2560,
      height: 1440,
    }));
    const file = makeFile('anim.gif', 'image/gif', 100_000);
    const result = await compressBackgroundImage(file, 10_000, {
      decode: passThroughCodec().decode,
      encode,
    });

    expect(result.compressed).toBe(true);
    expect(result.animationLost).toBe(true);
  });

  it('keeps animated GIFs animated when they already fit', async () => {
    const file = makeFile('anim.gif', 'image/gif', 1_024);
    const result = await compressBackgroundImage(file, 10_000, passThroughCodec());
    expect(result.compressed).toBe(false);
    expect(result.animationLost).toBe(false);
  });

  it('tries JPEG when the codec rejects WebP encoding', async () => {
    const encode = vi.fn<BackgroundImageCodec['encode']>()
      .mockRejectedValueOnce(new Error('webp unsupported'))
      .mockResolvedValueOnce({ dataUrl: dataUrlOfBytes('image/jpeg', 8_000), width: 2560, height: 1440 });

    const file = makeFile('huge.jpg', 'image/jpeg', 100_000);
    const result = await compressBackgroundImage(file, 10_000, {
      decode: passThroughCodec().decode,
      encode,
    });

    expect(encode).toHaveBeenCalledTimes(2);
    expect(result.dataUrl).toContain('data:image/jpeg');
  });

  it('reports byte sizes that never exceed the budget when compressed', async () => {
    const file = makeFile('large.png', 'image/png', 100_000);
    const result = await compressBackgroundImage(
      file,
      MAX_BACKGROUND_IMAGE_DATA_URL_BYTES,
      passThroughCodec(),
    );
    expect(result.encodedBytes).toBeLessThanOrEqual(MAX_BACKGROUND_IMAGE_DATA_URL_BYTES);
    expect(result.originalBytes).toBe(100_000);
  });
});

describe('formatBackgroundBytes', () => {
  it('formats bytes in a compact, human-readable way', () => {
    expect(formatBackgroundBytes(500)).toBe('500 B');
    expect(formatBackgroundBytes(2048)).toBe('2 KB');
    expect(formatBackgroundBytes(1_200_000)).toBe('1.1 MB');
    expect(formatBackgroundBytes(0)).toBe('0 B');
  });
});

describe('browser codec contract', () => {
  it('exposes the default codec referenced by compressBackgroundImage', () => {
    expect(BACKGROUND_IMAGE_DOWNSCALE_FACTOR).toBe(0.75);
    expect(BACKGROUND_IMAGE_MAX_DIMENSION).toBe(4096);
  });
});
