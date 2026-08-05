import { describe, expect, it } from 'vitest';

import {
  FBX_ERROR_I18N_KEYS,
  MODEL_VIEWER_ERROR_I18N_KEYS,
  fbxErrorI18nKey,
  isFbxErrorCode,
  modelViewerErrorI18nKey,
  toModelViewerErrorCode,
  type ModelViewerErrorCode,
} from '../../src/renderer/3d-viewer/error-messages';
import { fbxConvertErrorCodeSchema } from '../../src/shared/fbx-conversion';

describe('error-messages (Serpent-qvc6 / 3D-15)', () => {
  it('maps every FBX conversion error code to a translation key (exhaustive)', () => {
    const allCodes = [...fbxConvertErrorCodeSchema.options];
    expect(allCodes.length).toBeGreaterThan(0);
    for (const code of allCodes) {
      expect(FBX_ERROR_I18N_KEYS[code], `missing key for ${code}`).toMatch(
        /^viewer3d\.error\.fbx\./,
      );
      expect(fbxErrorI18nKey(code)).toBe(FBX_ERROR_I18N_KEYS[code]);
      expect(isFbxErrorCode(code)).toBe(true);
    }
  });

  it('maps every viewer-local error code to a translation key', () => {
    for (const code of Object.keys(MODEL_VIEWER_ERROR_I18N_KEYS) as ModelViewerErrorCode[]) {
      expect(MODEL_VIEWER_ERROR_I18N_KEYS[code]).toMatch(/^viewer3d\.error\./);
      expect(modelViewerErrorI18nKey(code)).toBe(MODEL_VIEWER_ERROR_I18N_KEYS[code]);
      expect(isFbxErrorCode(code)).toBe(false);
    }
  });

  it('routes unknown codes to the fallback viewer code', () => {
    expect(toModelViewerErrorCode({ errorCode: 'SOMETHING_ELSE' })).toBe(
      'MODEL_LOAD_FAILED',
    );
    expect(
      toModelViewerErrorCode({
        errorCode: 'SOMETHING_ELSE',
        fallback: 'MODEL_CONTEXT_LOST',
      }),
    ).toBe('MODEL_CONTEXT_LOST');
    expect(toModelViewerErrorCode({})).toBe('MODEL_LOAD_FAILED');
  });

  it('preserves FBX codes through the router', () => {
    expect(toModelViewerErrorCode({ errorCode: 'FBX_CONVERSION_TIMEOUT' })).toBe(
      'FBX_CONVERSION_TIMEOUT',
    );
  });
});
