/**
 * Typed error code → i18n key mapping for the 3D viewer (spec 3D-15).
 *
 * The FBX conversion error codes are shared with the Worker
 * (`src/shared/fbx-conversion.ts`); the exhaustive record below guarantees
 * every code has a translation at compile time. Viewer-local codes
 * (`MODEL_TOO_LARGE`, `MODEL_LOAD_FAILED`, `MODEL_WEBGL_UNAVAILABLE`,
 * `MODEL_CONTEXT_LOST`) map to the `viewer3d.error.*` catalog namespace.
 * Copy tone follows docs/ui/0004: specific, actionable, no alarm wording.
 */

import type { FbxConvertErrorCode } from '../../shared/fbx-conversion';

export type ModelViewerErrorCode =
  | 'MODEL_TOO_LARGE'
  | 'MODEL_LOAD_FAILED'
  | 'MODEL_WEBGL_UNAVAILABLE'
  | 'MODEL_CONTEXT_LOST';

/** Exhaustive: adding a code to fbx-conversion fails compilation here. */
export const FBX_ERROR_I18N_KEYS: Readonly<Record<FbxConvertErrorCode, string>> = {
  FBX_SOURCE_NOT_FOUND: 'viewer3d.error.fbx.sourceNotFound',
  FBX_NOT_FBX: 'viewer3d.error.fbx.notFbx',
  FBX_FILE_TOO_LARGE: 'viewer3d.error.fbx.fileTooLarge',
  FBX_LIMIT_EXCEEDED: 'viewer3d.error.fbx.limitExceeded',
  FBX_CONVERSION_TIMEOUT: 'viewer3d.error.fbx.timeout',
  FBX_WASM_UNAVAILABLE: 'viewer3d.error.fbx.wasmUnavailable',
  FBX_NO_MESHES: 'viewer3d.error.fbx.noMeshes',
  FBX_CONVERSION_FAILED: 'viewer3d.error.fbx.conversionFailed',
};

export function fbxErrorI18nKey(code: FbxConvertErrorCode): string {
  return FBX_ERROR_I18N_KEYS[code];
}

/** Narrow a runtime error code to the FBX conversion set (exhaustive check). */
export function isFbxErrorCode(code: string): code is FbxConvertErrorCode {
  return code in FBX_ERROR_I18N_KEYS;
}

/** Exhaustive: every viewer-local code needs a key. */
export const MODEL_VIEWER_ERROR_I18N_KEYS: Readonly<Record<ModelViewerErrorCode, string>> = {
  MODEL_TOO_LARGE: 'viewer3d.error.modelTooLarge',
  MODEL_LOAD_FAILED: 'viewer3d.error.loadFailed',
  MODEL_WEBGL_UNAVAILABLE: 'viewer3d.error.webglUnavailable',
  MODEL_CONTEXT_LOST: 'viewer3d.error.contextLost',
};

export function modelViewerErrorI18nKey(code: ModelViewerErrorCode): string {
  return MODEL_VIEWER_ERROR_I18N_KEYS[code];
}

/**
 * Map an unknown runtime failure to a viewer error code. three loader errors
 * carry no typed code, so they all surface as MODEL_LOAD_FAILED; conversion
 * error codes keep their identity for the FBX-specific copy.
 */
export function toModelViewerErrorCode(input: {
  readonly errorCode?: string;
  readonly fallback?: ModelViewerErrorCode;
}): ModelViewerErrorCode | FbxConvertErrorCode {
  if (input.errorCode) {
    if (input.errorCode in FBX_ERROR_I18N_KEYS) {
      return input.errorCode as FbxConvertErrorCode;
    }
    if (input.errorCode in MODEL_VIEWER_ERROR_I18N_KEYS) {
      return input.errorCode as ModelViewerErrorCode;
    }
  }
  return input.fallback ?? 'MODEL_LOAD_FAILED';
}
