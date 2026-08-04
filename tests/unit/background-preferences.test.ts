import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_PREFERENCES_KEY,
  DEFAULT_BACKGROUND_PREFERENCES,
  MAX_BACKGROUND_IMAGE_DATA_URL_BYTES,
  backgroundPreferencesSchema,
  applyBackgroundPreferences,
  clearBackgroundPreferences,
  isSafeBackgroundImageDataUrl,
  loadBackgroundPreferences,
  normalizeBackgroundPreferences,
  normalizeBackgroundColor,
  parseBackgroundPreferences,
  saveBackgroundPreferences,
  validateBackgroundPreferences,
} from '../../src/renderer/theme/background-preferences';

function memoryStorage(options?: { quota?: boolean; throwingRead?: boolean }) {
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => {
      if (options?.throwingRead) throw new Error('storage unavailable');
      return memory.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (options?.quota) throw new DOMException('quota', 'QuotaExceededError');
      memory.set(key, value);
    },
    removeItem: (key: string) => memory.delete(key),
    memory,
  };
}

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('background preferences contract v1', () => {
  it('defines the versioned defaults and strict schema', () => {
    expect(DEFAULT_BACKGROUND_PREFERENCES).toEqual({
      version: 1,
      color: 'transparent',
      imageDataUrl: null,
      mode: 'cover',
      overlayOpacity: 0.2,
    });
    expect(backgroundPreferencesSchema.parse(DEFAULT_BACKGROUND_PREFERENCES)).toEqual(
      DEFAULT_BACKGROUND_PREFERENCES,
    );
    expect(validateBackgroundPreferences(DEFAULT_BACKGROUND_PREFERENCES)).toBe(true);
    expect(BACKGROUND_PREFERENCES_KEY).toBe(
      'serpent.background-preferences.v1',
    );
  });

  it('normalizes safe colors and clamps opacity while rejecting unsafe colors', () => {
    expect(normalizeBackgroundColor('  #ABCDEF80 ')).toBe('#abcdef80');
    expect(normalizeBackgroundColor('transparent')).toBe('transparent');
    expect(normalizeBackgroundColor('url(https://evil.invalid)')).toBeUndefined();

    expect(
      normalizeBackgroundPreferences({
        version: 1,
        color: ' #FA0 ',
        imageDataUrl: null,
        mode: 'contain',
        overlayOpacity: 2,
      }),
    ).toMatchObject({ color: '#fa0', mode: 'contain', overlayOpacity: 1 });
  });

  it('accepts only bounded base64 raster image data URLs', () => {
    expect(isSafeBackgroundImageDataUrl(PNG_DATA_URL)).toBe(true);
    expect(isSafeBackgroundImageDataUrl('data:image/svg+xml,<svg><script>alert(1)</script></svg>')).toBe(false);
    expect(isSafeBackgroundImageDataUrl('data:text/html;base64,PGh0bWw+')).toBe(false);
    expect(isSafeBackgroundImageDataUrl('https://example.invalid/background.png')).toBe(false);
    expect(isSafeBackgroundImageDataUrl('data:image/png,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects oversized data URLs before they can reach storage or CSS', () => {
    const oversized = `data:image/png;base64,${'A'.repeat(MAX_BACKGROUND_IMAGE_DATA_URL_BYTES)}`;
    expect(isSafeBackgroundImageDataUrl(oversized)).toBe(false);
    expect(normalizeBackgroundPreferences({ imageDataUrl: oversized }).imageDataUrl).toBeNull();
  });

  it('round-trips normalized preferences through storage', () => {
    const storage = memoryStorage();
    const preferences = {
      version: 1 as const,
      color: '#15202b',
      imageDataUrl: PNG_DATA_URL,
      mode: 'tile' as const,
      overlayOpacity: 0.65,
    };

    expect(saveBackgroundPreferences(preferences, storage)).toBe(true);
    expect(storage.memory.get(BACKGROUND_PREFERENCES_KEY)).toContain('"version":1');
    expect(loadBackgroundPreferences(storage)).toEqual(preferences);
  });

  it('safely falls back for missing, malformed, invalid, or unreadable storage', () => {
    const storage = memoryStorage();
    expect(loadBackgroundPreferences(storage)).toEqual(DEFAULT_BACKGROUND_PREFERENCES);

    storage.memory.set(BACKGROUND_PREFERENCES_KEY, '{not-json');
    expect(loadBackgroundPreferences(storage)).toEqual(DEFAULT_BACKGROUND_PREFERENCES);

    storage.memory.set(
      BACKGROUND_PREFERENCES_KEY,
      JSON.stringify({ version: 1, color: 'var(--secret)', imageDataUrl: PNG_DATA_URL }),
    );
    expect(loadBackgroundPreferences(storage)).toMatchObject({
      color: 'transparent',
      imageDataUrl: PNG_DATA_URL,
    });

    expect(loadBackgroundPreferences(memoryStorage({ throwingRead: true }))).toEqual(
      DEFAULT_BACKGROUND_PREFERENCES,
    );
  });

  it('reports strict validation failures without throwing', () => {
    expect(validateBackgroundPreferences({ ...DEFAULT_BACKGROUND_PREFERENCES, mode: 'stretch' })).toBe(false);
    expect(validateBackgroundPreferences({ ...DEFAULT_BACKGROUND_PREFERENCES, overlayOpacity: 1.1 })).toBe(false);
    expect(validateBackgroundPreferences({ ...DEFAULT_BACKGROUND_PREFERENCES, imageDataUrl: 'data:image/png,raw' })).toBe(false);
    expect(parseBackgroundPreferences({ ...DEFAULT_BACKGROUND_PREFERENCES, mode: 'stretch' }).success).toBe(false);
  });

  it('does not throw when localStorage quota is exceeded and can clear state', () => {
    const quotaStorage = memoryStorage({ quota: true });
    expect(saveBackgroundPreferences(DEFAULT_BACKGROUND_PREFERENCES, quotaStorage)).toBe(false);

    const storage = memoryStorage();
    expect(saveBackgroundPreferences(DEFAULT_BACKGROUND_PREFERENCES, storage)).toBe(true);
    expect(clearBackgroundPreferences(storage)).toBe(true);
    expect(storage.memory.has(BACKGROUND_PREFERENCES_KEY)).toBe(false);
  });

  it('applies only validated CSS variables and maps tile mode to repeat', () => {
    const values = new Map<string, string>();
    const previous = (globalThis as { document?: Document }).document;
    (globalThis as { document?: Document }).document = {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => values.set(name, value),
        },
      },
    } as unknown as Document;

    try {
      applyBackgroundPreferences({
        version: 1,
        color: '#102030',
        imageDataUrl: PNG_DATA_URL,
        mode: 'tile',
        overlayOpacity: 0.75,
      });
      expect(values.get('--ui-background-color')).toBe('#102030');
      expect(values.get('--ui-background-image')).toBe(`url(${PNG_DATA_URL})`);
    expect(values.get('--ui-background-overlay-opacity')).toBe('0.75');
      expect(values.get('--ui-background-surface-opacity')).toBe('84%');
      expect(values.get('--ui-background-size')).toBe('auto');
      expect(values.get('--ui-background-repeat')).toBe('repeat');
    } finally {
      if (previous === undefined) delete (globalThis as { document?: Document }).document;
      else (globalThis as { document?: Document }).document = previous;
    }
  });
});
