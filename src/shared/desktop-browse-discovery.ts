import { z } from 'zod';

const nonBlankCsvToken = z.string().max(255);

export const desktopTernaryFilterSchema = z.enum(['any', 'yes', 'no']);
export type DesktopTernaryFilter = z.infer<typeof desktopTernaryFilterSchema>;

export const desktopAvailabilityFilterSchema = z.enum([
  'any',
  'available',
  'missing',
]);
export type DesktopAvailabilityFilter = z.infer<typeof desktopAvailabilityFilterSchema>;

export const desktopTagFilterMatchSchema = z.enum(['any', 'all']);
export type DesktopTagFilterMatch = z.infer<typeof desktopTagFilterMatchSchema>;

export const desktopNumericRangeInputSchema = z.strictObject({
  min: z.string().max(32).nullable().optional(),
  max: z.string().max(32).nullable().optional(),
  exclude: z.boolean().optional(),
});
export type DesktopNumericRangeInput = z.infer<typeof desktopNumericRangeInputSchema>;

export const desktopNumericRangeStateSchema = z.strictObject({
  min: z.string().max(32),
  max: z.string().max(32),
  exclude: z.boolean(),
});
export type DesktopNumericRangeState = z.infer<typeof desktopNumericRangeStateSchema>;

export const desktopDiscoveryFilterFieldsSchema = z.strictObject({
  formatFilter: z.string().max(1024),
  excludeFormatFilter: z.boolean(),
  tagFilter: z.string().max(1024),
  excludeTagFilter: z.boolean(),
  tagFilterMatch: desktopTagFilterMatchSchema,
  ratingFilter: z.string().max(64),
  excludeRatingFilter: z.boolean(),
  favoriteFilter: desktopTernaryFilterSchema,
  sourceUrlFilter: desktopTernaryFilterSchema,
  availabilityFilter: desktopAvailabilityFilterSchema,
  excludeAvailabilityFilter: z.boolean(),
  widthRange: desktopNumericRangeStateSchema,
  heightRange: desktopNumericRangeStateSchema,
  aspectRatioRange: desktopNumericRangeStateSchema,
  longEdgeRange: desktopNumericRangeStateSchema,
  durationRange: desktopNumericRangeStateSchema,
});
export type DesktopDiscoveryFilterFields = z.infer<typeof desktopDiscoveryFilterFieldsSchema>;

export const desktopDiscoveryFilterPatchSchema = z.strictObject({
  formatFilter: z.string().max(1024).nullable().optional(),
  excludeFormatFilter: z.boolean().optional(),
  tagFilter: z.string().max(1024).nullable().optional(),
  excludeTagFilter: z.boolean().optional(),
  tagFilterMatch: desktopTagFilterMatchSchema.optional(),
  ratingFilter: z.string().max(64).nullable().optional(),
  excludeRatingFilter: z.boolean().optional(),
  favoriteFilter: desktopTernaryFilterSchema.optional(),
  sourceUrlFilter: desktopTernaryFilterSchema.optional(),
  availabilityFilter: desktopAvailabilityFilterSchema.optional(),
  excludeAvailabilityFilter: z.boolean().optional(),
  widthRange: desktopNumericRangeInputSchema.nullable().optional(),
  heightRange: desktopNumericRangeInputSchema.nullable().optional(),
  aspectRatioRange: desktopNumericRangeInputSchema.nullable().optional(),
  longEdgeRange: desktopNumericRangeInputSchema.nullable().optional(),
  durationRange: desktopNumericRangeInputSchema.nullable().optional(),
});
export type DesktopDiscoveryFilterPatch = z.infer<typeof desktopDiscoveryFilterPatchSchema>;

export const EMPTY_DESKTOP_NUMERIC_RANGE: DesktopNumericRangeState = {
  min: '',
  max: '',
  exclude: false,
};

