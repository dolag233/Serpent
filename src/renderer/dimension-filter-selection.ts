// REQ-FILTER-025: unify the same-dimension multi-value click language across
// the filter bar. Default click replaces the dimension's whole selection
// with just the clicked value — clicking the sole active value clears it,
// mirroring the pre-existing single-preset toggle used by shape/resolution
// chips (see filter-presets.ts togglePresetRange) — while Shift+click
// OR-accumulates the clicked value into the existing selection instead.
// Cross-dimension combination stays AND and is untouched by this module.

/**
 * Click resolver for plain string-token dimensions (color swatches, rating
 * stars, tag names): default click covers the selection with just `value`;
 * Shift+click toggles `value` into/out of the existing selection.
 */
export function applyDimensionSelectionClick<T extends string>(
  current: readonly T[],
  value: T,
  shiftKey: boolean,
): T[] {
  if (shiftKey) {
    return current.includes(value)
      ? current.filter((existing) => existing !== value)
      : [...current, value];
  }
  const isSoleSelection = current.length === 1 && current[0] === value;
  return isSoleSelection ? [] : [value];
}

/** Case-insensitive membership check for the free-text format token field. */
export function formatTokensHas(formatFilter: string, ext: string): boolean {
  return formatFilter
    .split(",")
    .map((token) => token.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean)
    .includes(ext.toLowerCase());
}

/**
 * Click resolver for the format quick-chips, which sit over a free-text
 * comma token field rather than a plain string array. Default click
 * replaces the field with just the clicked extension; Shift+click
 * OR-accumulates it case-insensitively (matching the field's existing
 * case-insensitive dedupe).
 */
export function toggleFormatToken(
  formatFilter: string,
  ext: string,
  shiftKey: boolean,
): string {
  const tokens = formatFilter
    .split(",")
    .map((token) => token.trim().replace(/^\./, ""))
    .filter(Boolean);
  const lower = ext.toLowerCase();
  const exists = tokens.some((token) => token.toLowerCase() === lower);

  if (shiftKey) {
    const next = exists
      ? tokens.filter((token) => token.toLowerCase() !== lower)
      : [...tokens, ext];
    return next.join(", ");
  }
  const isSoleSelection = tokens.length === 1 && exists;
  return isSoleSelection ? "" : ext;
}
