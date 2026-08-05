/**
 * Orbit camera policy (spec 3D-01 / 3D-02 / 3D-03).
 *
 * Pure camera math for the consumer orbit convention:
 * - auto-fit on open: camera distance from the bounding sphere so the whole
 *   model is visible (3D-02);
 * - polar clamp keeps the camera from flipping over the top (3D-03);
 * - zoom distance clamp (3D-03).
 *
 * Everything is plain-number math (no three imports) so the module is
 * unit-testable without a scene graph.
 */

/** Vertical FOV used by the viewer camera (degrees). */
export const CAMERA_FOV_DEGREES = 45;

/** Default 3/4 view direction (normalized (1, 0.75, 1)). */
export const DEFAULT_VIEW_DIRECTION: readonly [number, number, number] = [
  0.6708203932499369,
  0.5031153024374527,
  0.6708203932499369,
];

/** Extra margin so the model never touches the viewport edge. */
export const FIT_MARGIN = 1.15;

export const MIN_POLAR_ANGLE = Math.PI * 0.05;
export const MAX_POLAR_ANGLE = Math.PI * 0.95;
export const MIN_DISTANCE_FACTOR = 0.1;
export const MAX_DISTANCE_FACTOR = 20;

export interface SphereBounds {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

/**
 * Camera distance that fits a sphere of `radius` inside the frustum.
 *
 * The limiting angle is the smaller of the vertical FOV and the horizontal
 * FOV implied by the viewport aspect; distance = radius / sin(limiting/2)
 * with an extra margin factor.
 */
export function computeFitDistance(input: {
  readonly radius: number;
  readonly fovDegrees?: number;
  readonly viewportAspect: number;
  readonly margin?: number;
}): number {
  const fovDegrees = input.fovDegrees ?? CAMERA_FOV_DEGREES;
  const margin = input.margin ?? FIT_MARGIN;
  const radius = Number.isFinite(input.radius) && input.radius > 0 ? input.radius : 1;
  const fovHalf = (fovDegrees * Math.PI) / 360;
  const aspect = Math.max(0.01, input.viewportAspect);
  const horizontalHalf = Math.atan(Math.tan(fovHalf) * aspect);
  const limitingHalf = Math.min(fovHalf, horizontalHalf);
  return (radius / Math.sin(limitingHalf)) * margin;
}

/**
 * Full camera placement for auto-fit: position = center + direction * distance,
 * target = center. Returns plain tuples for direct camera assignment.
 */
export function computeCameraPlacement(input: {
  readonly bounds: SphereBounds;
  readonly fovDegrees?: number;
  readonly viewportAspect: number;
  readonly direction?: readonly [number, number, number];
  readonly margin?: number;
}): { readonly position: [number, number, number]; readonly target: [number, number, number] } {
  const direction = input.direction ?? DEFAULT_VIEW_DIRECTION;
  const distance = computeFitDistance({
    radius: input.bounds.radius,
    fovDegrees: input.fovDegrees,
    viewportAspect: input.viewportAspect,
    margin: input.margin,
  });
  const [dx, dy, dz] = direction;
  const [cx, cy, cz] = input.bounds.center;
  return {
    position: [cx + dx * distance, cy + dy * distance, cz + dz * distance],
    target: [cx, cy, cz],
  };
}

/**
 * OrbitControls constraints derived from the model bounds (3D-03).
 * The polar clamp prevents flipping over the top; distance bounds keep the
 * user from zooming into the geometry or losing the model entirely.
 */
export function computeOrbitConstraints(input: {
  readonly radius: number;
}): {
  readonly minPolarAngle: number;
  readonly maxPolarAngle: number;
  readonly minDistance: number;
  readonly maxDistance: number;
} {
  const radius = Number.isFinite(input.radius) && input.radius > 0 ? input.radius : 1;
  return {
    minPolarAngle: MIN_POLAR_ANGLE,
    maxPolarAngle: MAX_POLAR_ANGLE,
    minDistance: radius * MIN_DISTANCE_FACTOR,
    maxDistance: radius * MAX_DISTANCE_FACTOR,
  };
}

/** Bounding-sphere helper (box corners in world space). */
export function sphereFromBounds(input: {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}): SphereBounds {
  const center: [number, number, number] = [
    (input.min[0] + input.max[0]) / 2,
    (input.min[1] + input.max[1]) / 2,
    (input.min[2] + input.max[2]) / 2,
  ];
  const radius =
    0.5 *
    Math.hypot(
      input.max[0] - input.min[0],
      input.max[1] - input.min[1],
      input.max[2] - input.min[2],
    );
  return { center, radius };
}
