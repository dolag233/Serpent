import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPOSURE,
  EXPOSURE_MAX,
  EXPOSURE_MIN,
  clampExposure,
  parseExposure,
} from '../../src/renderer/3d-viewer/exposure';

describe('exposure (Serpent-v363 / 3D-10)', () => {
  it('exposes the spec defaults', () => {
    expect(DEFAULT_EXPOSURE).toBe(1.0);
    expect(EXPOSURE_MIN).toBe(0.1);
    expect(EXPOSURE_MAX).toBe(4.0);
  });

  it('passes in-range values through', () => {
    expect(clampExposure(1.0)).toBe(1.0);
    expect(clampExposure(0.1)).toBe(0.1);
    expect(clampExposure(4.0)).toBe(4.0);
    expect(clampExposure(2.5)).toBe(2.5);
  });

  it('clamps out-of-range values', () => {
    expect(clampExposure(0)).toBe(EXPOSURE_MIN);
    expect(clampExposure(-5)).toBe(EXPOSURE_MIN);
    expect(clampExposure(9.9)).toBe(EXPOSURE_MAX);
  });

  it('falls back to the default for non-finite input', () => {
    expect(clampExposure(Number.NaN)).toBe(DEFAULT_EXPOSURE);
    expect(clampExposure(Number.POSITIVE_INFINITY)).toBe(DEFAULT_EXPOSURE);
    expect(clampExposure(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_EXPOSURE);
  });

  it('parses untrusted input with clamping and default fallback', () => {
    expect(parseExposure(2.5)).toBe(2.5);
    expect(parseExposure(0)).toBe(EXPOSURE_MIN);
    expect(parseExposure(99)).toBe(EXPOSURE_MAX);
    expect(parseExposure('2.5')).toBe(DEFAULT_EXPOSURE);
    expect(parseExposure(null)).toBe(DEFAULT_EXPOSURE);
    expect(parseExposure(Number.NaN)).toBe(DEFAULT_EXPOSURE);
  });
});
