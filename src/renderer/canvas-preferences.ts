import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanvasPreferences {
  readonly version: 1;
  readonly viewMode: 'grid' | 'masonry';
  readonly cardSize: number;
  readonly fields: {
    readonly name: boolean;
    readonly size: boolean;
    readonly date: boolean;
  };
}

export interface CanvasPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CARD_SIZE_MIN = 96;
export const CARD_SIZE_MAX = 320;
// Serpent-akz: the card-size slider previously stepped by 8px (28 stops
// across the range), which read as coarse/jumpy in the commonly-used band.
// 2px gives ~4x the stops for a near-continuous feel while keeping the
// underlying value an integer pixel count (matches `clampCardSize` below).
export const CARD_SIZE_STEP = 2;

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const canvasPreferencesSchema = z.object({
  version: z.literal(1),
  viewMode: z.enum(['grid', 'masonry']),
  cardSize: z.number().int().min(CARD_SIZE_MIN).max(CARD_SIZE_MAX),
  fields: z.object({
    name: z.boolean(),
    size: z.boolean(),
    date: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PREF_KEY = 'serpent.canvas-prefs.v1';
const LEGACY_VIEW_MODE_KEY = 'serpent.asset-view-mode';
const LEGACY_CARD_SIZE_KEY = 'serpent.asset-card-size';

export const DEFAULT_CANVAS_PREFERENCES: CanvasPreferences = {
  version: 1,
  viewMode: 'grid',
  cardSize: 160,
  fields: { name: true, size: true, date: true },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampCardSize(value: number): number {
  return Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, Math.round(value)));
}

/**
 * Number of distinct stops the card-size slider offers across its full
 * range at a given step (Serpent-akz). Exported so a regression test can
 * assert the slider actually got finer, not just that the constant changed.
 */
export function cardSizeSliderStepCount(
  min: number = CARD_SIZE_MIN,
  max: number = CARD_SIZE_MAX,
  step: number = CARD_SIZE_STEP,
): number {
  if (step <= 0) return 0;
  return Math.round((max - min) / step);
}

function resolveStorage(storage?: CanvasPreferencesStorage): CanvasPreferencesStorage {
  if (storage) return storage;
  // In the renderer process, globalThis.localStorage is available.
  // The cast is safe because the subset of methods we use (getItem/setItem/removeItem)
  // matches the Storage interface.
  const ls = (globalThis as { localStorage?: CanvasPreferencesStorage }).localStorage;
  if (!ls) {
    throw new Error(
      'CanvasPreferences: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return ls;
}

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

/**
 * Attempt to migrate from the legacy flat keys (`serpent.asset-view-mode` and
 * `serpent.asset-card-size`).  Returns `undefined` when neither key is present
 * or when the stored values cannot be parsed.
 */
function migrateLegacy(
  storage: CanvasPreferencesStorage,
): CanvasPreferences | undefined {
  const rawViewMode = storage.getItem(LEGACY_VIEW_MODE_KEY);
  const rawCardSize = storage.getItem(LEGACY_CARD_SIZE_KEY);

  // Both keys must be present for a meaningful migration.
  if (rawViewMode === null || rawCardSize === null) return undefined;

  const viewMode = rawViewMode.trim();
  if (viewMode !== 'grid' && viewMode !== 'masonry') return undefined;

  const cardSize = Number(rawCardSize);
  if (!Number.isFinite(cardSize) || cardSize <= 0) return undefined;

  const migrated: CanvasPreferences = {
    version: 1,
    viewMode,
    cardSize: clampCardSize(cardSize),
    fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
  };

  // Clear legacy keys so migration only happens once.
  storage.removeItem(LEGACY_VIEW_MODE_KEY);
  storage.removeItem(LEGACY_CARD_SIZE_KEY);

  return migrated;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load canvas preferences from storage.
 *
 * - Returns a stored v1 value only after it passes Zod validation.
 * - When v1 is absent, corrupt, or invalid (unknown version, out-of-range
 *   cardSize, invalid viewMode, etc.), attempts migration from the complete
 *   legacy pair `serpent.asset-view-mode` + `serpent.asset-card-size`.
 * - Legacy keys are cleared on successful migration. If migration fails
 *   because the pair is incomplete or invalid, falls back to defaults.
 */
export function loadCanvasPreferences(
  storage?: CanvasPreferencesStorage,
): CanvasPreferences {
  const s = resolveStorage(storage);
  const migrateLegacyOrDefault = () =>
    migrateLegacy(s) ?? DEFAULT_CANVAS_PREFERENCES;

  const raw = s.getItem(PREF_KEY);
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return migrateLegacyOrDefault();
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return migrateLegacyOrDefault();
    }

    const result = canvasPreferencesSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    // Validation failed — try the complete legacy pair before using defaults.
    return migrateLegacyOrDefault();
  }

  // No v1 key — try legacy migration.
  return migrateLegacyOrDefault();
}

/**
 * Persist canvas preferences to storage.
 *
 * Clamps `cardSize` to `[96, 320]` before writing so the stored value is
 * always within the valid range.  The input `prefs` object is not mutated.
 */
export function saveCanvasPreferences(
  prefs: CanvasPreferences,
  storage?: CanvasPreferencesStorage,
): void {
  const s = resolveStorage(storage);

  const cleaned: CanvasPreferences = {
    ...prefs,
    cardSize: clampCardSize(prefs.cardSize),
  };

  s.setItem(PREF_KEY, JSON.stringify(cleaned));
}
