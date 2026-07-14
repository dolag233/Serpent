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

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const canvasPreferencesSchema = z.object({
  version: z.literal(1),
  viewMode: z.enum(['grid', 'masonry']),
  cardSize: z.number().int().min(96).max(320),
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

export const CARD_SIZE_MIN = 96;
export const CARD_SIZE_MAX = 320;

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

  const cardSize = Number.parseInt(rawCardSize, 10);
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
 * - Returns `DEFAULT_CANVAS_PREFERENCES` when the key is absent, the stored
 *   JSON is corrupt / not an object, or the parsed value fails Zod validation
 *   (unknown version, out-of-range cardSize, invalid viewMode, etc.).
 * - When the v1 key is absent but legacy keys exist, attempts migration from
 *   `serpent.asset-view-mode` + `serpent.asset-card-size`.  Legacy keys are
 *   cleared on successful migration.  If migration fails (or legacy keys are
 *   incomplete / unparseable), falls back to defaults.
 */
export function loadCanvasPreferences(
  storage?: CanvasPreferencesStorage,
): CanvasPreferences {
  const s = resolveStorage(storage);

  const raw = s.getItem(PREF_KEY);
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return DEFAULT_CANVAS_PREFERENCES;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_CANVAS_PREFERENCES;
    }

    const result = canvasPreferencesSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    // Validation failed — fall back to defaults.
    return DEFAULT_CANVAS_PREFERENCES;
  }

  // No v1 key — try legacy migration.
  const migrated = migrateLegacy(s);
  if (migrated !== undefined) return migrated;

  return DEFAULT_CANVAS_PREFERENCES;
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
