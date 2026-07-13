export interface RepresentativeColor {
  hex: string;
  ratio: number;
}

export interface DominantColorMetrics {
  hue: number;
  lightness: number;
}

interface HistogramBucket {
  key: number;
  count: number;
  red: number;
  green: number;
  blue: number;
}

interface Cluster {
  count: number;
  red: number;
  green: number;
  blue: number;
}

function colorDistanceSquared(
  left: Pick<Cluster, 'red' | 'green' | 'blue'>,
  right: Pick<Cluster, 'red' | 'green' | 'blue'>,
): number {
  const red = left.red - right.red;
  const green = left.green - right.green;
  const blue = left.blue - right.blue;
  return red * red + green * green + blue * blue;
}

function byteHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

export function dominantColorMetrics(hex: string): DominantColorMetrics {
  if (!/^#[0-9A-Fa-f]{6}$/u.test(hex)) throw new Error('Dominant colour must be a six-digit hex value.');
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return {
    hue: Number(hue.toFixed(6)),
    lightness: Number(((maximum + minimum) / 2).toFixed(6)),
  };
}

/**
 * Deterministic, bounded representative-colour extraction for already decoded
 * sRGB pixels. Quantized histogram peaks seed a small weighted k-means pass;
 * no randomness means identical content always produces identical JSON.
 */
export function extractRepresentativePalette(
  pixels: Uint8Array,
  channels: number,
  maxColors = 6,
): RepresentativeColor[] {
  if (!Number.isInteger(channels) || channels < 3 || channels > 4) {
    throw new Error('Palette pixels must contain RGB or RGBA channels.');
  }
  if (pixels.length === 0 || pixels.length % channels !== 0) {
    throw new Error('Palette pixel buffer is empty or misaligned.');
  }
  const colorLimit = Math.max(1, Math.min(12, Math.trunc(maxColors)));
  const histogram = new Map<number, HistogramBucket>();

  for (let offset = 0; offset < pixels.length; offset += channels) {
    if (channels === 4 && pixels[offset + 3]! < 16) continue;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    // Four high bits per component keep the histogram bounded to 4096 bins.
    const key = (red >> 4) << 8 | (green >> 4) << 4 | (blue >> 4);
    const bucket = histogram.get(key) ?? { key, count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += red;
    bucket.green += green;
    bucket.blue += blue;
    histogram.set(key, bucket);
  }

  const buckets = [...histogram.values()];
  if (buckets.length === 0) return [];
  buckets.sort((left, right) => right.count - left.count || left.key - right.key);

  let clusters: Cluster[] = buckets.slice(0, colorLimit).map((bucket) => ({
    count: bucket.count,
    red: bucket.red / bucket.count,
    green: bucket.green / bucket.count,
    blue: bucket.blue / bucket.count,
  }));

  // A few deterministic passes merge the complete histogram into the seeds,
  // so the emitted ratios cover the whole visible image and sum to one.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const assignments = clusters.map(() => ({ count: 0, red: 0, green: 0, blue: 0 }));
    for (const bucket of buckets) {
      const color = {
        red: bucket.red / bucket.count,
        green: bucket.green / bucket.count,
        blue: bucket.blue / bucket.count,
      };
      let selected = 0;
      let selectedDistance = colorDistanceSquared(color, clusters[0]!);
      for (let index = 1; index < clusters.length; index += 1) {
        const distance = colorDistanceSquared(color, clusters[index]!);
        if (distance < selectedDistance) {
          selected = index;
          selectedDistance = distance;
        }
      }
      const assignment = assignments[selected]!;
      assignment.count += bucket.count;
      assignment.red += bucket.red;
      assignment.green += bucket.green;
      assignment.blue += bucket.blue;
    }
    clusters = assignments
      .filter((assignment) => assignment.count > 0)
      .map((assignment) => ({
        count: assignment.count,
        red: assignment.red / assignment.count,
        green: assignment.green / assignment.count,
        blue: assignment.blue / assignment.count,
      }));
  }

  const merged = new Map<string, number>();
  const total = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
  for (const cluster of clusters) {
    const hex = `#${byteHex(cluster.red)}${byteHex(cluster.green)}${byteHex(cluster.blue)}`;
    merged.set(hex, (merged.get(hex) ?? 0) + cluster.count);
  }
  const result = [...merged.entries()]
    .map(([hex, count]) => ({ hex, ratio: count / total, count }))
    .sort((left, right) => right.count - left.count || left.hex.localeCompare(right.hex))
    .map(({ hex, ratio }) => ({ hex, ratio: Number(ratio.toFixed(6)) }));

  // Keep persisted ratios exactly normalized despite decimal rounding.
  const roundedTotal = result.reduce((sum, color) => sum + color.ratio, 0);
  if (result[0] && roundedTotal !== 1) {
    result[0].ratio = Number((result[0].ratio + 1 - roundedTotal).toFixed(6));
  }
  return result;
}
