import { describe, expect, it } from 'vitest';

import { dominantColorMetrics, extractRepresentativePalette } from '../../src/worker/palette-extractor';

describe('extractRepresentativePalette', () => {
  it('is deterministic and reports normalized representative ratios', () => {
    const pixels = new Uint8Array([
      255, 0, 0, 255,
      250, 4, 3, 255,
      0, 0, 255, 255,
      255, 0, 0, 255,
    ]);

    const first = extractRepresentativePalette(pixels, 4, 4);
    const second = extractRepresentativePalette(pixels, 4, 4);

    expect(second).toEqual(first);
    expect(first).toEqual([
      { hex: '#FD0101', ratio: 0.75 },
      { hex: '#0000FF', ratio: 0.25 },
    ]);
    expect(first.reduce((sum, color) => sum + color.ratio, 0)).toBe(1);
  });

  it('ignores fully transparent pixels and uses a stable colour tie-break', () => {
    const palette = extractRepresentativePalette(new Uint8Array([
      0, 255, 0, 255,
      255, 0, 0, 255,
      0, 0, 0, 0,
    ]), 4, 6);

    expect(palette).toEqual([
      { hex: '#00FF00', ratio: 0.5 },
      { hex: '#FF0000', ratio: 0.5 },
    ]);
  });

  it('rejects malformed decoded buffers', () => {
    expect(() => extractRepresentativePalette(new Uint8Array(), 4)).toThrow(/empty/u);
    expect(() => extractRepresentativePalette(new Uint8Array([1, 2, 3]), 2)).toThrow(/RGB/u);
  });

  it('derives stable dominant hue and lightness for indexed colour sorting', () => {
    expect(dominantColorMetrics('#FF0000')).toEqual({ hue: 0, lightness: 0.5 });
    expect(dominantColorMetrics('#00FF00')).toEqual({ hue: 120, lightness: 0.5 });
    expect(dominantColorMetrics('#0000FF')).toEqual({ hue: 240, lightness: 0.5 });
  });
});
