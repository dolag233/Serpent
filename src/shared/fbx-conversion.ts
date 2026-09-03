import { z } from 'zod';

/**
 * FBX → GLB conversion contract shared between the Worker (converter) and the
 * Renderer (slice C consumes the typed error codes to route to the FBXLoader
 * fallback).
 */

/** Typed conversion failure codes; the Renderer routes on these. */
export const fbxConvertErrorCodeSchema = z.enum([
  'FBX_SOURCE_NOT_FOUND', // asset source file missing/unreadable
  'FBX_NOT_FBX', // not a parseable FBX (or unsupported FBX flavor)
  'FBX_LIMIT_EXCEEDED', // an explicitly requested conversion limit was hit
  'FBX_WASM_UNAVAILABLE', // resources/ufbx module missing or failed to load
  'FBX_NO_MESHES', // valid FBX but nothing convertible (no triangle geometry)
  'FBX_CONVERSION_FAILED', // internal conversion failure
]);
export type FbxConvertErrorCode = z.infer<typeof fbxConvertErrorCodeSchema>;

/** Every FBX_* code as a set (benign thumbnail-outcome checks, slice E). */
export const FBX_CONVERT_ERROR_CODES: ReadonlySet<string> = new Set(
  fbxConvertErrorCodeSchema.options,
);

/** Derive artifact kind for GLB conversion products. */
export const FBX_GLB_ARTIFACT_KIND = 'model_glb';

/** Bump when converter semantics change; part of the artifact cache key. */
export const FBX_GLB_GENERATOR_VERSION = 'ufbx-wasm-1';

/**
 * Conversion has no source-size, triangle-count, or wall-clock product cap.
 * The parser and renderer report genuine parse/resource failures, while the
 * caller owns cancellation through the normal job/lifecycle signal.
 */

/** Conversion statistics returned with a successful result (3D-13). */
export const fbxConversionStatsSchema = z.strictObject({
  triangles: z.number().int().nonnegative(),
  vertices: z.number().int().nonnegative(),
  meshes: z.number().int().nonnegative(),
  instances: z.number().int().nonnegative(),
  materials: z.number().int().nonnegative(),
  textures: z.number().int().nonnegative(),
  missingTextures: z.number().int().nonnegative(),
  sourceBytes: z.number().int().nonnegative(),
  glbBytes: z.number().int().nonnegative(),
  sourceUnitMeters: z.number(),
});
export type FbxConversionStats = z.infer<typeof fbxConversionStatsSchema>;

/**
 * Result of a conversion. `status: 'ready'` carries the cached GLB artifact;
 * `status: 'failed'` carries a typed error code for fallback routing.
 */
export type FbxConversionResult =
  | {
      status: 'ready';
      glbArtifactId: string;
      glbRelativePath: string;
      stats: FbxConversionStats;
      missingTextures: string[];
      warnings: string[];
    }
  | {
      status: 'failed';
      errorCode: FbxConvertErrorCode;
      reason?: string;
    };
