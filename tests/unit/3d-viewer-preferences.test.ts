import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEWER3D_PREFERENCES,
  VIEWER3D_PREFERENCES_KEY,
  loadViewer3dPreferences,
  parseViewer3dPreferences,
  saveViewer3dPreferences,
  type Viewer3dPreferencesStorage,
} from '../../src/renderer/3d-viewer/viewer-preferences';
import { DEFAULT_EXPOSURE, EXPOSURE_MAX } from '../../src/renderer/3d-viewer/exposure';
import { DEFAULT_HDRI_PRESET_ID } from '../../src/renderer/3d-viewer/hdri-presets';

function memoryStorage(initial: Record<string, string> = {}): Viewer3dPreferencesStorage {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe('viewer3d preferences (Serpent-qvc6 / 3D-09/3D-10 persistence)', () => {
  it('defaults to the studio preset with exposure 1.0', () => {
    expect(DEFAULT_VIEWER3D_PREFERENCES).toEqual({
      presetId: DEFAULT_HDRI_PRESET_ID,
      exposure: DEFAULT_EXPOSURE,
    });
    expect(loadViewer3dPreferences()).toEqual(DEFAULT_VIEWER3D_PREFERENCES);
  });

  it('round-trips saved preferences', () => {
    const storage = memoryStorage();
    saveViewer3dPreferences(
      { presetId: 'kloppenheim-02', exposure: 1.7 },
      storage,
    );
    expect(storage.getItem(VIEWER3D_PREFERENCES_KEY)).toContain('kloppenheim-02');
    expect(loadViewer3dPreferences(storage)).toEqual({
      presetId: 'kloppenheim-02',
      exposure: 1.7,
    });
  });

  it('falls back to defaults on missing or malformed storage', () => {
    expect(loadViewer3dPreferences(memoryStorage())).toEqual(
      DEFAULT_VIEWER3D_PREFERENCES,
    );
    expect(
      loadViewer3dPreferences(memoryStorage({ [VIEWER3D_PREFERENCES_KEY]: '{oops' })),
    ).toEqual(DEFAULT_VIEWER3D_PREFERENCES);
    expect(loadViewer3dPreferences(memoryStorage({ [VIEWER3D_PREFERENCES_KEY]: '"str"'}))).toEqual(
      DEFAULT_VIEWER3D_PREFERENCES,
    );
  });

  it('validates untrusted persisted values through the slice-D parsers', () => {
    expect(
      parseViewer3dPreferences({ presetId: 'unknown-preset', exposure: 99 }),
    ).toEqual({
      presetId: DEFAULT_HDRI_PRESET_ID,
      exposure: EXPOSURE_MAX,
    });
    expect(
      parseViewer3dPreferences({ presetId: 'custom', exposure: Number.NaN }),
    ).toEqual({
      presetId: 'custom',
      exposure: DEFAULT_EXPOSURE,
    });
  });

  it('clamps exposure on save', () => {
    const storage = memoryStorage();
    saveViewer3dPreferences(
      { presetId: 'studio-small-09', exposure: 1000 },
      storage,
    );
    expect(loadViewer3dPreferences(storage).exposure).toBe(EXPOSURE_MAX);
  });
});
