import { describe, expect, it } from 'vitest';

import {
  MODEL_MAX_SOURCE_BYTES,
  MODEL_TEXTURE_WARN_MAX_EDGE,
  MODEL_TRIANGLE_WARN_THRESHOLD,
  checkModelOpenLimits,
  checkModelRenderWarnings,
} from '../../src/renderer/3d-viewer/limits';

describe('limits (Serpent-qvc6 / 3D-14)', () => {
  it('allows files at or under the 300 MB open limit', () => {
    expect(checkModelOpenLimits({ byteSize: MODEL_MAX_SOURCE_BYTES })).toEqual({
      allowed: true,
    });
    expect(checkModelOpenLimits({ byteSize: 1024 })).toEqual({ allowed: true });
  });

  it('refuses files above 300 MB with the typed code', () => {
    const verdict = checkModelOpenLimits({
      byteSize: MODEL_MAX_SOURCE_BYTES + 1,
    });
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.code).toBe('MODEL_TOO_LARGE');
      expect(verdict.limitBytes).toBe(MODEL_MAX_SOURCE_BYTES);
      expect(verdict.bytes).toBe(MODEL_MAX_SOURCE_BYTES + 1);
    }
  });

  it('treats non-finite sizes as a refusal', () => {
    expect(checkModelOpenLimits({ byteSize: Number.NaN }).allowed).toBe(false);
    expect(checkModelOpenLimits({ byteSize: Number.POSITIVE_INFINITY }).allowed).toBe(
      false,
    );
  });

  it('warns above the triangle threshold', () => {
    const warnings = checkModelRenderWarnings({
      triangles: MODEL_TRIANGLE_WARN_THRESHOLD + 1,
      maxTextureEdge: 512,
    });
    expect(warnings).toEqual([
      {
        code: 'MODEL_TRIANGLES_HIGH',
        triangles: MODEL_TRIANGLE_WARN_THRESHOLD + 1,
        threshold: MODEL_TRIANGLE_WARN_THRESHOLD,
      },
    ]);
  });

  it('warns above the 2K texture edge', () => {
    const warnings = checkModelRenderWarnings({
      triangles: 100,
      maxTextureEdge: MODEL_TEXTURE_WARN_MAX_EDGE + 1,
    });
    expect(warnings).toEqual([
      {
        code: 'MODEL_TEXTURE_HIGH_RES',
        maxEdge: MODEL_TEXTURE_WARN_MAX_EDGE + 1,
        maxEdgeLimit: MODEL_TEXTURE_WARN_MAX_EDGE,
      },
    ]);
  });

  it('emits both warnings and stays quiet within limits', () => {
    const warnings = checkModelRenderWarnings({
      triangles: MODEL_TRIANGLE_WARN_THRESHOLD * 2,
      maxTextureEdge: 4096,
    });
    expect(warnings.map((warning) => warning.code)).toEqual([
      'MODEL_TRIANGLES_HIGH',
      'MODEL_TEXTURE_HIGH_RES',
    ]);
    expect(
      checkModelRenderWarnings({ triangles: 1000, maxTextureEdge: 1024 }),
    ).toEqual([]);
  });
});
