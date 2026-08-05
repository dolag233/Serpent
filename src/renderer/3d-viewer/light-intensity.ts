import { z } from 'zod';

/**
 * Environment light intensity for the 3D preview.
 *
 * The toolbar control is called "light intensity", not "exposure": it scales
 * the environment light (`scene.environment.intensity`) that illuminates the
 * model, while tone mapping stays fixed at the neutral default. Dragging the
 * slider brightens/dims the lighting, matching user expectation.
 *
 * - Default 1.0 (physically-based neutral).
 * - Bounds [0.1, 4.0]: roughly ±2 stops either way of the default so an
 *   over/under-exposed HDRI can be recovered without clipping the image to
 *   black/white (research §3.3 / §4.3).
 */
export const DEFAULT_LIGHT_INTENSITY = 1.0;
export const LIGHT_INTENSITY_MIN = 0.1;
export const LIGHT_INTENSITY_MAX = 4.0;

/** Clamp a numeric intensity into the valid range; non-finite input falls back to the default. */
export function clampLightIntensity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIGHT_INTENSITY;
  return Math.min(LIGHT_INTENSITY_MAX, Math.max(LIGHT_INTENSITY_MIN, value));
}

const lightIntensitySchema = z.number().finite();

/**
 * Parse an untrusted persisted/input value (e.g. localStorage read by the
 * viewer toolbar) into a clamped intensity, falling back to the default.
 */
export function parseLightIntensity(input: unknown): number {
  const parsed = lightIntensitySchema.safeParse(input);
  return parsed.success ? clampLightIntensity(parsed.data) : DEFAULT_LIGHT_INTENSITY;
}
