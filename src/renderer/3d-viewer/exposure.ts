import { z } from 'zod';

/**
 * Viewport exposure policy for the 3D preview (spec 3D-10).
 *
 * - Default 1.0 (physically-based neutral; renderer `exposure` multiplies
 *   incoming light before tone mapping).
 * - Bounds [0.1, 4.0]: roughly ±2 stops either way of the default so an
 *   over/under-exposed HDRI can be recovered without letting the slider
 *   clip the image to black/white (research §3.3 / §4.3).
 */
export const DEFAULT_EXPOSURE = 1.0;
export const EXPOSURE_MIN = 0.1;
export const EXPOSURE_MAX = 4.0;

/** Clamp a numeric exposure into the valid range; non-finite input falls back to the default. */
export function clampExposure(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EXPOSURE;
  return Math.min(EXPOSURE_MAX, Math.max(EXPOSURE_MIN, value));
}

const exposureSchema = z.number().finite();

/**
 * Parse an untrusted persisted/input value (e.g. localStorage read by the
 * viewer toolbar) into a clamped exposure, falling back to the default.
 */
export function parseExposure(input: unknown): number {
  const parsed = exposureSchema.safeParse(input);
  return parsed.success ? clampExposure(parsed.data) : DEFAULT_EXPOSURE;
}
