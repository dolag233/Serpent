import { describe, expect, it } from 'vitest';

import {
  CAMERA_FOV_DEGREES,
  DEFAULT_VIEW_DIRECTION,
  FIT_MARGIN,
  MAX_DISTANCE_FACTOR,
  MAX_POLAR_ANGLE,
  MIN_DISTANCE_FACTOR,
  MIN_POLAR_ANGLE,
  computeCameraPlacement,
  computeFitDistance,
  computeOrbitConstraints,
  sphereFromBounds,
} from '../../src/renderer/3d-viewer/camera-policy';

describe('camera-policy (Serpent-qvc6 / 3D-02/3D-03)', () => {
  it('fits a sphere of radius r at the frustum-limiting FOV with margin', () => {
    // Vertical FOV 45°, square viewport → both FOVs equal; distance =
    // r / sin(22.5°) * margin.
    const distance = computeFitDistance({
      radius: 10,
      viewportAspect: 1,
    });
    const expected = (10 / Math.sin((45 * Math.PI) / 360)) * FIT_MARGIN;
    expect(distance).toBeCloseTo(expected, 10);
  });

  it('uses the horizontal FOV as the limiting angle on narrow viewports', () => {
    // aspect 0.5 → horizontal FOV = 2*atan(tan(22.5°)*0.5) < vertical FOV.
    const narrow = computeFitDistance({ radius: 10, viewportAspect: 0.5 });
    const wide = computeFitDistance({ radius: 10, viewportAspect: 2 });
    expect(narrow).toBeGreaterThan(wide);
    // And both keep the model comfortably inside the viewport.
    expect(narrow).toBeGreaterThan(10);
    expect(wide).toBeGreaterThan(10);
  });

  it('guards degenerate radius and aspect inputs', () => {
    expect(
      computeFitDistance({ radius: 0, viewportAspect: 1 }),
    ).toBeGreaterThan(0);
    expect(
      computeFitDistance({ radius: Number.NaN, viewportAspect: 1 }),
    ).toBeGreaterThan(0);
    expect(
      computeFitDistance({ radius: 10, viewportAspect: 0 }),
    ).toBeGreaterThan(0);
  });

  it('places the camera along the default 3/4 direction at the fit distance', () => {
    const placement = computeCameraPlacement({
      bounds: { center: [5, 2, -3], radius: 4 },
      viewportAspect: 1.5,
    });
    const [dx, dy, dz] = DEFAULT_VIEW_DIRECTION;
    const distance = computeFitDistance({ radius: 4, viewportAspect: 1.5 });
    expect(placement.target).toEqual([5, 2, -3]);
    expect(placement.position[0]).toBeCloseTo(5 + dx * distance, 9);
    expect(placement.position[1]).toBeCloseTo(2 + dy * distance, 9);
    expect(placement.position[2]).toBeCloseTo(-3 + dz * distance, 9);
  });

  it('keeps the camera above the model plane (positive y component)', () => {
    const placement = computeCameraPlacement({
      bounds: { center: [0, 0, 0], radius: 1 },
      viewportAspect: 1,
    });
    expect(placement.position[1]).toBeGreaterThan(0);
  });

  it('clamps the polar angle below the poles (no flipping over the top)', () => {
    const { minPolarAngle, maxPolarAngle } = computeOrbitConstraints({
      radius: 5,
    });
    expect(minPolarAngle).toBe(MIN_POLAR_ANGLE);
    expect(maxPolarAngle).toBe(MAX_POLAR_ANGLE);
    expect(minPolarAngle).toBeGreaterThan(0);
    expect(maxPolarAngle).toBeLessThan(Math.PI);
    expect(minPolarAngle).toBeLessThan(maxPolarAngle);
  });

  it('scales zoom distance bounds with the model radius', () => {
    const small = computeOrbitConstraints({ radius: 1 });
    const large = computeOrbitConstraints({ radius: 100 });
    expect(small.minDistance).toBeCloseTo(1 * MIN_DISTANCE_FACTOR, 9);
    expect(small.maxDistance).toBeCloseTo(1 * MAX_DISTANCE_FACTOR, 9);
    expect(large.minDistance).toBeCloseTo(100 * MIN_DISTANCE_FACTOR, 9);
    expect(large.maxDistance).toBeCloseTo(100 * MAX_DISTANCE_FACTOR, 9);
    expect(computeOrbitConstraints({ radius: 0 }).minDistance).toBeGreaterThan(0);
  });

  it('derives the bounding sphere from box corners', () => {
    const sphere = sphereFromBounds({
      min: [0, 0, 0],
      max: [2, 2, 2],
    });
    expect(sphere.center).toEqual([1, 1, 1]);
    // Half-diagonal of a 2³ box = sqrt(3).
    expect(sphere.radius).toBeCloseTo(Math.sqrt(3), 9);
  });

  it('exposes the default camera FOV constant', () => {
    expect(CAMERA_FOV_DEGREES).toBe(45);
  });
});
