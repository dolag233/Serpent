/**
 * Persisted 3D viewer preferences (toolbar state, spec 3D-09 / 3D-10).
 *
 * Only the HDRI preset id and the exposure survive restarts; both are
 * validated on read through the slice-D parsers (unknown ids / non-finite
 * values fall back to the defaults). Storage is injected so tests can use a
 * plain object.
 */

import { DEFAULT_EXPOSURE, clampExposure, parseExposure } from './exposure';
import {
  DEFAULT_HDRI_PRESET_ID,
  parseHdriPresetId,
  type HdriPresetId,
} from './hdri-presets';

export const VIEWER3D_PREFERENCES_KEY = 'serpent.viewer3d.preferences';

export interface Viewer3dPreferences {
  presetId: HdriPresetId;
  exposure: number;
}

export const DEFAULT_VIEWER3D_PREFERENCES: Viewer3dPreferences = {
  presetId: DEFAULT_HDRI_PRESET_ID,
  exposure: DEFAULT_EXPOSURE,
};

export interface Viewer3dPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function parseViewer3dPreferences(input: unknown): Viewer3dPreferences {
  if (typeof input !== 'object' || input === null) {
    return DEFAULT_VIEWER3D_PREFERENCES;
  }
  const candidate = input as Record<string, unknown>;
  return {
    presetId: parseHdriPresetId(candidate.presetId),
    exposure: parseExposure(candidate.exposure),
  };
}

export function loadViewer3dPreferences(
  storage?: Viewer3dPreferencesStorage,
): Viewer3dPreferences {
  if (!storage) return DEFAULT_VIEWER3D_PREFERENCES;
  const raw = storage.getItem(VIEWER3D_PREFERENCES_KEY);
  if (raw === null) return DEFAULT_VIEWER3D_PREFERENCES;
  try {
    return parseViewer3dPreferences(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_VIEWER3D_PREFERENCES;
  }
}

export function saveViewer3dPreferences(
  preferences: Viewer3dPreferences,
  storage?: Viewer3dPreferencesStorage,
): void {
  if (!storage) return;
  storage.setItem(
    VIEWER3D_PREFERENCES_KEY,
    JSON.stringify({
      presetId: preferences.presetId,
      exposure: clampExposure(preferences.exposure),
    }),
  );
}
