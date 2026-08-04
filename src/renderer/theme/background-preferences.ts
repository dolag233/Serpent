import { z } from 'zod';

/** Versioned renderer-owned persistence key for the application backdrop. */
export const BACKGROUND_PREFERENCES_VERSION = 3 as const;
export const BACKGROUND_PREFERENCES_KEY = 'serpent.background-preferences.v3';
/**
 * Legacy persisted keys. v1 stored images without metadata and rejected user
 * files above ~3 MB; v2 added auto-compression and image provenance, kept a
 * background color and a readability-overlay slider, and used `cover`/`tile`.
 * v3 drops the background color, renames the overlay slider to an image-opacity
 * slider (inverted semantics), and replaces `cover` with `fill`.
 */
export const BACKGROUND_PREFERENCES_LEGACY_KEYS = [
  'serpent.background-preferences.v2',
  'serpent.background-preferences.v1',
] as const;

/**
 * Keep image data below the practical localStorage quota. This is the size of
 * the complete UTF-8 data URL, not the decoded image, so the limit is stable
 * across browsers and does not require a Blob or filesystem API in the host.
 */
export const MAX_BACKGROUND_IMAGE_DATA_URL_BYTES = 4 * 1024 * 1024;

/**
 * Fit modes for the wallpaper. `cover` scales the image proportionally so one
 * axis fills the surface and the other is scaled equally (cropping overflow —
 * the image stays complete on the locked axis, nothing is stretched); `fill`
 * stretches the image to the full surface on both axes; `tile` repeats the
 * image. `contain` was removed because it leaves color edges.
 */
export const BACKGROUND_DISPLAY_MODES = ['cover', 'fill', 'tile'] as const;
export type BackgroundDisplayMode = (typeof BACKGROUND_DISPLAY_MODES)[number];

export interface BackgroundPreferencesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

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
  imageDataUrl: null,
  imageSource: null,
  mode: 'cover',
  imageOpacity: 0.8,
});

export const DEFAULT_BACKGROUND_PREFERENCES: BackgroundPreferences =
  defaultPreferences();

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

/**
 * Provenance of the stored wallpaper; purely informational for the UI.
 * Pixel dimensions are unbounded above: passed-through files keep their
 * natural size, so a hard cap here would reject legitimate wallpapers during
 * strict schema validation on save (the compression path never exceeds
 * BACKGROUND_IMAGE_MAX_DIMENSION, so oversized files were the ones that
 * succeeded — inverted from intent).
 */
export const backgroundImageSourceSchema = z.strictObject({
  fileName: z.string().min(1).max(IMAGE_SOURCE_FILE_NAME_MAX),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  originalBytes: z.number().int().min(0),
  encodedBytes: z.number().int().min(0),
});

export type BackgroundImageSource = z.infer<
  typeof backgroundImageSourceSchema
>;

export const backgroundDisplayModeSchema = z.enum(BACKGROUND_DISPLAY_MODES);

export const backgroundPreferencesSchema = z.strictObject({
  version: z.literal(BACKGROUND_PREFERENCES_VERSION),
  imageDataUrl: backgroundImageDataUrlSchema.nullable(),
  imageSource: backgroundImageSourceSchema.nullable(),
  mode: backgroundDisplayModeSchema,
  imageOpacity: z.number().finite().min(0).max(1),
});

export type BackgroundPreferences = z.infer<
  typeof backgroundPreferencesSchema
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
  if (backgroundDisplayModeSchema.safeParse(value).success) {
    return value as BackgroundDisplayMode;
  }
  // `contain` (v1, color edges) and `fill` (v3 early value, stretching) both
  // migrate to the proportional cover default.
  return DEFAULT_BACKGROUND_PREFERENCES.mode;
}

/**
 * Normalize the image-opacity slider value. Legacy v1/v2 records stored the
 * inverse semantics (readability-overlay opacity, where 1 hid the image), so
 * they migrate to `1 - overlayOpacity` — e.g. the old default 0.2 becomes the
 * new default 0.8, keeping the same rendered wallpaper.
 */
export function normalizeBackgroundImageOpacity(
  value: unknown,
  legacyOverlayOpacity?: unknown,
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  if (typeof legacyOverlayOpacity === 'number' && Number.isFinite(legacyOverlayOpacity)) {
    return Math.min(1, Math.max(0, 1 - legacyOverlayOpacity));
  }
  return DEFAULT_BACKGROUND_PREFERENCES.imageOpacity;
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
 * discard a user's valid fit mode or opacity. v1/v2 records are migrated in
 * place: the background color is dropped (no color shows behind a wallpaper),
 * `cover` becomes `fill`, and the overlay opacity is inverted to image opacity.
 */
export function normalizeBackgroundPreferences(
  value: unknown,
): BackgroundPreferences {
  const record = isRecord(value) ? value : {};
  const normalized: BackgroundPreferences = {
    version: BACKGROUND_PREFERENCES_VERSION,
    imageDataUrl: normalizeBackgroundImageDataUrl(record.imageDataUrl),
    imageSource: normalizeBackgroundImageSource(record.imageSource),
    mode: normalizeBackgroundDisplayMode(record.mode),
    imageOpacity: normalizeBackgroundImageOpacity(
      record.imageOpacity,
      record.overlayOpacity,
    ),
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
 * v1/v2 records are migrated in place to the v3 key so a user's existing
 * wallpaper survives the schema bump.
 */
export function loadBackgroundPreferences(
  storage?: BackgroundPreferencesStorage,
): BackgroundPreferences {
  try {
    const store = resolveStorage(storage);
    const raw = store.getItem(BACKGROUND_PREFERENCES_KEY);
    if (raw) return normalizeBackgroundPreferences(JSON.parse(raw));

    for (const legacyKey of BACKGROUND_PREFERENCES_LEGACY_KEYS) {
      const legacyRaw = store.getItem(legacyKey);
      if (legacyRaw) {
        const migrated = normalizeBackgroundPreferences(JSON.parse(legacyRaw));
        try {
          store.setItem(BACKGROUND_PREFERENCES_KEY, JSON.stringify(migrated));
          store.removeItem(legacyKey);
        } catch {
          // Migration copy is best-effort; the in-memory value is still valid.
        }
        return migrated;
      }
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
  // The background color is gone in v3; let the token default (surface canvas)
  // own the variable so a stale v2 inline value cannot leak through.
  root.style.removeProperty('--ui-background-color');
  root.style.setProperty(
    '--ui-background-image',
    normalized.imageDataUrl === null ? 'none' : `url(${normalized.imageDataUrl})`,
  );
  root.style.setProperty(
    '--ui-background-image-opacity',
    String(normalized.imageOpacity),
  );
  // With a wallpaper, the workspace paints no veil of its own so the image is
  // shown at exactly the configured imageOpacity (the preview stage in
  // settings renders the same backdrop tokens — what you see is what you get).
  // Without one, surfaces stay fully opaque for the solid layout.
  root.style.setProperty(
    '--ui-background-surface-opacity',
    normalized.imageDataUrl === null ? '100%' : '0%',
  );
  root.style.setProperty(
    '--ui-background-size',
    normalized.mode === 'tile' ? 'auto' : normalized.mode === 'fill' ? '100% 100%' : 'cover',
  );
  root.style.setProperty('--ui-background-position', 'center');
  root.style.setProperty('--ui-background-repeat', normalized.mode === 'tile' ? 'repeat' : 'no-repeat');
}
