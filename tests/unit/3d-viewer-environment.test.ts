import { describe, expect, it, vi } from 'vitest';
import { NeutralToneMapping } from 'three';
import type { Texture } from 'three';

import {
  HALF_FLOAT_MAX,
  HDRI_TONE_MAPPING,
  buildEnvironment,
  clampHalfFloatData,
  resolveSceneEnvironmentPolicy,
  type EnvironmentRenderer,
  type PmremGeneratorLike,
  type PmremResultLike,
} from '../../src/renderer/3d-viewer/environment';
import {
  DEFAULT_EXPOSURE,
  EXPOSURE_MAX,
  EXPOSURE_MIN,
} from '../../src/renderer/3d-viewer/exposure';

function fakeTexture(): Texture {
  return { dispose: vi.fn() } as unknown as Texture;
}

function fakeRenderer() {
  // three r185 stores tone mapping + exposure as plain properties (the legacy
  // setToneMapping/setExposure methods do not exist on the r185 runtime).
  return {
    toneMapping: 0,
    toneMappingExposure: 1,
  } satisfies EnvironmentRenderer;
}

function fakePmrem() {
  const result = {
    texture: fakeTexture(),
    dispose: vi.fn(),
  } satisfies PmremResultLike;
  const pmrem = {
    fromEquirectangular: vi.fn<(texture: Texture) => PmremResultLike>(
      () => result,
    ),
    dispose: vi.fn(),
  } satisfies PmremGeneratorLike;
  return { pmrem, result };
}

describe('environment pipeline (Serpent-v363 / 3D-09/3D-10)', () => {
  it('confirms the r185 tone mapping constant', () => {
    // NeutralToneMapping = 7 in three r185 (constants.js).
    expect(HDRI_TONE_MAPPING).toBe(7);
    expect(HDRI_TONE_MAPPING).toBe(NeutralToneMapping);
  });

  it('assembles the PMREM result and applies neutral tone mapping + default exposure', () => {
    const renderer = fakeRenderer();
    const { pmrem, result } = fakePmrem();
    const hdrTexture = fakeTexture();

    const handle = buildEnvironment({ hdrTexture, pmrem, renderer });

    expect(pmrem.fromEquirectangular).toHaveBeenCalledWith(hdrTexture);
    expect(handle.environmentTexture).toBe(result.texture);
    expect(renderer.toneMapping).toBe(HDRI_TONE_MAPPING);
    expect(renderer.toneMappingExposure).toBe(DEFAULT_EXPOSURE);
  });

  it('clamps the requested exposure before applying it', () => {
    const renderer = fakeRenderer();
    const { pmrem } = fakePmrem();

    buildEnvironment({
      hdrTexture: fakeTexture(),
      pmrem,
      renderer,
      exposure: 99,
    });
    expect(renderer.toneMappingExposure).toBe(EXPOSURE_MAX);

    buildEnvironment({
      hdrTexture: fakeTexture(),
      pmrem,
      renderer,
      exposure: -3,
    });
    expect(renderer.toneMappingExposure).toBe(EXPOSURE_MIN);

    buildEnvironment({
      hdrTexture: fakeTexture(),
      pmrem,
      renderer,
      exposure: Number.NaN,
    });
    expect(renderer.toneMappingExposure).toBe(DEFAULT_EXPOSURE);
  });

  it('disposes the PMREM result and the source texture, but not the shared generator', () => {
    const renderer = fakeRenderer();
    const { pmrem, result } = fakePmrem();
    const hdrTexture = fakeTexture();

    const handle = buildEnvironment({ hdrTexture, pmrem, renderer });
    handle.dispose();

    expect(result.dispose).toHaveBeenCalledTimes(1);
    expect(hdrTexture.dispose).toHaveBeenCalledTimes(1);
    // PMREMGenerator is a long-lived shared object (three docs): the handle
    // disposes per-environment targets only; the generator is the viewer's.
    expect(pmrem.dispose).not.toHaveBeenCalled();
  });

  it('is idempotent under repeated dispose (effect cleanup / StrictMode)', () => {
    const renderer = fakeRenderer();
    const { pmrem, result } = fakePmrem();
    const hdrTexture = fakeTexture();

    const handle = buildEnvironment({ hdrTexture, pmrem, renderer });
    handle.dispose();
    handle.dispose();
    handle.dispose();

    expect(result.dispose).toHaveBeenCalledTimes(1);
    expect(hdrTexture.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('half-float NaN guard (research §4.3)', () => {
  it('clamps ±Inf and NaN half floats to the maximum finite value', () => {
    const data = new Uint16Array([
      0x3c00, // 1.0 (finite, untouched)
      0x7c00, // +Infinity
      0xfc00, // -Infinity
      0x7e00, // +NaN
      0x7bff, // 65504 (max finite, untouched)
    ]);
    expect(clampHalfFloatData(data)).toBe(3);
    expect(Array.from(data)).toEqual([
      0x3c00,
      HALF_FLOAT_MAX,
      HALF_FLOAT_MAX,
      HALF_FLOAT_MAX,
      0x7bff,
    ]);
  });

  it('returns 0 for already-clean data', () => {
    const data = new Uint16Array([0x0000, 0x3c00, 0x7bff]);
    expect(clampHalfFloatData(data)).toBe(0);
    expect(Array.from(data)).toEqual([0x0000, 0x3c00, 0x7bff]);
  });
});

describe('scene environment/background separation (3D-06 / §5)', () => {
  it('uses HDRI lighting with a theme background when a preset is active', () => {
    expect(
      resolveSceneEnvironmentPolicy({ presetId: 'studio-small-09' }),
    ).toEqual({
      environment: 'hdri',
      background: 'theme',
      presetId: 'studio-small-09',
    });
    expect(resolveSceneEnvironmentPolicy({ presetId: 'custom' })).toEqual({
      environment: 'hdri',
      background: 'theme',
      presetId: 'custom',
    });
  });

  it('drops IBL but keeps the theme background without a preset', () => {
    expect(resolveSceneEnvironmentPolicy({ presetId: null })).toEqual({
      environment: 'none',
      background: 'theme',
      presetId: null,
    });
  });
});
