import { z } from 'zod';

import {
  isSupportedImageExtension,
  isSupportedModelExtension,
  isSupportedVideoExtension,
} from '../shared/media-formats';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CanvasCaptionAlign = 'left' | 'center' | 'right';

export interface CanvasPreferences {
  readonly version: 1;
  readonly viewMode: 'grid' | 'masonry';
  readonly cardSize: number;
  readonly captionAlign: CanvasCaptionAlign;
  readonly fields: {
    readonly name: boolean;
    readonly size: boolean;
    readonly date: boolean;
    /** Grid tile captions: width × height when metadata exists (Serpent-rzqj). */
    readonly dimensions: boolean;
    /** GIF / VIDEO / TEXT type chip (Serpent-cs1). */
    readonly badgeType: boolean;
    readonly badgeDuration: boolean;
    readonly badgeSource: boolean;
    /** Non-image extension chip, bottom-left (Serpent-cs1). */
    readonly badgeExtension: boolean;
  };
  /** Audio assets play in-place on hover (Serpent hover 音频). */
  readonly hoverAudioPlay: boolean;
  /** Video hover preview plays sound (off by default to avoid noise). */
  readonly hoverVideoSound: boolean;
}

export interface CanvasPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CARD_SIZE_MIN = 96;
export const CARD_SIZE_MAX = 320;
// Serpent-akz originally used this as the range-input step (2px). Serpent-7ny
// moved the browse slider onto width-aligned discrete column stops
// (`card-size-stops.ts`); keep the helper for clamp math / legacy tests.
export const CARD_SIZE_STEP = 2;

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const canvasCaptionAlignSchema = z.enum(['left', 'center', 'right']);

const canvasFieldsSchema = z
  .object({
    name: z.boolean(),
    size: z.boolean(),
    date: z.boolean(),
    dimensions: z.boolean().optional(),
    badgeType: z.boolean().optional(),
    badgeDuration: z.boolean().optional(),
    badgeSource: z.boolean().optional(),
    badgeExtension: z.boolean().optional(),
  })
  .transform((fields) => ({
    name: fields.name,
    size: fields.size,
    date: fields.date,
    dimensions: fields.dimensions ?? true,
    badgeType: fields.badgeType ?? true,
    badgeDuration: fields.badgeDuration ?? true,
    badgeSource: fields.badgeSource ?? true,
    badgeExtension: fields.badgeExtension ?? true,
  }));

const canvasPreferencesSchema = z
  .object({
    version: z.literal(1),
    viewMode: z.enum(['grid', 'masonry']),
    cardSize: z.number().int().min(CARD_SIZE_MIN).max(CARD_SIZE_MAX),
    captionAlign: canvasCaptionAlignSchema.optional(),
    fields: canvasFieldsSchema,
    hoverAudioPlay: z.boolean().optional(),
    hoverVideoSound: z.boolean().optional(),
  })
  .transform((value) => ({
    version: value.version,
    viewMode: value.viewMode,
    cardSize: value.cardSize,
    captionAlign: value.captionAlign ?? 'left',
    fields: value.fields,
    hoverAudioPlay: value.hoverAudioPlay ?? true,
    hoverVideoSound: value.hoverVideoSound ?? false,
  }));

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
  captionAlign: 'left',
  fields: {
    name: true,
    size: true,
    date: true,
    dimensions: true,
    badgeType: true,
    badgeDuration: true,
    badgeSource: true,
    badgeExtension: true,
  },
  hoverAudioPlay: true,
  hoverVideoSound: false,
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
    captionAlign: DEFAULT_CANVAS_PREFERENCES.captionAlign,
    fields: { ...DEFAULT_CANVAS_PREFERENCES.fields },
    hoverAudioPlay: DEFAULT_CANVAS_PREFERENCES.hoverAudioPlay,
    hoverVideoSound: DEFAULT_CANVAS_PREFERENCES.hoverVideoSound,
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

export function assetCaptionAlignClass(align: CanvasCaptionAlign): string {
  if (align === 'center') return 'asset-caption-align-center';
  if (align === 'right') return 'asset-caption-align-right';
  return 'asset-caption-align-left';
}

export function shouldShowGridDimensions(
  fields: Pick<CanvasPreferences['fields'], 'dimensions'>,
  _viewMode: CanvasPreferences['viewMode'],
  width: number | null | undefined,
  height: number | null | undefined,
  media: {
    mediaType?: string | null;
    sourceName?: string | null;
  } = {},
): boolean {
  if (!fields.dimensions || width == null || height == null) return false;

  // Resolution is meaningful for visual media only. Keep this check next to
  // the preference gate so loaded cards and layout placeholders cannot drift:
  // PDF/HTML/text/audio metadata must never turn into a fake pixel caption.
  if (media.mediaType != null) {
    return ['image', 'video', 'model'].includes(media.mediaType);
  }
  const sourceName = media.sourceName?.trim();
  return sourceName != null && (
    isSupportedImageExtension(sourceName) ||
    isSupportedVideoExtension(sourceName) ||
    isSupportedModelExtension(sourceName)
  );
}
