import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_PREFERENCES_KEY,
  BACKGROUND_PREFERENCES_LEGACY_KEYS,
  DEFAULT_BACKGROUND_PREFERENCES,
  MAX_BACKGROUND_IMAGE_DATA_URL_BYTES,
  backgroundPreferencesSchema,
  applyBackgroundPreferences,
  clearBackgroundPreferences,
  isSafeBackgroundImageDataUrl,
  loadBackgroundPreferences,
  normalizeBackgroundPreferences,
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

const IMAGE_SOURCE = {
  fileName: 'wallpaper.png',
  width: 2560,
  height: 1440,
  originalBytes: 8_000_000,
  encodedBytes: 1_200_000,
};

describe('background preferences contract v3', () => {
  it('defines the versioned defaults and strict schema', () => {
    expect(DEFAULT_BACKGROUND_PREFERENCES).toEqual({
      version: 3,
      imageDataUrl: null,
      imageSource: null,
      mode: 'cover',
      imageOpacity: 0.8,
    });
    expect(backgroundPreferencesSchema.parse(DEFAULT_BACKGROUND_PREFERENCES)).toEqual(
      DEFAULT_BACKGROUND_PREFERENCES,
    );
    expect(validateBackgroundPreferences(DEFAULT_BACKGROUND_PREFERENCES)).toBe(true);
    expect(BACKGROUND_PREFERENCES_KEY).toBe(
      'serpent.background-preferences.v3',
    );
    expect(BACKGROUND_PREFERENCES_LEGACY_KEYS).toEqual([
      'serpent.background-preferences.v2',
      'serpent.background-preferences.v1',
    ]);
  });

  it('normalizes opacity and rejects legacy color input (color is gone in v3)', () => {
    expect(
      normalizeBackgroundPreferences({
        version: 3,
        imageDataUrl: null,
        imageSource: null,
        mode: 'tile',
        imageOpacity: 2,
      }),
    ).toMatchObject({ mode: 'tile', imageOpacity: 1 });

    // A v2 record carrying a color field still normalizes without the color —
    // no background color can be configured in v3.
    const migrated = normalizeBackgroundPreferences({
      version: 2,
      color: ' #FA0 ',
      imageDataUrl: null,
      imageSource: null,
      mode: 'cover',
      overlayOpacity: 0.2,
    });
    expect(migrated).not.toHaveProperty('color');
    expect(migrated.mode).toBe('cover');
    expect(migrated.imageOpacity).toBe(0.8);
  });

  it('inverts v2 overlay opacity to image opacity and keeps supported modes', () => {
    // `overlayOpacity` 0.2 (veil) becomes `imageOpacity` 0.8 — the same
    // rendered wallpaper, opposite semantics. `cover` stays cover.
    expect(
      normalizeBackgroundPreferences({
        version: 2,
        color: '#000',
        imageDataUrl: null,
        imageSource: null,
        mode: 'cover',
        overlayOpacity: 0.2,
      }),
    ).toMatchObject({ mode: 'cover', imageOpacity: 0.8 });

    expect(
      normalizeBackgroundPreferences({
        version: 2,
        color: '#000',
        imageDataUrl: null,
        imageSource: null,
        mode: 'cover',
        overlayOpacity: 0.75,
      }),
    ).toMatchObject({ mode: 'cover', imageOpacity: 0.25 });

    expect(
      normalizeBackgroundPreferences({
        version: 2,
        color: '#000',
        imageDataUrl: null,
        imageSource: null,
        mode: 'tile',
        overlayOpacity: 0.5,
      }),
    ).toMatchObject({ mode: 'tile', imageOpacity: 0.5 });
  });

  it('falls back to cover when a persisted mode is no longer supported', () => {
    // `contain` (color edges) was removed; old records normalize to the
    // proportional cover default instead of being discarded. `fill` (stretch)
    // stays valid — it is a first-class mode.
    expect(
      normalizeBackgroundPreferences({
        version: 2,
        imageDataUrl: null,
        imageSource: null,
        mode: 'contain',
        overlayOpacity: 0.5,
      }).mode,
    ).toBe('cover');

    expect(
      normalizeBackgroundPreferences({
        version: 3,
        imageDataUrl: null,
        imageSource: null,
        mode: 'fill',
        imageOpacity: 0.8,
      }).mode,
    ).toBe('fill');
  });

  it('normalizes image provenance and rejects malformed records', () => {
    expect(
      normalizeBackgroundPreferences({
        version: 3,
        imageDataUrl: PNG_DATA_URL,
        imageSource: IMAGE_SOURCE,
        mode: 'fill',
        imageOpacity: 0.8,
      }).imageSource,
    ).toEqual(IMAGE_SOURCE);

    const bad = normalizeBackgroundPreferences({
      version: 3,
      imageDataUrl: PNG_DATA_URL,
      imageSource: { ...IMAGE_SOURCE, width: 0, fileName: '' },
      mode: 'fill',
      imageOpacity: 0.8,
    });
    expect(bad.imageSource).toBeNull();
    expect(bad.imageDataUrl).toBe(PNG_DATA_URL);
  });

  it('accepts high-resolution passthrough sources (no 16384 cap)', () => {
    // Regression: passed-through files keep their natural pixel size, and a
    // hard cap used to reject legitimate wallpapers during strict save — the
    // inverted "normal file fails, oversized file succeeds" report.
    const source = { ...IMAGE_SOURCE, width: 30_000, height: 20_000 };
    const preferences = {
      version: 3 as const,
      imageDataUrl: PNG_DATA_URL,
      imageSource: source,
      mode: 'fill' as const,
      imageOpacity: 0.8,
    };
    expect(backgroundPreferencesSchema.parse(preferences)).toEqual(preferences);
    expect(validateBackgroundPreferences(preferences)).toBe(true);
    expect(saveBackgroundPreferences(preferences, memoryStorage())).toBe(true);
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
    expect(MAX_BACKGROUND_IMAGE_DATA_URL_BYTES).toBe(4 * 1024 * 1024);
  });

  it('round-trips normalized preferences through storage', () => {
    const storage = memoryStorage();
    const preferences = {
      version: 3 as const,
      imageDataUrl: PNG_DATA_URL,
      imageSource: IMAGE_SOURCE,
      mode: 'tile' as const,
      imageOpacity: 0.65,
    };

    expect(saveBackgroundPreferences(preferences, storage)).toBe(true);
    expect(storage.memory.get(BACKGROUND_PREFERENCES_KEY)).toContain('"version":3');
    expect(loadBackgroundPreferences(storage)).toEqual(preferences);
  });

  it('migrates a v2 record to the v3 key and drops the legacy entry', () => {
    const storage = memoryStorage();
    storage.memory.set(
      BACKGROUND_PREFERENCES_LEGACY_KEYS[0]!,
      JSON.stringify({
        version: 2,
        color: '#102030',
        imageDataUrl: PNG_DATA_URL,
        imageSource: IMAGE_SOURCE,
        mode: 'cover',
        overlayOpacity: 0.4,
      }),
    );

    const loaded = loadBackgroundPreferences(storage);
    expect(loaded).toMatchObject({
      version: 3,
      imageDataUrl: PNG_DATA_URL,
      imageSource: IMAGE_SOURCE,
      mode: 'cover',
      imageOpacity: 0.6,
    });
    expect(storage.memory.has(BACKGROUND_PREFERENCES_KEY)).toBe(true);
    expect(storage.memory.has(BACKGROUND_PREFERENCES_LEGACY_KEYS[0]!)).toBe(false);
  });

  it('migrates a v1 record (no provenance, contain mode) through v2 semantics', () => {
    const storage = memoryStorage();
    storage.memory.set(
      BACKGROUND_PREFERENCES_LEGACY_KEYS[1]!,
      JSON.stringify({
        version: 1,
        color: '#102030',
        imageDataUrl: PNG_DATA_URL,
        mode: 'contain',
        overlayOpacity: 0.4,
      }),
    );

    const loaded = loadBackgroundPreferences(storage);
    expect(loaded).toMatchObject({
      version: 3,
      imageDataUrl: PNG_DATA_URL,
      mode: 'cover',
      imageOpacity: 0.6,
      imageSource: null,
    });
    expect(storage.memory.has(BACKGROUND_PREFERENCES_KEY)).toBe(true);
    expect(storage.memory.has(BACKGROUND_PREFERENCES_LEGACY_KEYS[1]!)).toBe(false);
  });

  it('safely falls back for missing, malformed, invalid, or unreadable storage', () => {
    const storage = memoryStorage();
    expect(loadBackgroundPreferences(storage)).toEqual(DEFAULT_BACKGROUND_PREFERENCES);

    storage.memory.set(BACKGROUND_PREFERENCES_KEY, '{not-json');
    expect(loadBackgroundPreferences(storage)).toEqual(DEFAULT_BACKGROUND_PREFERENCES);

    storage.memory.set(
      BACKGROUND_PREFERENCES_KEY,
      JSON.stringify({ version: 3, imageDataUrl: PNG_DATA_URL }),
    );
    expect(loadBackgroundPreferences(storage)).toMatchObject({
      imageDataUrl: PNG_DATA_URL,
    });

    expect(loadBackgroundPreferences(memoryStorage({ throwingRead: true }))).toEqual(
      DEFAULT_BACKGROUND_PREFERENCES,
    );
  });

  it('reports strict validation failures without throwing', () => {
    expect(validateBackgroundPreferences({ ...DEFAULT_BACKGROUND_PREFERENCES, mode: 'stretch' })).toBe(false);
    expect(validateBackgroundPreferences({ ...DEFAULT_BACKGROUND_PREFERENCES, imageOpacity: 1.1 })).toBe(false);
    expect(validateBackgroundPreferences({ ...DEFAULT_BACKGROUND_PREFERENCES, imageDataUrl: 'data:image/png,raw' })).toBe(false);
    expect(validateBackgroundPreferences({ ...DEFAULT_BACKGROUND_PREFERENCES, imageSource: { ...IMAGE_SOURCE, width: -1 } })).toBe(false);
    expect(validateBackgroundPreferences({ ...DEFAULT_BACKGROUND_PREFERENCES, color: '#fff' })).toBe(false);
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

  it('applies only validated CSS variables and maps cover/fill/tile to sizes', () => {
    const values = new Map<string, string>();
    const removed = new Set<string>();
    const previous = (globalThis as { document?: Document }).document;
    (globalThis as { document?: Document }).document = {
      documentElement: {
        style: {
          setProperty: (name: string, value: string) => values.set(name, value),
          removeProperty: (name: string) => removed.add(name),
        },
      },
    } as unknown as Document;

    try {
      applyBackgroundPreferences({
        version: 3,
        imageDataUrl: PNG_DATA_URL,
        imageSource: null,
        mode: 'tile',
        imageOpacity: 0.75,
      });
      expect(removed.has('--ui-background-color')).toBe(true);
      expect(values.get('--ui-background-image')).toBe(`url(${PNG_DATA_URL})`);
      expect(values.get('--ui-background-image-opacity')).toBe('0.75');
      // A configured wallpaper shows at the exact imageOpacity — the workspace
      // paints no veil of its own (preview stage and app render identically).
      expect(values.get('--ui-background-surface-opacity')).toBe('0%');
      expect(values.get('--ui-background-size')).toBe('auto');
      expect(values.get('--ui-background-repeat')).toBe('repeat');

      values.clear();
      applyBackgroundPreferences({
        version: 3,
        imageDataUrl: PNG_DATA_URL,
        imageSource: null,
        mode: 'fill',
        imageOpacity: 1,
      });
      expect(values.get('--ui-background-size')).toBe('100% 100%');
      expect(values.get('--ui-background-repeat')).toBe('no-repeat');

      values.clear();
      applyBackgroundPreferences({
        version: 3,
        imageDataUrl: PNG_DATA_URL,
        imageSource: null,
        mode: 'cover',
        imageOpacity: 1,
      });
      expect(values.get('--ui-background-size')).toBe('cover');
      expect(values.get('--ui-background-repeat')).toBe('no-repeat');

      values.clear();
      applyBackgroundPreferences({
        version: 3,
        imageDataUrl: null,
        imageSource: null,
        mode: 'cover',
        imageOpacity: 0.8,
      });
      expect(values.get('--ui-background-image')).toBe('none');
      expect(values.get('--ui-background-surface-opacity')).toBe('100%');
    } finally {
      if (previous === undefined) delete (globalThis as { document?: Document }).document;
      else (globalThis as { document?: Document }).document = previous;
    }
  });
});
