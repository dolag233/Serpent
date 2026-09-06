/**
 * Serpent-noz: classify local image luminance so viewer chrome (<prev/next>)
 * can flip to light-on-dark or dark-on-light for readability.
 *
 * Sampling prefers edge strips where those controls sit (left / right).
 * Relative luminance uses sRGB → linear → Rec. 709 weights.
 */

export type ViewerChromeContrast = "on-dark" | "on-light";

export type RgbaSample = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
};

/** WCAG-style relative luminance in [0, 1]. */
export function relativeLuminance(sample: RgbaSample): number {
  const channel = (value: number) => {
    const s = Math.min(255, Math.max(0, value)) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(sample.r);
  const g = channel(sample.g);
  const b = channel(sample.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Mean relative luminance of opaque-ish samples. Transparent / empty samples
 * are ignored; returns null when nothing usable was provided.
 */
export function meanRelativeLuminance(
  samples: readonly RgbaSample[],
): number | null {
  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    const alpha = sample.a ?? 255;
    if (alpha < 16) continue;
    sum += relativeLuminance(sample);
    count += 1;
  }
  if (count === 0) return null;
  return sum / count;
}

/**
 * Map luminance to chrome contrast. Mid-gray bias (~0.45) keeps light icons
 * on typical photo midtones (often darker than UI chrome).
 */
export function contrastFromLuminance(
  luminance: number | null,
  fallback: ViewerChromeContrast = "on-dark",
): ViewerChromeContrast {
  if (luminance == null || Number.isNaN(luminance)) return fallback;
  return luminance < 0.45 ? "on-dark" : "on-light";
}

export type ViewerChromeSampleRegion = "prev" | "next";

/**
 * Sample grid points inside a region of an ImageData buffer.
 * Regions are fractions of the source width/height (edge-biased).
 */
export function sampleImageDataRegion(
  image: ImageData,
  region: ViewerChromeSampleRegion,
  grid = 4,
): RgbaSample[] {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) return [];

  let x0: number;
  let x1: number;
  let y0: number;
  let y1: number;
  switch (region) {
    case "prev":
      x0 = 0;
      x1 = Math.max(1, Math.floor(width * 0.12));
      y0 = Math.floor(height * 0.35);
      y1 = Math.floor(height * 0.65);
      break;
    case "next":
      x0 = Math.floor(width * 0.88);
      x1 = width;
      y0 = Math.floor(height * 0.35);
      y1 = Math.floor(height * 0.65);
      break;
  }

  const samples: RgbaSample[] = [];
  const spanX = Math.max(1, x1 - x0);
  const spanY = Math.max(1, y1 - y0);
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const x = Math.min(
        width - 1,
        x0 + Math.floor(((gx + 0.5) / grid) * spanX),
      );
      const y = Math.min(
        height - 1,
        y0 + Math.floor(((gy + 0.5) / grid) * spanY),
      );
      const i = (y * width + x) * 4;
      samples.push({
        r: data[i] ?? 0,
        g: data[i + 1] ?? 0,
        b: data[i + 2] ?? 0,
        a: data[i + 3] ?? 255,
      });
    }
  }
  return samples;
}

export function contrastForImageDataRegion(
  image: ImageData,
  region: ViewerChromeSampleRegion,
  fallback: ViewerChromeContrast = "on-dark",
): ViewerChromeContrast {
  return contrastFromLuminance(
    meanRelativeLuminance(sampleImageDataRegion(image, region)),
    fallback,
  );
}

/**
 * Draw a media element into a small canvas and return ImageData, or null when
 * the source is not ready / canvas is tainted.
 */
export function readMediaImageData(
  source: CanvasImageSource,
  maxEdge = 64,
): ImageData | null {
  try {
    const width =
      "videoWidth" in source && typeof source.videoWidth === "number"
        ? source.videoWidth
        : "naturalWidth" in source && typeof source.naturalWidth === "number"
          ? source.naturalWidth
          : "width" in source && typeof source.width === "number"
            ? Number(source.width)
            : 0;
    const height =
      "videoHeight" in source && typeof source.videoHeight === "number"
        ? source.videoHeight
        : "naturalHeight" in source && typeof source.naturalHeight === "number"
          ? source.naturalHeight
          : "height" in source && typeof source.height === "number"
            ? Number(source.height)
            : 0;
    if (!width || !height) return null;

    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }
}

export type ViewerChromeContrastMap = {
  readonly prev: ViewerChromeContrast;
  readonly next: ViewerChromeContrast;
};

export function resolveViewerChromeContrasts(
  image: ImageData | null,
  fallback: ViewerChromeContrast = "on-dark",
): ViewerChromeContrastMap {
  if (!image) {
    return { prev: fallback, next: fallback };
  }
  return {
    prev: contrastForImageDataRegion(image, "prev", fallback),
    next: contrastForImageDataRegion(image, "next", fallback),
  };
}
