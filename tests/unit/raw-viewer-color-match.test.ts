import { describe, expect, it } from 'vitest';

import {
  RAW_VIEWER_HISTOGRAM_BINS,
  rawViewerCdfDistance,
  rawViewerCdfFromProbe,
  rawViewerLuminanceCdf,
  rawViewerProbeArgs,
  rawViewerToneFromProbe,
} from '../../src/worker/raw-viewer-color-match';

function probeOutput(cdf: readonly number[], pixels: number): string {
  return cdf.map((fraction) => `0 < 0\n0 > 1\n${Math.round(fraction * pixels)} within range`).join('\n');
}

describe('RAW viewer camera-preview tone matching', () => {
  it('probes a small neutral RAW luminance histogram without writing a file', () => {
    const args = rawViewerProbeArgs('sample.ARW');
    expect(args).toEqual(expect.arrayContaining([
      '--iconfig', 'raw:half_size', '1', 'raw:auto_bright', '0',
      'raw:Demosaic', 'PPG', '--resize', '128x85',
      '--chsum:weight=0.2126,0.7152,0.0722',
    ]));
    expect(args.filter((arg) => arg === '--rangecheck')).toHaveLength(RAW_VIEWER_HISTOGRAM_BINS);
    expect(args).not.toContain('-o');
  });

  it('builds the luminance CDF from sRGB pixels and validates probe counts', () => {
    const pixels = Uint8Array.from([0, 0, 0, 255, 255, 255]);
    const cdf = rawViewerLuminanceCdf(pixels, 3)!;
    expect(cdf[0]).toBe(0.5);
    expect(cdf.at(-1)).toBe(1);
    expect(rawViewerCdfFromProbe(probeOutput(cdf, 2))).toEqual(cdf);
    expect(rawViewerLuminanceCdf(new Uint8Array(), 3)).toBeNull();
    expect(rawViewerCdfFromProbe('0 within range')).toBeNull();
    expect(rawViewerCdfFromProbe(probeOutput([...cdf.slice(0, -1), 0], 2))).toBeNull();
  });

  it('fits the tone distribution even when the two images have the same mean', () => {
    const source = rawViewerLuminanceCdf(Uint8Array.from([
      26, 26, 26, 230, 230, 230,
    ]), 3)!;
    const preview = rawViewerLuminanceCdf(Uint8Array.from([
      51, 51, 51, 204, 204, 204,
    ]), 3)!;
    expect(rawViewerCdfDistance(source, preview)).toBeGreaterThan(0);
    const tone = rawViewerToneFromProbe(preview, probeOutput(source, 2));
    expect(tone).not.toBeNull();
    expect(tone).not.toEqual({ gain: 1, power: 1 });
    // The source's two modes move toward the preview's modes, rather than
    // merely producing some non-identity parameter pair.
    expect(Math.abs((0.1 * tone!.gain) ** tone!.power - 0.2)).toBeLessThan(0.03);
    expect(Math.abs((0.9 * tone!.gain) ** tone!.power - 0.8)).toBeLessThan(0.03);
    expect(rawViewerToneFromProbe(source, probeOutput(source, 2)))
      .toEqual({ gain: 1, power: 1 });
    expect(rawViewerToneFromProbe(preview, 'malformed')).toBeNull();
  });
});