export const EMPTY_DESKTOP_DISCOVERY_FILTERS: DesktopDiscoveryFilterFields = {
  formatFilter: '',
  excludeFormatFilter: false,
  tagFilter: '',
  excludeTagFilter: false,
  tagFilterMatch: 'any',
  ratingFilter: '',
  excludeRatingFilter: false,
  favoriteFilter: 'any',
  sourceUrlFilter: 'any',
  availabilityFilter: 'any',
  excludeAvailabilityFilter: false,
  widthRange: EMPTY_DESKTOP_NUMERIC_RANGE,
  heightRange: EMPTY_DESKTOP_NUMERIC_RANGE,
  aspectRatioRange: EMPTY_DESKTOP_NUMERIC_RANGE,
  longEdgeRange: EMPTY_DESKTOP_NUMERIC_RANGE,
  durationRange: EMPTY_DESKTOP_NUMERIC_RANGE,
};

function normalizeCsv(value: string | null | undefined, previous: string): string {
  if (value === undefined) return previous;
  if (value === null) return '';
  return value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => nonBlankCsvToken.parse(token))
    .join(',');
}

function applyRange(
  input: DesktopNumericRangeInput | null | undefined,
  previous: DesktopNumericRangeState,
): DesktopNumericRangeState {
  if (input === undefined) return previous;
  if (input === null) return { ...EMPTY_DESKTOP_NUMERIC_RANGE };
  return {
    min: input.min === undefined ? previous.min : input.min ?? '',
    max: input.max === undefined ? previous.max : input.max ?? '',
    exclude: input.exclude ?? previous.exclude,
  };
}

/**
 * Apply a partial Attached MCP discovery filter patch onto the current Desktop
 * filter snapshot. `null` clears a field; omitted keys keep the previous value.
 */
export function applyDesktopDiscoveryFilterPatch(
  current: DesktopDiscoveryFilterFields,
  patch: DesktopDiscoveryFilterPatch,
): DesktopDiscoveryFilterFields {
  return {
    formatFilter: normalizeCsv(patch.formatFilter, current.formatFilter),
    excludeFormatFilter: patch.excludeFormatFilter ?? current.excludeFormatFilter,
    tagFilter: normalizeCsv(patch.tagFilter, current.tagFilter),
    excludeTagFilter: patch.excludeTagFilter ?? current.excludeTagFilter,
    tagFilterMatch: patch.tagFilterMatch ?? current.tagFilterMatch,
    ratingFilter: normalizeCsv(patch.ratingFilter, current.ratingFilter),
    excludeRatingFilter: patch.excludeRatingFilter ?? current.excludeRatingFilter,
    favoriteFilter: patch.favoriteFilter ?? current.favoriteFilter,
    sourceUrlFilter: patch.sourceUrlFilter ?? current.sourceUrlFilter,
    availabilityFilter: patch.availabilityFilter ?? current.availabilityFilter,
    excludeAvailabilityFilter:
      patch.excludeAvailabilityFilter ?? current.excludeAvailabilityFilter,
    widthRange: applyRange(patch.widthRange, current.widthRange),
    heightRange: applyRange(patch.heightRange, current.heightRange),
    aspectRatioRange: applyRange(patch.aspectRatioRange, current.aspectRatioRange),
    longEdgeRange: applyRange(patch.longEdgeRange, current.longEdgeRange),
    durationRange: applyRange(patch.durationRange, current.durationRange),
  };
}

export const desktopViewerNavigateDirectionSchema = z.enum(['previous', 'next']);
export type DesktopViewerNavigateDirection = z.infer<
  typeof desktopViewerNavigateDirectionSchema
>;

export type DesktopViewerNeighborResolution =
  | { status: 'ok'; assetId: string }
  | { status: 'viewer-closed' }
  | { status: 'boundary' };

/**
 * Resolve the previous/next viewer neighbor from the current visible asset list.
 * Index -1 (viewer asset not in the list) is treated as a closed/unavailable viewer.
 */
export function resolveDesktopViewerNeighbor(input: {
  direction: DesktopViewerNavigateDirection;
  viewerAssetId: string | null;
  visibleAssetIds: readonly string[];
}): DesktopViewerNeighborResolution {
  if (input.viewerAssetId === null) {
    return { status: 'viewer-closed' };
  }
  const index = input.visibleAssetIds.indexOf(input.viewerAssetId);
  if (index < 0) {
    return { status: 'viewer-closed' };
  }
  const nextIndex = input.direction === 'previous' ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= input.visibleAssetIds.length) {
    return { status: 'boundary' };
  }
  return {
    status: 'ok',
    assetId: input.visibleAssetIds[nextIndex]!,
  };
}
