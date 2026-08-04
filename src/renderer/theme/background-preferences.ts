import { z } from 'zod';

/** Versioned renderer-owned persistence key for the application backdrop. */
export const BACKGROUND_PREFERENCES_VERSION = 2 as const;
export const BACKGROUND_PREFERENCES_KEY = 'serpent.background-preferences.v2';
/**
 * v1 persisted key. Images were stored without any metadata and user files
 * were rejected above ~3 MB; v2 auto-compresses and records image provenance.
 */
export const BACKGROUND_PREFERENCES_LEGACY_KEY = 'serpent.background-preferences.v1';

/**
 * Keep image data below the practical localStorage quota. This is the size of
 * the complete UTF-8 data URL, not the decoded image, so the limit is stable
 * across browsers and does not require a Blob or filesystem API in the host.
 */
export const MAX_BACKGROUND_IMAGE_DATA_URL_BYTES = 4 * 1024 * 1024;

/**
 * Fit modes for the wallpaper. `cover` scales the longer edge to fill the
 * viewport and crops the overflow (no letterbox bars); `tile` repeats the
 * image. `contain` was removed because it leaves visible color edges.
 */
export const BACKGROUND_DISPLAY_MODES = ['cover', 'tile'] as const;
export type BackgroundDisplayMode = (typeof BACKGROUND_DISPLAY_MODES)[number];

export interface BackgroundPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SAFE_COLOR_PATTERN = /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6,8}|transparent)$/iu;
const SAFE_RASTER_MIME_TYPES = new Set([
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const DATA_URL_PATTERN = /^data:([^;,\s]+);base64,([a-z0-9+/]*={0,2})$/iu;

const defaultPreferences = (): BackgroundPreferences => ({
  version: BACKGROUND_PREFERENCES_VERSION,
  color: 'transparent',
  imageDataUrl: null,
  imageSource: null,
  mode: 'cover',
  overlayOpacity: 0.2,
});

export const DEFAULT_BACKGROUND_PREFERENCES: BackgroundPreferences =
  defaultPreferences();

export const backgroundColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    SAFE_COLOR_PATTERN,
    'Background colors must be bounded hex colors or transparent.',
  );

export function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length;
}

/** True only for bounded, base64-encoded raster image data URLs. */
export function isSafeBackgroundImageDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (utf8ByteLength(normalized) > MAX_BACKGROUND_IMAGE_DATA_URL_BYTES) {
    return false;
  }

  const match = DATA_URL_PATTERN.exec(normalized);
  if (!match) return false;

  const mimeType = match[1]?.toLowerCase();
  const payload = match[2] ?? '';
  if (!mimeType || !SAFE_RASTER_MIME_TYPES.has(mimeType)) return false;
  if (!payload || payload.length % 4 === 1) return false;
  return true;
}

export const backgroundImageDataUrlSchema = z
  .string()
  .trim()
  .refine(isSafeBackgroundImageDataUrl, {
    message:
      'Background images must be bounded base64 raster image data URLs.',
  });

const IMAGE_SOURCE_FILE_NAME_MAX = 255;

/** Provenance of the stored wallpaper; purely informational for the UI. */
export const backgroundImageSourceSchema = z.strictObject({
  fileName: z.string().min(1).max(IMAGE_SOURCE_FILE_NAME_MAX),
  width: z.number().int().min(1).max(16384),
  height: z.number().int().min(1).max(16384),
  originalBytes: z.number().int().min(0),
  encodedBytes: z.number().int().min(0),
});

export type BackgroundImageSource = z.infer<
  typeof backgroundImageSourceSchema
>;

export const backgroundDisplayModeSchema = z.enum(BACKGROUND_DISPLAY_MODES);

export const backgroundPreferencesSchema = z.strictObject({
  version: z.literal(BACKGROUND_PREFERENCES_VERSION),
  color: backgroundColorSchema,
  imageDataUrl: backgroundImageDataUrlSchema.nullable(),
  imageSource: backgroundImageSourceSchema.nullable(),
  mode: backgroundDisplayModeSchema,
  overlayOpacity: z.number().finite().min(0).max(1),
});

export type BackgroundPreferences = z.infer<
  typeof backgroundPreferencesSchema
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize a color without ever passing arbitrary CSS through to the DOM. */
export function normalizeBackgroundColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return SAFE_COLOR_PATTERN.test(normalized) ? normalized : undefined;
}

export function normalizeBackgroundImageDataUrl(
  value: unknown,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isSafeBackgroundImageDataUrl(value)) return null;
  return value.trim();
}

export function normalizeBackgroundDisplayMode(
  value: unknown,
): BackgroundDisplayMode {
  return backgroundDisplayModeSchema.safeParse(value).success
    ? (value as BackgroundDisplayMode)
    : DEFAULT_BACKGROUND_PREFERENCES.mode;
}

export function normalizeBackgroundOverlayOpacity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BACKGROUND_PREFERENCES.overlayOpacity;
  }
  return Math.min(1, Math.max(0, value));
}

