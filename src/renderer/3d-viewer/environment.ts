import { NeutralToneMapping, PMREMGenerator } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { Texture, WebGLRenderer } from 'three';

import { DEFAULT_EXPOSURE, clampExposure } from './exposure';
import type { HdriPresetId } from './hdri-presets';

/**
 * HDRI environment pipeline (spec 3D-09 / 3D-10 / §5).
 *
 * `HDRLoader` (renamed from `RGBELoader` in r180; `three/addons/loaders/
 * HDRLoader.js` in r185) decodes RGBE `.hdr` into a HalfFloat texture;
 * `PMREMGenerator.fromEquirectangular` pre-filters it into a cubemap whose
 * mip chain encodes roughness levels, so `scene.environment` gives
 * energy-conserving specular response (research §3.3 / §4.3).
 *
 * Functions here are pure and unit-testable: the renderer and PMREM
 * generator are injected structurally, nothing touches a real WebGL context.
 */

/** NeutralToneMapping (Khronos PBR Neutral, three r155+; r185 constant value 7). */
export const HDRI_TONE_MAPPING = NeutralToneMapping;

/**
 * Smallest subset of WebGLRenderer the pipeline needs.
 *
 * three r185 stores tone mapping and exposure as plain properties
 * (`renderer.toneMapping` / `renderer.toneMappingExposure`); the legacy
 * `setToneMapping()` / `setExposure()` methods were removed before r185, so
 * callers must assign the properties directly.
 */
export interface EnvironmentRenderer {
  toneMapping: number;
  toneMappingExposure: number;
}

/** Structural view of the PMREMGenerator surface used by the pipeline. */
export interface PmremGeneratorLike {
  fromEquirectangular(texture: Texture): PmremResultLike;
  dispose(): void;
}

/** Structural view of the render target returned by `fromEquirectangular`. */
export interface PmremResultLike {
  readonly texture: Texture;
  dispose(): void;
}

/**
 * Owned environment handle. `dispose()` releases the PMREM result target
 * (texture + GPU attachments) and the decoded source `.hdr` texture, and is
 * idempotent (safe for repeated effect cleanup / React StrictMode).
 *
 * The PMREMGenerator instance itself is deliberately NOT disposed here:
 * three documents it as a long-lived object ("you should not need more than
 * one"), so it is owned by the viewer session and disposed once at teardown.
 */
export type EnvironmentHandle = {
  readonly environmentTexture: Texture;
  readonly dispose: () => void;
};

/**
 * Assemble an environment from an already-decoded HDR texture.
 *
 * Takes ownership of `hdrTexture` (disposed with the handle). Applies the
 * neutral tone mapping and clamped exposure to the renderer so materials
 * respond consistently under IBL.
 */
export function buildEnvironment(input: {
  hdrTexture: Texture;
  pmrem: PmremGeneratorLike;
  renderer: EnvironmentRenderer;
  exposure?: number;
}): EnvironmentHandle {
  const { hdrTexture, pmrem, renderer } = input;
  renderer.toneMapping = HDRI_TONE_MAPPING;
  renderer.toneMappingExposure = clampExposure(input.exposure ?? DEFAULT_EXPOSURE);

  const result = pmrem.fromEquirectangular(hdrTexture);
  let disposed = false;

  return {
    environmentTexture: result.texture,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      result.dispose();
      hdrTexture.dispose();
    },
  };
}

/**
 * Load a bundled `.hdr` URL and assemble its environment.
 *
 * Convenience for the viewer (slice C) and offscreen thumbnailing (slice E):
 * wires the real `HDRLoader` + `PMREMGenerator` around `buildEnvironment`.
 * Not exercised by unit tests (requires a real WebGLRenderer).
 */
export async function loadHdrEnvironment(
  url: string,
  deps: {
    renderer: WebGLRenderer;
    /** Defaults to a new PMREMGenerator for `renderer`. */
    pmrem?: PmremGeneratorLike;
    exposure?: number;
  },
): Promise<EnvironmentHandle> {
  const texture = await new HDRLoader().loadAsync(url);
  const pmrem = deps.pmrem ?? new PMREMGenerator(deps.renderer);
  return buildEnvironment({
    hdrTexture: texture,
    pmrem,
    renderer: deps.renderer,
    exposure: deps.exposure,
  });
}

/**
 * Scene wiring policy: environment (lighting) and background (theme) are
 * deliberately separated (3D-06 / §5). `scene.background` always follows the
 * app theme — never the HDR itself — so switching HDRI never introduces a
 * jarring third color behind the model; `scene.environment` carries the IBL.
 */
export type SceneEnvironmentPolicy = {
  readonly environment: 'hdri' | 'none';
  readonly background: 'theme';
  readonly presetId: HdriPresetId | null;
};

export function resolveSceneEnvironmentPolicy(input: {
  presetId: HdriPresetId | null;
}): SceneEnvironmentPolicy {
  return {
    environment: input.presetId === null ? 'none' : 'hdri',
    background: 'theme',
    presetId: input.presetId,
  };
}

/**
 * Half-float NaN/Infinity guard (research §4.3).
 *
 * Half floats cap at 65504; extreme HDR values decoded to
 * `HalfFloatType` can overflow to ±Inf/NaN, which renders as black speckle
 * once post-processing (e.g. bloom) is added. Run this once over the raw
 * decoded `Uint16Array` data before use: non-finite values are replaced
 * with the maximum finite half (0x7bff = 65504) in place. Returns the
 * number of corrected values (0 means the data was already clean).
 */
export const HALF_FLOAT_MAX = 0x7bff;

export function clampHalfFloatData(data: Uint16Array): number {
  let clamped = 0;
  for (let index = 0; index < data.length; index += 1) {
    // Exponent bits all ones (0x7c00 mask) marks ±Inf and NaN (any mantissa).
    if ((data[index]! & 0x7c00) === 0x7c00) {
      data[index] = HALF_FLOAT_MAX;
      clamped += 1;
    }
  }
  return clamped;
}
