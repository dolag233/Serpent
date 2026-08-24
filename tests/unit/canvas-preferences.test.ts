import { describe, expect, it } from 'vitest';

import {
  CARD_SIZE_MAX,
  CARD_SIZE_MIN,
  CARD_SIZE_STEP,
  cardSizeSliderStepCount,
  DEFAULT_CANVAS_PREFERENCES,
  loadCanvasPreferences,
  PREF_KEY,
  saveCanvasPreferences,
  shouldShowGridDimensions,
  type CanvasPreferences,
} from '../../src/renderer/canvas-preferences';

type StorageStub = {
  _data: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function createStorageStub(initial?: Record<string, string>): StorageStub {
  const data = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    _data: data,
    getItem(key: string): string | null {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
    removeItem(key: string): void {
      data.delete(key);
    },
  };
}

const LEGACY_VIEW_MODE_KEY = 'serpent.asset-view-mode';
const LEGACY_CARD_SIZE_KEY = 'serpent.asset-card-size';

describe('loadCanvasPreferences', () => {
  it('returns defaults when the key is absent', () => {
    const storage = createStorageStub();

    const prefs = loadCanvasPreferences(storage);

    expect(prefs).toEqual(DEFAULT_CANVAS_PREFERENCES);
  });

  it('returns defaults when the stored JSON is corrupt', () => {
    const storage = createStorageStub({
      [PREF_KEY]: '{not valid json',
      [LEGACY_CARD_SIZE_KEY]: '200',
    });

    const prefs = loadCanvasPreferences(storage);

    expect(prefs).toEqual(DEFAULT_CANVAS_PREFERENCES);
  });

  it('migrates complete legacy preferences when the stored v1 JSON is corrupt', () => {
    const storage = createStorageStub({
      [PREF_KEY]: '{not valid json',
      [LEGACY_VIEW_MODE_KEY]: 'masonry',
      [LEGACY_CARD_SIZE_KEY]: '200',
    });

    const prefs = loadCanvasPreferences(storage);

    expect(prefs).toEqual({
      version: 1,
      viewMode: 'masonry',
      cardSize: 200,
      captionAlign: 'left',
      fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
      hoverAudioPlay: DEFAULT_CANVAS_PREFERENCES.hoverAudioPlay,
      hoverVideoSound: DEFAULT_CANVAS_PREFERENCES.hoverVideoSound,
    });
    expect(storage.getItem(LEGACY_VIEW_MODE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_CARD_SIZE_KEY)).toBeNull();
  });

  it('uses defaults when invalid v1 data has a malformed legacy card size', () => {
    const storage = createStorageStub({
      [PREF_KEY]: '{not valid json',
      [LEGACY_VIEW_MODE_KEY]: 'masonry',
      [LEGACY_CARD_SIZE_KEY]: '200px',
    });

    const prefs = loadCanvasPreferences(storage);

    expect(prefs).toEqual(DEFAULT_CANVAS_PREFERENCES);
    expect(storage.getItem(LEGACY_VIEW_MODE_KEY)).toBe('masonry');
    expect(storage.getItem(LEGACY_CARD_SIZE_KEY)).toBe('200px');
  });

  it('returns defaults when the stored JSON is not an object', () => {
    const storage = createStorageStub({ [PREF_KEY]: '"just a string"' });

    const prefs = loadCanvasPreferences(storage);

    expect(prefs).toEqual(DEFAULT_CANVAS_PREFERENCES);
  });

  it('returns defaults when the version is unknown/invalid', () => {
    const storage = createStorageStub({
      [PREF_KEY]: JSON.stringify({
        version: 99,
        viewMode: 'grid',
        cardSize: 200,
        fields: { name: false, size: true, date: true },
      }),
    });

    const prefs = loadCanvasPreferences(storage);

    expect(prefs).toEqual(DEFAULT_CANVAS_PREFERENCES);
  });

  it('migrates complete legacy preferences when the stored v1 version is unknown', () => {
    const storage = createStorageStub({
      [PREF_KEY]: JSON.stringify({
        version: 99,
        viewMode: 'grid',
        cardSize: 160,
        fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
      }),
      [LEGACY_VIEW_MODE_KEY]: 'masonry',
      [LEGACY_CARD_SIZE_KEY]: '240',
    });

    const prefs = loadCanvasPreferences(storage);

    expect(prefs).toEqual({
      version: 1,
      viewMode: 'masonry',
      cardSize: 240,
      captionAlign: 'left',
      fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
      hoverAudioPlay: DEFAULT_CANVAS_PREFERENCES.hoverAudioPlay,
      hoverVideoSound: DEFAULT_CANVAS_PREFERENCES.hoverVideoSound,
    });
    expect(storage.getItem(LEGACY_VIEW_MODE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_CARD_SIZE_KEY)).toBeNull();
  });

  it('returns defaults when cardSize is out of range', () => {
    const storage = createStorageStub({
      [PREF_KEY]: JSON.stringify({
        version: 1,
        viewMode: 'grid',
        cardSize: 50,
        fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
      }),
    });

    const prefs = loadCanvasPreferences(storage);

    expect(prefs).toEqual(DEFAULT_CANVAS_PREFERENCES);
  });

  it('returns defaults when viewMode is invalid', () => {
    const storage = createStorageStub({
      [PREF_KEY]: JSON.stringify({
        version: 1,
        viewMode: 'list' as unknown,
        cardSize: 160,
        fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
      }),
    });

    const prefs = loadCanvasPreferences(storage);

    expect(prefs).toEqual(DEFAULT_CANVAS_PREFERENCES);
  });

  describe('legacy migration', () => {
    it('migrates legacy keys when the new key is absent', () => {
      const storage = createStorageStub({
        [LEGACY_VIEW_MODE_KEY]: 'masonry',
        [LEGACY_CARD_SIZE_KEY]: '200',
      });

      const prefs = loadCanvasPreferences(storage);

      expect(prefs).toEqual({
        version: 1,
        viewMode: 'masonry',
        cardSize: 200,
        captionAlign: 'left',
        fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
        hoverAudioPlay: DEFAULT_CANVAS_PREFERENCES.hoverAudioPlay,
        hoverVideoSound: DEFAULT_CANVAS_PREFERENCES.hoverVideoSound,
      });
    });

    it('clears legacy keys after successful migration', () => {
      const storage = createStorageStub({
        [LEGACY_VIEW_MODE_KEY]: 'masonry',
        [LEGACY_CARD_SIZE_KEY]: '200',
      });

      loadCanvasPreferences(storage);

      expect(storage.getItem(LEGACY_VIEW_MODE_KEY)).toBeNull();
      expect(storage.getItem(LEGACY_CARD_SIZE_KEY)).toBeNull();
    });

    it('uses defaults for fields even when migrating from legacy keys', () => {
      const storage = createStorageStub({
        [LEGACY_VIEW_MODE_KEY]: 'grid',
        [LEGACY_CARD_SIZE_KEY]: '250',
      });

      const prefs = loadCanvasPreferences(storage);

      expect(prefs.fields).toEqual(DEFAULT_CANVAS_PREFERENCES.fields);
    });

    it('skips migration when the new key already exists', () => {
      const storage = createStorageStub({
        [PREF_KEY]: JSON.stringify({
          version: 1,
          viewMode: 'grid',
          cardSize: 160,
          fields: { name: true, size: true, date: false },
        }),
        [LEGACY_VIEW_MODE_KEY]: 'masonry',
        [LEGACY_CARD_SIZE_KEY]: '300',
      });

      const prefs = loadCanvasPreferences(storage);

      // Should use the new key, not the legacy values
      expect(prefs).toEqual({
        version: 1,
        viewMode: 'grid',
        cardSize: 160,
        captionAlign: 'left',
        fields: {
          ...DEFAULT_CANVAS_PREFERENCES.fields,
          date: false,
        },
        hoverAudioPlay: DEFAULT_CANVAS_PREFERENCES.hoverAudioPlay,
        hoverVideoSound: DEFAULT_CANVAS_PREFERENCES.hoverVideoSound,
      });
      // Legacy keys should be left untouched (new key takes precedence)
    });

    it('does not migrate when legacy view-mode is missing', () => {
      const storage = createStorageStub({
        [LEGACY_CARD_SIZE_KEY]: '200',
      });

      const prefs = loadCanvasPreferences(storage);

      expect(prefs).toEqual(DEFAULT_CANVAS_PREFERENCES);
    });

    it('clamps migrated legacy cardSize to the valid range', () => {
      const storage = createStorageStub({
        [LEGACY_VIEW_MODE_KEY]: 'grid',
        [LEGACY_CARD_SIZE_KEY]: '50',
      });

      const prefs = loadCanvasPreferences(storage);

      expect(prefs.cardSize).toBe(96);
    });
  });
});

describe('saveCanvasPreferences', () => {
  it('saves valid preferences as JSON and round-trips correctly', () => {
    const storage = createStorageStub();
    const prefs: CanvasPreferences = {
      version: 1,
      viewMode: 'masonry',
      cardSize: 250,
      captionAlign: 'left',
      fields: {
        ...DEFAULT_CANVAS_PREFERENCES.fields,
        name: false,
      },
      hoverAudioPlay: true,
      hoverVideoSound: false,
    };

    saveCanvasPreferences(prefs, storage);

    const raw = storage.getItem(PREF_KEY);
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual(prefs);
  });

  it('clamps cardSize to 96..320 on save', () => {
    const storage = createStorageStub();

    saveCanvasPreferences({ ...DEFAULT_CANVAS_PREFERENCES, cardSize: 50 }, storage);
    expect(JSON.parse(storage.getItem(PREF_KEY)!).cardSize).toBe(96);

    saveCanvasPreferences({ ...DEFAULT_CANVAS_PREFERENCES, cardSize: 500 }, storage);
    expect(JSON.parse(storage.getItem(PREF_KEY)!).cardSize).toBe(320);
  });

  it('does not mutate the passed-in preferences object on clamp', () => {
    const storage = createStorageStub();
    const prefs: CanvasPreferences = {
      version: 1,
      viewMode: 'grid',
      cardSize: 50,
      captionAlign: 'left',
      fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
      hoverAudioPlay: true,
      hoverVideoSound: false,
    };

    saveCanvasPreferences(prefs, storage);

    // Original input object should be unchanged
    expect(prefs.cardSize).toBe(50);
  });

  it('round-trips: save then load returns the same preferences', () => {
    const saveStorage = createStorageStub();
    const prefs: CanvasPreferences = {
      version: 1,
      viewMode: 'masonry',
      cardSize: 200,
      captionAlign: 'left',
      fields: {
        ...DEFAULT_CANVAS_PREFERENCES.fields,
        name: false,
        size: false,
      },
      hoverAudioPlay: true,
      hoverVideoSound: false,
    };

    saveCanvasPreferences(prefs, saveStorage);

    const loaded = loadCanvasPreferences(saveStorage);

    expect(loaded).toEqual(prefs);
  });
});

describe('DEFAULT_CANVAS_PREFERENCES', () => {
  it('fills missing badge field toggles when loading older v1 prefs (Serpent-cs1)', () => {
    const storage = createStorageStub({
      [PREF_KEY]: JSON.stringify({
        version: 1,
        viewMode: 'grid',
        cardSize: 160,
        fields: { name: true, size: true, date: false },
      }),
    });

    const prefs = loadCanvasPreferences(storage);

    expect(prefs.fields).toEqual({
      name: true,
      size: true,
      date: false,
      dimensions: true,
      badgeType: true,
      badgeDuration: true,
      badgeSource: true,
      badgeExtension: true,
    });
  });

  it('has viewMode grid, cardSize 160, and all fields enabled', () => {
    expect(DEFAULT_CANVAS_PREFERENCES).toEqual({
      version: 1,
      viewMode: 'grid',
      cardSize: 160,
      captionAlign: 'left',
      fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
      hoverAudioPlay: DEFAULT_CANVAS_PREFERENCES.hoverAudioPlay,
      hoverVideoSound: DEFAULT_CANVAS_PREFERENCES.hoverVideoSound,
    });
  });

  it('defaults captionAlign to left when loading older v1 prefs', () => {
    const storage = createStorageStub({
      [PREF_KEY]: JSON.stringify({
        version: 1,
        viewMode: 'grid',
        cardSize: 160,
        fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
      }),
    });

    expect(loadCanvasPreferences(storage).captionAlign).toBe('left');
  });

  it('defaults dimensions to true when loading older v1 prefs without the field', () => {
    const storage = createStorageStub({
      [PREF_KEY]: JSON.stringify({
        version: 1,
        viewMode: 'grid',
        cardSize: 160,
        fields: { name: true, size: true, date: true },
      }),
    });

    expect(loadCanvasPreferences(storage).fields.dimensions).toBe(true);
  });
});

describe('CARD_SIZE_STEP / cardSizeSliderStepCount (legacy Serpent-akz helpers)', () => {
  it('still exposes a positive integer step that divides the range', () => {
    expect(CARD_SIZE_STEP).toBeGreaterThan(0);
    expect((CARD_SIZE_MAX - CARD_SIZE_MIN) % CARD_SIZE_STEP).toBe(0);
  });

  it('computes stop count for arbitrary ranges/steps', () => {
    expect(cardSizeSliderStepCount(96, 320, 2)).toBe(112);
    expect(cardSizeSliderStepCount(96, 320, 1)).toBe(224);
  });

  it('returns 0 for a non-positive step instead of dividing by zero', () => {
    expect(cardSizeSliderStepCount(96, 320, 0)).toBe(0);
    expect(cardSizeSliderStepCount(96, 320, -2)).toBe(0);
  });
});

describe('canvas resolution caption visibility', () => {
  const fields = { dimensions: true } as const;

  it('follows the preference in both canvas layouts for visual media', () => {
    expect(shouldShowGridDimensions(fields, 'grid', 1920, 1080, { mediaType: 'image' })).toBe(true);
    expect(shouldShowGridDimensions(fields, 'masonry', 1920, 1080, { mediaType: 'video' })).toBe(true);
    expect(shouldShowGridDimensions(fields, 'masonry', 1920, 1080, { mediaType: 'model' })).toBe(true);
  });

  it('does not expose document dimensions as a resolution caption', () => {
    expect(shouldShowGridDimensions(fields, 'grid', 1920, 1080, { mediaType: 'document' })).toBe(false);
    expect(shouldShowGridDimensions(fields, 'masonry', 1920, 1080, { sourceName: 'guide.pdf' })).toBe(false);
    expect(shouldShowGridDimensions(fields, 'grid', 1920, 1080, { sourceName: 'page.html' })).toBe(false);
  });

  it('honors the dimensions toggle', () => {
    expect(shouldShowGridDimensions({ dimensions: false }, 'grid', 1920, 1080, { mediaType: 'image' })).toBe(false);
  });
});
