import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VIEWER3D_PREFERENCES,
  VIEWER3D_PREFERENCES_KEY,
  loadViewer3dPreferences,
  parseViewer3dPreferences,
  saveViewer3dPreferences,
  type Viewer3dPreferencesStorage,
} from '../../src/renderer/3d-viewer/viewer-preferences';
import { DEFAULT_LIGHT_INTENSITY, LIGHT_INTENSITY_MAX } from '../../src/renderer/3d-viewer/light-intensity';
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
  it('defaults to the studio preset with light intensity 1.0', () => {
    expect(DEFAULT_VIEWER3D_PREFERENCES).toEqual({
      presetId: DEFAULT_HDRI_PRESET_ID,
      lightIntensity: DEFAULT_LIGHT_INTENSITY,
      displayMode: 'pbr',
    });
    expect(loadViewer3dPreferences()).toEqual(DEFAULT_VIEWER3D_PREFERENCES);
  });

  it('round-trips saved preferences', () => {
    const storage = memoryStorage();
    saveViewer3dPreferences(
      { presetId: 'dancing-hall', lightIntensity: 1.7, displayMode: 'wireframe' },
      storage,
    );
    expect(storage.getItem(VIEWER3D_PREFERENCES_KEY)).toContain('dancing-hall');
    expect(loadViewer3dPreferences(storage)).toEqual({
      presetId: 'dancing-hall',
      lightIntensity: 1.7,
      displayMode: 'wireframe',
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
      parseViewer3dPreferences({ presetId: 'unknown-preset', lightIntensity: 99 }),
    ).toEqual({
      presetId: DEFAULT_HDRI_PRESET_ID,
      lightIntensity: LIGHT_INTENSITY_MAX,
      displayMode: 'pbr',
    });
    expect(
      parseViewer3dPreferences({ presetId: 'custom', lightIntensity: Number.NaN }),
    ).toEqual({
      presetId: DEFAULT_HDRI_PRESET_ID,
      lightIntensity: DEFAULT_LIGHT_INTENSITY,
      displayMode: 'pbr',
    });
  });

  it('clamps light intensity on save', () => {
    const storage = memoryStorage();
    saveViewer3dPreferences(
      { presetId: 'ferndale-studio-03', lightIntensity: 1000, displayMode: 'pbr' },
      storage,
    );
    expect(loadViewer3dPreferences(storage).lightIntensity).toBe(LIGHT_INTENSITY_MAX);
  });

  it('migrates the legacy exposure field as light intensity', () => {
    // Records written before the rename stored the same numeric range under
    // `exposure`; the parse must carry them across unchanged.
    const storage = memoryStorage({
      [VIEWER3D_PREFERENCES_KEY]: JSON.stringify({
        presetId: 'dancing-hall',
        exposure: 2.5,
      }),
    });
    expect(loadViewer3dPreferences(storage)).toEqual({
      presetId: 'dancing-hall',
      lightIntensity: 2.5,
      displayMode: 'pbr',
    });
  });
});
