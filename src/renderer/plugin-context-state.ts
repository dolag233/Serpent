import type { PluginContributionContext } from "../plugins/plugin-context";
import type { AssetSummary } from "../shared/asset-types";

export type PluginBrowseFilterInput = {
  colorFilter: string;
  excludeColorFilter: boolean;
  formatFilter: string;
  excludeFormatFilter: boolean;
  tagFilter: string;
  excludeTagFilter: boolean;
  tagFilterMatch: "any" | "all";
  ratingFilter: string;
  excludeRatingFilter: boolean;
  favoriteFilter: "any" | "yes" | "no";
  sourceUrlFilter: "any" | "yes" | "no";
  availabilityFilter: "any" | "available" | "missing";
  excludeAvailabilityFilter: boolean;
  widthRange: { min: string; max: string; exclude: boolean };
  heightRange: { min: string; max: string; exclude: boolean };
  aspectRatioRange: { min: string; max: string; exclude: boolean };
  aspectRatioRanges: readonly { min: string; max: string }[];
  longEdgeRange: { min: string; max: string; exclude: boolean };
  durationRange: { min: string; max: string; exclude: boolean };
};

export function buildPluginBrowseFilter(
  input: PluginBrowseFilterInput,
): PluginContributionContext["browse"]["filter"] {
  const parts: string[] = [];
  const addText = (key: string, value: string, excluded: boolean) => {
    const normalized = value.trim();
    if (normalized.length > 0) parts.push(`${key}=${excluded ? "!" : ""}${normalized}`);
  };
  const addChoice = (key: string, value: string, excluded = false) => {
    if (value !== "any") parts.push(`${key}=${excluded ? "!" : ""}${value}`);
  };
  const addRange = (
    key: string,
    range: { min: string; max: string; exclude: boolean },
  ) => {
    const min = range.min.trim();
    const max = range.max.trim();
    if (min.length === 0 && max.length === 0) return;
    parts.push(`${key}=${range.exclude ? "!" : ""}${min}-${max}`);
  };

  addText("color", input.colorFilter, input.excludeColorFilter);
  addText("format", input.formatFilter, input.excludeFormatFilter);
  addText("tag", input.tagFilter, input.excludeTagFilter);
  if (input.tagFilter.trim().length > 0 && input.tagFilterMatch === "all") {
    parts.push("tagMatch=all");
  }
  addText("rating", input.ratingFilter, input.excludeRatingFilter);
  addChoice("favorite", input.favoriteFilter);
  addChoice("sourceUrl", input.sourceUrlFilter);
  addChoice("availability", input.availabilityFilter, input.excludeAvailabilityFilter);
  addRange("width", input.widthRange);
  addRange("height", input.heightRange);
  if (input.aspectRatioRanges.length > 0) {
    const ranges = input.aspectRatioRanges
      .map((range) => `${range.min.trim()}-${range.max.trim()}`)
      .filter((range) => range !== "-")
      .join("|");
    if (ranges.length > 0) {
      parts.push(`aspectRatio=${input.aspectRatioRange.exclude ? "!" : ""}${ranges}`);
    }
  } else {
    addRange("aspectRatio", input.aspectRatioRange);
  }
  addRange("longEdge", input.longEdgeRange);
  addRange("duration", input.durationRange);

  const value = parts.join("&");
  return value.length > 0 ? value.slice(0, 512) : undefined;
}

export function buildPluginBrowseScope(input: {
  selectedFolderId?: string;
  showTrash: boolean;
  collectionId: string | null;
  tagId: string | null;
  searchValue: string;
  filter: PluginBrowseFilterInput;
}): Partial<PluginContributionContext["browse"]> {
  const collectionId = input.collectionId;
  return {
    ...(input.selectedFolderId === undefined || input.showTrash ? {} : { folderId: input.selectedFolderId }),
    ...(collectionId === null ? {} : { collectionId }),
    ...(input.tagId === null ? {} : { tagId: input.tagId }),
    ...(input.searchValue.trim().length === 0 ? {} : { search: input.searchValue.trim() }),
    filter: buildPluginBrowseFilter(input.filter),
  };
}

export function pluginViewerMimeType(mediaType: AssetSummary["mediaType"]): string {
  switch (mediaType) {
    case "image": return "image/*";
    case "video": return "video/*";
    case "audio": return "audio/*";
    case "text": return "text/*";
    case "model": return "model/*";
    case "other": return "application/octet-stream";
  }
}

export function pluginViewerExtension(displayName: string): string | undefined {
  const match = /\.([^.]+)$/u.exec(displayName);
  return match?.[1]?.toLowerCase();
}

export function buildPluginViewerState(
  previewAsset: AssetSummary | null,
  fullscreen: boolean,
): Partial<PluginContributionContext["viewer"]> {
  if (previewAsset === null) return { active: false, fullscreen };
  return {
    active: true,
    assetId: previewAsset.assetId,
    extension: pluginViewerExtension(previewAsset.displayName),
    mimeType: pluginViewerMimeType(previewAsset.mediaType),
    mediaKind: previewAsset.mediaType,
    fullscreen,
  };
}
