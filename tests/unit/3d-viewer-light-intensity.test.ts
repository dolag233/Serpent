import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIGHT_INTENSITY,
  LIGHT_INTENSITY_MAX,
  LIGHT_INTENSITY_MIN,
  clampLightIntensity,
  parseLightIntensity,
} from '../../src/renderer/3d-viewer/light-intensity';

describe('light intensity (Serpent-26qz / 3D-10)', () => {
  it('exposes the spec defaults', () => {
    expect(DEFAULT_LIGHT_INTENSITY).toBe(1.0);
    expect(LIGHT_INTENSITY_MIN).toBe(0.1);
    expect(LIGHT_INTENSITY_MAX).toBe(4.0);
  });

  it('passes in-range values through', () => {
    expect(clampLightIntensity(1.0)).toBe(1.0);
    expect(clampLightIntensity(0.1)).toBe(0.1);
    expect(clampLightIntensity(4.0)).toBe(4.0);
    expect(clampLightIntensity(2.5)).toBe(2.5);
  });

  it('clamps out-of-range values', () => {
    expect(clampLightIntensity(0)).toBe(LIGHT_INTENSITY_MIN);
    expect(clampLightIntensity(-5)).toBe(LIGHT_INTENSITY_MIN);
    expect(clampLightIntensity(9.9)).toBe(LIGHT_INTENSITY_MAX);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampLightIntensity(Number.NaN)).toBe(DEFAULT_LIGHT_INTENSITY);
    expect(clampLightIntensity(Number.POSITIVE_INFINITY)).toBe(DEFAULT_LIGHT_INTENSITY);
    expect(clampLightIntensity(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_LIGHT_INTENSITY);
  });

  it('parses untrusted input with clamping and default fallback', () => {
    expect(parseLightIntensity(2.5)).toBe(2.5);
    expect(parseLightIntensity(0)).toBe(LIGHT_INTENSITY_MIN);
    expect(parseLightIntensity(99)).toBe(LIGHT_INTENSITY_MAX);
    expect(parseLightIntensity('2.5')).toBe(DEFAULT_LIGHT_INTENSITY);
    expect(parseLightIntensity(null)).toBe(DEFAULT_LIGHT_INTENSITY);
    expect(parseLightIntensity(Number.NaN)).toBe(DEFAULT_LIGHT_INTENSITY);
  });
});
