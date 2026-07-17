// ---------------------------------------------------------------------------
// Trash caption original-location label (Wave-3 audit P3)
//
// Trash cards show where an asset lived before trashing. The raw
// trashedFromPath duplicates the file name for root-level assets (two
// identical lines on one card), so the caption renders the parent directory
// instead; the full path stays available in the row's title tooltip.
// ---------------------------------------------------------------------------

import {
  DEFAULT_LOCALE,
  translateForLocale,
  type AppLocale,
} from "./i18n";

/**
 * Human-readable original location for a trashed asset:
 * the parent portion of the stored path, or the library-root label for
 * root-level files.
 */
export function trashedFromLabel(
  trashedFromPath: string,
  locale: AppLocale = DEFAULT_LOCALE,
): string {
  const normalized = trashedFromPath.replace(/\\/g, "/");
  const cut = normalized.lastIndexOf("/");
  if (cut <= 0) return translateForLocale(locale, "scope.rootFolder");
  return normalized.slice(0, cut);
}
