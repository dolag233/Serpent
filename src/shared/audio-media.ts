/**
 * Pure helpers for audio asset detection (Serpent-0x5).
 * Worker `detectMediaType` and MIME maps stay the single runtime authority;
 * these helpers keep extension lists consistent across unit tests and call sites.
 */

export const AUDIO_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".ogg",
  ".oga",
  ".m4a",
  ".aac",
  ".flac",
  ".opus",
] as const;

/**
 * Grid / Inspector waveform cover geometry (Serpent-dxk).
 * Target ≈ 4:3 — not a tall or wide strip. Viewer chrome CSS is separate
 * (Serpent-muc: full-bleed strip via object-fit:cover, not letterboxed contain).
 */
export const AUDIO_WAVEFORM_COVER_WIDTH = 640;
export const AUDIO_WAVEFORM_COVER_HEIGHT = 480;

/** Generator tag; bump when cover geometry or stage color changes so thumbs requeue. */
export const AUDIO_WAVEFORM_COVER_GENERATOR_TAG = "waveform-cover4";

/**
 * Light browse canvas (`--canvas` in light theme). Covers must not match this
 * or the 4:3 stage blends into the grid (Serpent-muc / AUDIO-001).
 */
export const LIGHT_CANVAS_BACKGROUND = {
  r: 0xe8,
  g: 0xea,
  b: 0xe7,
} as const;

/**
 * Raised/pane cover stage (light `--raised` / white). Distinct from canvas;
 * still light-theme friendly. Shared PNG across themes.
 */
export const AUDIO_WAVEFORM_COVER_BACKGROUND = {
  r: 0xff,
  g: 0xff,
  b: 0xff,
} as const;

/** Wave stroke with contrast on the light cover stage. */
export const AUDIO_WAVEFORM_COVER_STROKE = "#3B7DD8";

/** Minimum Euclidean RGB distance from light canvas so the cover reads as a card. */
export const AUDIO_WAVEFORM_COVER_CANVAS_MIN_DISTANCE = 24;

export function audioWaveformCoverAspectRatio(): number {
  return AUDIO_WAVEFORM_COVER_WIDTH / AUDIO_WAVEFORM_COVER_HEIGHT;
}

/** Relative luminance in 0..1 (sRGB coefficients, channel 0..255). */
export function relativeLuminance(rgb: {
  r: number;
  g: number;
  b: number;
}): number {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/** Euclidean distance in 8-bit sRGB channel space. */
export function rgbChannelDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** True when width/height is within relativeTolerance of 4:3. */
export function isNearFourByThreeAspect(
  width: number,
  height: number,
  relativeTolerance = 0.05,
): boolean {
  if (width <= 0 || height <= 0) {
    return false;
  }
  const ratio = width / height;
  const target = 4 / 3;
  return Math.abs(ratio - target) / target <= relativeTolerance;
}

/** Reject near-black stages that fail light-theme cover QA. */
export function isLightFriendlyWaveformCoverBackground(rgb: {
  r: number;
  g: number;
  b: number;
}): boolean {
  return relativeLuminance(rgb) >= 0.75;
}

/**
 * True when the cover stage is visibly distinct from the light browse canvas
 * (avoids `#e8eae7` blending into `--canvas`).
 */
export function contrastsWithLightCanvas(
  rgb: { r: number; g: number; b: number },
  minDistance = AUDIO_WAVEFORM_COVER_CANVAS_MIN_DISTANCE,
): boolean {
  return rgbChannelDistance(rgb, LIGHT_CANVAS_BACKGROUND) >= minDistance;
}

/** Extension tokens without the leading dot — for SQL LIKE / enqueue lists. */
export const AUDIO_EXTENSION_NAMES = AUDIO_EXTENSIONS.map((ext) =>
  ext.slice(1),
);

export const AUDIO_MIME_BY_EXTENSION: Record<
  (typeof AUDIO_EXTENSIONS)[number],
  string
> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
};

export function isAudioFileName(filenameOrMime: string): boolean {
  const lower = filenameOrMime.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function audioMimeForExtension(extension: string): string | null {
  const key = extension.toLowerCase() as (typeof AUDIO_EXTENSIONS)[number];
  return AUDIO_MIME_BY_EXTENSION[key] ?? null;
}
