/**
 * Client-side compression for application background images.
 *
 * The renderer is sandboxed (no Node), so a wallpaper is persisted as a base64
 * data URL in localStorage, which has a hard quota. Instead of rejecting large
 * files, we re-encode them in-browser: downscale the longest edge to
 * BACKGROUND_IMAGE_MAX_DIMENSION, then iterate over a WebP/JPEG quality ladder,
 * shrinking the canvas whenever the encoded payload still exceeds the target.
 *
 * The iteration logic is pure so tests can drive it without a real canvas;
 * `compressBackgroundImage` accepts an injectable codec and defaults to the
 * browser implementation.
 */
import {
  MAX_BACKGROUND_IMAGE_DATA_URL_BYTES,
  utf8ByteLength,
} from './background-preferences';

/** Longest edge a compressed wallpaper is allowed to keep. */
export const BACKGROUND_IMAGE_MAX_DIMENSION = 2560;
/** Quality ladder tried before the canvas is downscaled another step. */
export const BACKGROUND_IMAGE_ENCODE_QUALITIES = [0.9, 0.8, 0.65, 0.5, 0.35] as const;
/** Canvas dimensions shrink by this factor after the quality ladder is exhausted. */
export const BACKGROUND_IMAGE_DOWNSCALE_FACTOR = 0.75;
/** Absolute floor for canvas dimensions; below this we stop trying. */
export const BACKGROUND_IMAGE_MIN_DIMENSION = 320;

/** Compact byte formatting for wallpaper provenance lines (e.g. "1.2 MB"). */
export function formatBackgroundBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export interface BackgroundImageCompressionResult {
  /** Final data URL ready for storage; never exceeds the target budget. */
  dataUrl: string;
  /** Pixel dimensions of the stored image. */
  width: number;
  height: number;
  /** Byte size of the original file. */
  originalBytes: number;
  /** UTF-8 byte size of the final data URL. */
  encodedBytes: number;
  /** True when the payload was re-encoded (rather than passed through). */
  compressed: boolean;
  /** True when an animated GIF had to be flattened to its first frame. */
  animationLost: boolean;
}

export interface DecodedBackgroundImage {
  dataUrl: string;
  width: number;
  height: number;
}

/** Injectable image pipeline; tests substitute this instead of stubbing globals. */
export interface BackgroundImageCodec {
  /** Read and decode the file, returning its raw data URL and natural size. */
  decode(file: File): Promise<DecodedBackgroundImage>;
  /** Re-encode an image to the given canvas size and quality. */
  encode(
    dataUrl: string,
    width: number,
    height: number,
    mime: string,
    quality: number,
  ): Promise<DecodedBackgroundImage>;
}

/** Clamp pixel dimensions to a maximum longest edge, preserving aspect ratio. */
export function fitWithinMaxDimension(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width, height };
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface EncodeAttempt {
  width: number;
  height: number;
  quality: number;
}

/**
 * The full encode attempt sequence for one image: for each downscale step,
 * the quality ladder is tried from sharpest to softest. Yields the canvas
 * dimensions and quality for each attempt; the caller decides when a payload
 * fits and stops consuming.
 */
export function* backgroundImageEncodeAttempts(
  initialWidth: number,
  initialHeight: number,
  options?: {
    maxDimension?: number;
    minDimension?: number;
    qualities?: readonly number[];
    downscaleFactor?: number;
  },
): Generator<EncodeAttempt> {
  const maxDimension = options?.maxDimension ?? BACKGROUND_IMAGE_MAX_DIMENSION;
  const minDimension = options?.minDimension ?? BACKGROUND_IMAGE_MIN_DIMENSION;
  const qualities = options?.qualities ?? BACKGROUND_IMAGE_ENCODE_QUALITIES;
  const downscaleFactor = options?.downscaleFactor ?? BACKGROUND_IMAGE_DOWNSCALE_FACTOR;

  let { width, height } = fitWithinMaxDimension(initialWidth, initialHeight, maxDimension);
  for (;;) {
    for (const quality of qualities) {
      yield { width, height, quality };
    }
    if (width <= minDimension || height <= minDimension) return;
    width = Math.max(minDimension, Math.round(width * downscaleFactor));
    height = Math.max(minDimension, Math.round(height * downscaleFactor));
  }
}

/**
 * Compress a wallpaper file so its data URL fits the localStorage budget.
 * Small files pass through untouched (animated GIFs keep their frames);
 * anything larger is re-encoded to WebP (JPEG as a fallback) with iterated
 * quality and downscaling until the payload fits. The last attempt is
 * returned as a safety net even if every attempt exceeded the budget.
 */
export async function compressBackgroundImage(
  file: File,
  maxBytes: number = MAX_BACKGROUND_IMAGE_DATA_URL_BYTES,
  codec: BackgroundImageCodec = browserCodec,
): Promise<BackgroundImageCompressionResult> {
  const decoded = await codec.decode(file);

  if (utf8ByteLength(decoded.dataUrl) <= maxBytes) {
    return {
      dataUrl: decoded.dataUrl,
      width: decoded.width,
      height: decoded.height,
      originalBytes: file.size,
      encodedBytes: utf8ByteLength(decoded.dataUrl),
      compressed: false,
      animationLost: false,
    };
  }

  const attempts = backgroundImageEncodeAttempts(decoded.width, decoded.height);
  let last: DecodedBackgroundImage = decoded;
  for (const attempt of attempts) {
    const encoded = await tryEncode(codec, decoded.dataUrl, attempt);
    if (!encoded) continue;
    last = encoded;
    if (utf8ByteLength(encoded.dataUrl) <= maxBytes) {
      return {
        dataUrl: encoded.dataUrl,
        width: encoded.width,
        height: encoded.height,
        originalBytes: file.size,
        encodedBytes: utf8ByteLength(encoded.dataUrl),
        compressed: true,
        animationLost: file.type === 'image/gif',
      };
    }
  }

  return {
    dataUrl: last.dataUrl,
    width: last.width,
    height: last.height,
    originalBytes: file.size,
    encodedBytes: utf8ByteLength(last.dataUrl),
    compressed: true,
    animationLost: file.type === 'image/gif',
  };
}

/** WebP first (alpha channel), JPEG fallback; skip a codec that cannot encode. */
async function tryEncode(
  codec: BackgroundImageCodec,
  dataUrl: string,
  attempt: EncodeAttempt,
): Promise<DecodedBackgroundImage | null> {
  const mimes = ['image/webp', 'image/jpeg'];
  for (const mime of mimes) {
    try {
      return await codec.encode(dataUrl, attempt.width, attempt.height, mime, attempt.quality);
    } catch {
      // Codec rejected this format; try the next one.
    }
  }
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('background-image-read-failed'));
        return;
      }
      resolve(reader.result);
    });
    reader.addEventListener('error', () =>
      reject(reader.error ?? new Error('background-image-read-failed')),
    );
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('background-image-decode-failed')));
    image.src = src;
  });
}

export const browserCodec: BackgroundImageCodec = {
  async decode(file) {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImageElement(dataUrl);
    return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
  },
  async encode(dataUrl, width, height, mime, quality) {
    const image = await loadImageElement(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('background-image-canvas-unavailable');
    context.drawImage(image, 0, 0, width, height);
    const encoded = canvas.toDataURL(mime, quality);
    return { dataUrl: encoded, width, height };
  },
};
