/**
 * Approximate the camera JPEG's global tone rendering for the full RAW decode.
 * Both inputs are already display-encoded sRGB. The camera's JPEG processing
 * changes the tone curve, so a color-space tag or a single RGB mean cannot
 * describe the difference. Probe a small neutral RAW image without writing a
 * file, then fit one shared exposure/curve to its luminance distribution.
 * A shared curve preserves hue better than independent channel gamma values.
 */

export interface RawViewerTone {
  gain: number;
  power: number;
}

export const RAW_VIEWER_HISTOGRAM_BINS = 64;

const LUMINANCE_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;
const RANGE_COUNT = /\b(\d+)\s+within range\b/gu;

export function rawViewerProbeArgs(assetPath: string): string[] {
  const args = [
    '--iconfig', 'raw:half_size', '1',
    '--iconfig', 'raw:auto_bright', '0',
    '--iconfig', 'raw:Demosaic', 'PPG',
    '--subimage', '0', assetPath,
    '--resize', '128x85',
    '--chsum:weight=0.2126,0.7152,0.0722',
  ];
  for (let bin = 1; bin <= RAW_VIEWER_HISTOGRAM_BINS; bin += 1) {
    args.push('--rangecheck', '0', String(bin / RAW_VIEWER_HISTOGRAM_BINS));
  }
  return args;
}

export function rawViewerLuminanceCdf(data: Uint8Array, channels: number): number[] | null {
  if (channels < 3 || data.length === 0 || data.length % channels !== 0) return null;
  const bins = new Array<number>(RAW_VIEWER_HISTOGRAM_BINS).fill(0);
  for (let offset = 0; offset < data.length; offset += channels) {
    const luminance = (
      LUMINANCE_WEIGHTS[0] * data[offset]!
      + LUMINANCE_WEIGHTS[1] * data[offset + 1]!
      + LUMINANCE_WEIGHTS[2] * data[offset + 2]!
    ) / 255;
    const bin = Math.min(RAW_VIEWER_HISTOGRAM_BINS - 1,
      Math.floor(luminance * RAW_VIEWER_HISTOGRAM_BINS));
    bins[bin]! += 1;
  }
  const pixels = data.length / channels;
  let cumulative = 0;
  return bins.map((count) => {
    cumulative += count;
    return cumulative / pixels;
  });
}

export function rawViewerCdfFromProbe(stdout: string): number[] | null {
  const counts = [...stdout.matchAll(RANGE_COUNT)].map((match) => Number(match[1]));
  if (counts.length !== RAW_VIEWER_HISTOGRAM_BINS) return null;
  const total = counts.at(-1)!;
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  let previous = 0;
  for (const count of counts) {
    if (!Number.isSafeInteger(count) || count < previous || count > total) return null;
    previous = count;
  }
  return counts.map((count) => count / total);
}

export function rawViewerCdfDistance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== RAW_VIEWER_HISTOGRAM_BINS || right.length !== RAW_VIEWER_HISTOGRAM_BINS) {
    return Number.POSITIVE_INFINITY;
  }
  let distance = 0;
  for (let bin = 0; bin < RAW_VIEWER_HISTOGRAM_BINS; bin += 1) {
    distance += Math.abs(left[bin]! - right[bin]!);
  }
  return distance / RAW_VIEWER_HISTOGRAM_BINS;
}

function transformedCdf(source: readonly number[], gain: number, power: number): number[] {
  const bins = new Array<number>(RAW_VIEWER_HISTOGRAM_BINS).fill(0);
  let previous = 0;
  for (let bin = 0; bin < RAW_VIEWER_HISTOGRAM_BINS; bin += 1) {
    const fraction = source[bin]! - previous;
    previous = source[bin]!;
    const input = (bin + 0.5) / RAW_VIEWER_HISTOGRAM_BINS;
    const output = Math.min(1, Math.pow(Math.min(1, input * gain), power));
    const outputBin = Math.min(RAW_VIEWER_HISTOGRAM_BINS - 1,
      Math.floor(output * RAW_VIEWER_HISTOGRAM_BINS));
    bins[outputBin]! += fraction;
  }
  let cumulative = 0;
  return bins.map((fraction) => {
    cumulative += fraction;
    return cumulative;
  });
}

export function rawViewerToneFromProbe(
  previewCdf: readonly number[],
  stdout: string,
): RawViewerTone | null {
  const sourceCdf = rawViewerCdfFromProbe(stdout);
  if (!sourceCdf || previewCdf.length !== RAW_VIEWER_HISTOGRAM_BINS
    || previewCdf.at(-1) !== 1
    || previewCdf.some((value, index) => !Number.isFinite(value)
      || value < 0 || value > 1 || (index > 0 && value < previewCdf[index - 1]!))) return null;

  let best: RawViewerTone = { gain: 1, power: 1 };
  let bestDistance = rawViewerCdfDistance(sourceCdf, previewCdf);
  // The bounded two-parameter search fits both dark and bright photographs.
  // Avoid a per-channel match: it changes hue and can wash out dark backgrounds.
  for (let gainStep = 10; gainStep <= 60; gainStep += 1) {
    const gain = gainStep / 20;
    for (let powerStep = 16; powerStep <= 80; powerStep += 1) {
      const power = powerStep / 40;
      const distance = rawViewerCdfDistance(
        transformedCdf(sourceCdf, gain, power), previewCdf,
      );
      if (distance < bestDistance - 0.0001) {
        bestDistance = distance;
        best = { gain, power };
      }
    }
  }
  return best;
}
