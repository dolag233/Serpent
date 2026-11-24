import { describe, expect, it } from 'vitest';

import { loadSharp } from '../../src/shared/load-sharp';

describe('Sharp under the Electron runtime', () => {
  it('encodes and decodes without a native allocator abort', async () => {
    const sharp = loadSharp();
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    }).png().toBuffer();
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const jpeg = await sharp(png).jpeg().toBuffer();
    const metadata = await sharp(jpeg).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(8);
    expect(metadata.height).toBe(8);
  });
});
