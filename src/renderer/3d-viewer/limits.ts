/**
 * Viewer resource limits (spec 3D-14 / research §3.6).
 *
 * Policy:
 * - Model source size is never used as an admission or rendering gate.
 * - Triangle count > 2 M → a non-blocking warning after load.
 * - Texture edge > 2 K → warning banner (desktop VRAM budget, research §3.6);
 *   v1 warns instead of downscaling.
 *
 * All functions are pure (numbers in, verdicts out) and unit-tested.
 */

export const MODEL_TRIANGLE_WARN_THRESHOLD = 2_000_000;
export const MODEL_TEXTURE_WARN_MAX_EDGE = 2_048;

/** Non-blocking warnings computed after a successful load. */
export type ModelRenderWarning =
  | {
      readonly code: 'MODEL_TRIANGLES_HIGH';
      readonly triangles: number;
      readonly threshold: number;
    }
  | {
      readonly code: 'MODEL_TEXTURE_HIGH_RES';
      readonly maxEdge: number;
      readonly maxEdgeLimit: number;
    };

export function checkModelRenderWarnings(input: {
  readonly triangles: number;
  /** Largest texture edge in pixels (0 when the model has no textures). */
  readonly maxTextureEdge: number;
}): ModelRenderWarning[] {
  const warnings: ModelRenderWarning[] = [];
  if (input.triangles > MODEL_TRIANGLE_WARN_THRESHOLD) {
    warnings.push({
      code: 'MODEL_TRIANGLES_HIGH',
      triangles: input.triangles,
      threshold: MODEL_TRIANGLE_WARN_THRESHOLD,
    });
  }
  if (input.maxTextureEdge > MODEL_TEXTURE_WARN_MAX_EDGE) {
    warnings.push({
      code: 'MODEL_TEXTURE_HIGH_RES',
      maxEdge: input.maxTextureEdge,
      maxEdgeLimit: MODEL_TEXTURE_WARN_MAX_EDGE,
    });
  }
  return warnings;
}
