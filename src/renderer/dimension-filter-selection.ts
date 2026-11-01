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

export type TagFilterSelection = {
  includes: string[];
  excludes: string[];
};

/**
 * Left click edits only the include set. Right click edits only the exclude
 * set. The other set stays, except a tag cannot be in both: moving it to one
 * side removes it from the other. Shift toggles within the side being edited.
 */
export function applyTagFilterClick(
  current: TagFilterSelection,
  name: string,
  side: "include" | "exclude",
  shiftKey: boolean,
): TagFilterSelection {
  if (side === "include") {
    const includes = applyDimensionSelectionClick(current.includes, name, shiftKey);
    return {
      includes,
      excludes: includes.includes(name)
        ? current.excludes.filter((existing) => existing !== name)
        : [...current.excludes],
    };
  }
  const excludes = applyDimensionSelectionClick(current.excludes, name, shiftKey);
  return {
    includes: excludes.includes(name)
      ? current.includes.filter((existing) => existing !== name)
      : [...current.includes],
    excludes,
  };
}

export function splitTagFilterNames(value: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/**
 * Older sessions stored one tag list plus a single exclude flag. A saved
 * exclude flag with no separate exclude list still means that whole list is
 * excluded. New sessions keep includes and excludes at the same time.
 */
export function resolveTagFilterSets(input: {
  tagFilter: string;
  excludeTagFilter: boolean;
  excludedTagFilter?: string;
}): TagFilterSelection {
  const includes = splitTagFilterNames(input.tagFilter);
  const excludes = splitTagFilterNames(input.excludedTagFilter ?? "");
  if (input.excludeTagFilter && excludes.length === 0) {
    return { includes: [], excludes: includes };
  }
  const excluded = new Set(excludes.map((name) => name.toLocaleLowerCase()));
  return {
    includes: includes.filter((name) => !excluded.has(name.toLocaleLowerCase())),
    excludes,
  };
}

export function buildTagFilterClauses(
  selection: TagFilterSelection,
  match: "any" | "all",
  includeAi: boolean,
): Array<{ field: "tag"; values: string[]; exclude: boolean; includeAi: boolean }> {
  const clauses: Array<{
    field: "tag";
    values: string[];
    exclude: boolean;
    includeAi: boolean;
  }> = [];
  if (selection.includes.length > 0) {
    if (match === "all" && selection.includes.length > 1) {
      for (const tag of selection.includes) {
        clauses.push({ field: "tag", values: [tag], exclude: false, includeAi });
      }
    } else {
      clauses.push({
        field: "tag",
        values: selection.includes,
        exclude: false,
        includeAi,
      });
    }
  }
  if (selection.excludes.length > 0) {
    clauses.push({
      field: "tag",
      values: selection.excludes,
      exclude: true,
      includeAi,
    });
  }
  return clauses;
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
 *
 * The special `text` token (Serpent-4l7) is stored as-is and expanded to
 * TEXT_EXTENSIONS only when building the worker query.
 */
function parseFormatTokens(formatFilter: string): string[] {
  return formatFilter
    .split(",")
    .map((token) => token.trim().replace(/^\./, ""))
    .filter(Boolean);
}

export function toggleFormatToken(
  formatFilter: string,
  ext: string,
  shiftKey: boolean,
): string {
  const tokens = parseFormatTokens(formatFilter);
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

export type FormatGroupSelectionState = "none" | "partial" | "all";

/** How many of a format group's extensions are currently selected. */
export function formatGroupSelectionState(
  formatFilter: string,
  extensions: readonly string[],
): FormatGroupSelectionState {
  if (extensions.length === 0) return "none";
  let selected = 0;
  for (const extension of extensions) {
    if (formatTokensHas(formatFilter, extension)) selected += 1;
  }
  if (selected === 0) return "none";
  if (selected === extensions.length) return "all";
  return "partial";
}

/**
 * Category checkbox: when unchecked/partial → select every extension in the
 * group (OR into existing tokens). When all selected → clear that group only.
 */
export function toggleFormatGroup(
  formatFilter: string,
  extensions: readonly string[],
): string {
  const tokens = parseFormatTokens(formatFilter);
  const groupLower = new Set(
    extensions.map((extension) => extension.toLowerCase()),
  );
  const state = formatGroupSelectionState(formatFilter, extensions);
  if (state === "all") {
    return tokens
      .filter((token) => !groupLower.has(token.toLowerCase()))
      .join(", ");
  }
  const next = [...tokens];
  for (const extension of extensions) {
    if (!tokens.some((token) => token.toLowerCase() === extension.toLowerCase())) {
      next.push(extension);
    }
  }
  return next.join(", ");
}
