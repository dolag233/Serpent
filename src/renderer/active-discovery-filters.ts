// REQ-FILTER-002: describe active discovery filters as removable toolbar chips.
// Pure helpers — DimensionFilterBar / App stay thin.

export type ActiveFilterChip = {
  id: string;
  /** i18n key under filter.* or a preformatted label via `label` */
  labelKey?: string;
  label?: string;
  /** Values shown after the dimension name, e.g. "png, jpg" */
  detail?: string;
};

export type DiscoveryFilterSnapshot = {
  colorFilter: string;
  excludeColorFilter: boolean;
  formatFilter: string;
  excludeFormatFilter: boolean;
  tagFilter: string;
  excludeTagFilter: boolean;
  ratingFilter: string;
  excludeRatingFilter: boolean;
  favoriteFilter: "any" | "yes" | "no";
  sourceUrlFilter: "any" | "yes" | "no";
  availabilityFilter: "any" | "available" | "missing";
  excludeAvailabilityFilter: boolean;
  widthRange: { min: string; max: string; exclude: boolean };
  heightRange: { min: string; max: string; exclude: boolean };
  aspectRatioRange: { min: string; max: string; exclude: boolean };
  /** OR-selected shape/aspect preset ranges (Serpent-gp4). */
  aspectRatioRanges?: readonly { min: string; max: string }[];
  longEdgeRange: { min: string; max: string; exclude: boolean };
  durationRange: { min: string; max: string; exclude: boolean };
};

function hasRange(range: { min: string; max: string }): boolean {
  return range.min.trim() !== "" || range.max.trim() !== "";
}

function formatRangeDetail(range: { min: string; max: string }): string {
  const min = range.min.trim();
  const max = range.max.trim();
  if (min && max) return `${min}–${max}`;
  if (min) return `≥${min}`;
  if (max) return `≤${max}`;
  return "";
}

/**
 * Build the ordered list of active filter chips for the toolbar strip.
 * Sort is intentionally omitted (Serpent-w4p promotes sort separately).
 */
export function buildActiveFilterChips(
  snapshot: DiscoveryFilterSnapshot,
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  const colors = snapshot.colorFilter
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (colors.length > 0) {
    chips.push({
      id: "color",
      labelKey: "filter.dimColor",
      detail: `${snapshot.excludeColorFilter ? "−" : ""}${colors.join(", ")}`,
    });
  }

  const formats = snapshot.formatFilter
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (formats.length > 0) {
    chips.push({
      id: "format",
      labelKey: "filter.formatField",
      detail: `${snapshot.excludeFormatFilter ? "−" : ""}${formats.join(", ")}`,
    });
  }

  const tags = snapshot.tagFilter
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (tags.length > 0) {
    chips.push({
      id: "tag",
      labelKey: "filter.tagField",
      detail: `${snapshot.excludeTagFilter ? "−" : ""}${tags.join(", ")}`,
    });
  }

  const ratings = snapshot.ratingFilter
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (ratings.length > 0) {
    chips.push({
      id: "rating",
      labelKey: "filter.ratingField",
      detail: `${snapshot.excludeRatingFilter ? "−" : ""}${ratings.join(", ")}`,
    });
  }

  if (snapshot.favoriteFilter === "yes") {
    chips.push({ id: "favorite", labelKey: "filter.favoriteOnly" });
  } else if (snapshot.favoriteFilter === "no") {
    chips.push({ id: "favorite", labelKey: "filter.notFavorite" });
  }

  if (snapshot.sourceUrlFilter === "yes") {
    chips.push({ id: "source_url", labelKey: "filter.hasSourceUrl" });
  } else if (snapshot.sourceUrlFilter === "no") {
    chips.push({ id: "source_url", labelKey: "filter.noSourceUrl" });
  }

  if (snapshot.availabilityFilter !== "any") {
    chips.push({
      id: "availability",
      labelKey:
        snapshot.availabilityFilter === "available"
          ? "filter.available"
          : "filter.missing",
      detail: snapshot.excludeAvailabilityFilter ? "−" : undefined,
    });
  }

  const aspectRanges =
    snapshot.aspectRatioRanges && snapshot.aspectRatioRanges.length > 0
      ? snapshot.aspectRatioRanges
      : hasRange(snapshot.aspectRatioRange)
        ? [
            {
              min: snapshot.aspectRatioRange.min,
              max: snapshot.aspectRatioRange.max,
            },
          ]
        : [];
  if (aspectRanges.length > 0) {
    const detailBody = aspectRanges.map(formatRangeDetail).join(" ∨ ");
    chips.push({
      id: "aspect_ratio",
      labelKey: "filter.aspectRatio",
      detail: `${snapshot.aspectRatioRange.exclude ? "−" : ""}${detailBody}`,
    });
  }

  if (hasRange(snapshot.longEdgeRange)) {
    chips.push({
      id: "long_edge",
      labelKey: "filter.longEdgePx",
      detail: `${snapshot.longEdgeRange.exclude ? "−" : ""}${formatRangeDetail(snapshot.longEdgeRange)}`,
    });
  }

  if (hasRange(snapshot.widthRange)) {
    chips.push({
      id: "width",
      labelKey: "filter.widthPx",
      detail: `${snapshot.widthRange.exclude ? "−" : ""}${formatRangeDetail(snapshot.widthRange)}`,
    });
  }

  if (hasRange(snapshot.heightRange)) {
    chips.push({
      id: "height",
      labelKey: "filter.heightPx",
      detail: `${snapshot.heightRange.exclude ? "−" : ""}${formatRangeDetail(snapshot.heightRange)}`,
    });
  }

  if (hasRange(snapshot.durationRange)) {
    chips.push({
      id: "duration",
      labelKey: "filter.durationSec",
      detail: `${snapshot.durationRange.exclude ? "−" : ""}${formatRangeDetail(snapshot.durationRange)}`,
    });
  }

  return chips;
}

export type ClearableFilterId =
  | "color"
  | "format"
  | "tag"
  | "rating"
  | "favorite"
  | "source_url"
  | "availability"
  | "aspect_ratio"
  | "long_edge"
  | "width"
  | "height"
  | "duration"
  | "all";