/** Normalize image provenance; legacy records have none. */
export function normalizeBackgroundImageSource(
  value: unknown,
): BackgroundImageSource | null {
  if (value === null || value === undefined) return null;
  const parsed = backgroundImageSourceSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

/**
 * Convert untrusted persisted/input data to a safe, schema-valid preference.
 * Invalid individual fields fall back independently so a bad image does not
 * discard a user's valid color, fit mode, or opacity.
 */
export function normalizeBackgroundPreferences(
  value: unknown,
): BackgroundPreferences {
  const record = isRecord(value) ? value : {};
  const normalized: BackgroundPreferences = {
    version: BACKGROUND_PREFERENCES_VERSION,
    color:
      normalizeBackgroundColor(record.color) ??
      DEFAULT_BACKGROUND_PREFERENCES.color,
    imageDataUrl: normalizeBackgroundImageDataUrl(record.imageDataUrl),
    imageSource: normalizeBackgroundImageSource(record.imageSource),
    mode: normalizeBackgroundDisplayMode(record.mode),
    overlayOpacity: normalizeBackgroundOverlayOpacity(record.overlayOpacity),
  };

  return backgroundPreferencesSchema.parse(normalized);
}

/** Strict validation for values that are ready to persist. */
export function validateBackgroundPreferences(value: unknown): boolean {
  return backgroundPreferencesSchema.safeParse(value).success;
}

/** Expose structured Zod diagnostics when callers need to explain a failure. */
export function parseBackgroundPreferences(value: unknown) {
  return backgroundPreferencesSchema.safeParse(value);
}

function resolveStorage(
  storage?: BackgroundPreferencesStorage,
): BackgroundPreferencesStorage {
  if (storage) return storage;
  const localStorage = (globalThis as {
    localStorage?: BackgroundPreferencesStorage;
  }).localStorage;
  if (!localStorage) {
    throw new Error(
      'BackgroundPreferences: no storage provided and globalThis.localStorage is not available.',
    );
  }
  return localStorage;
}

/**
 * Read safely; storage failures and malformed JSON never escape to the UI.
 * v1 records (no image provenance) are migrated in place to the v2 key so a
 * user's existing wallpaper survives the schema bump.
 */
export function loadBackgroundPreferences(
  storage?: BackgroundPreferencesStorage,
): BackgroundPreferences {
  try {
    const store = resolveStorage(storage);
    const raw = store.getItem(BACKGROUND_PREFERENCES_KEY);
    if (raw) return normalizeBackgroundPreferences(JSON.parse(raw));

    const legacyRaw = store.getItem(BACKGROUND_PREFERENCES_LEGACY_KEY);
    if (legacyRaw) {
      const migrated = normalizeBackgroundPreferences(JSON.parse(legacyRaw));
      try {
        store.setItem(BACKGROUND_PREFERENCES_KEY, JSON.stringify(migrated));
        store.removeItem(BACKGROUND_PREFERENCES_LEGACY_KEY);
      } catch {
        // Migration copy is best-effort; the in-memory value is still valid.
      }
      return migrated;
    }

    return defaultPreferences();
  } catch {
    return defaultPreferences();
  }
}

/**
 * Persist only a strict, schema-valid value. A quota or storage error returns
 * false so the caller can show a notice without losing the in-memory state.
 */
export function saveBackgroundPreferences(
  preferences: BackgroundPreferences,
  storage?: BackgroundPreferencesStorage,
): boolean {
  const store = resolveStorage(storage);
  const parsed = parseBackgroundPreferences(preferences);
  if (!parsed.success) return false;

  try {
    store.setItem(BACKGROUND_PREFERENCES_KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

/** Remove persisted preferences; absence and storage failures are harmless. */
export function clearBackgroundPreferences(
  storage?: BackgroundPreferencesStorage,
): boolean {
  const store = resolveStorage(storage);
  try {
    store.removeItem(BACKGROUND_PREFERENCES_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Apply the validated background contract without allowing arbitrary CSS. */
export function applyBackgroundPreferences(
  preferences: BackgroundPreferences,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;

  const normalized = normalizeBackgroundPreferences(preferences);
  root.style.setProperty('--ui-background-color', normalized.color);
  root.style.setProperty(
    '--ui-background-image',
    normalized.imageDataUrl === null ? 'none' : `url(${normalized.imageDataUrl})`,
  );
  root.style.setProperty(
    '--ui-background-overlay-opacity',
    String(normalized.overlayOpacity),
  );
  // Keep a configured wallpaper/color visible through the application frame;
  // the normal transparent-background layout remains fully opaque.
  root.style.setProperty(
    '--ui-background-surface-opacity',
    normalized.imageDataUrl === null && normalized.color === 'transparent'
      ? '100%'
      : '84%',
  );
  root.style.setProperty('--ui-background-size', normalized.mode === 'tile' ? 'auto' : normalized.mode);
  root.style.setProperty('--ui-background-position', 'center');
  root.style.setProperty('--ui-background-repeat', normalized.mode === 'tile' ? 'repeat' : 'no-repeat');
}
