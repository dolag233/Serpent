import { z } from 'zod';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0);
const boundedSearchValue = nonBlankString.max(512);

/**
 * Canonical path form that is safe to expose across the Renderer boundary.
 *
 * Serpent persists relative paths with POSIX separators on every platform.
 * Rejecting absolute, drive-qualified, backslash-separated, empty, and dot
 * segments keeps a parsed value relative without relying on the host OS path
 * implementation.
 */
export const portableRelativePathSchema = nonBlankString.superRefine((value, context) => {
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value)) {
    context.addIssue({ code: 'custom', message: 'Path must be relative.' });
  }
  if (value.includes('\\')) {
    context.addIssue({ code: 'custom', message: 'Path must use POSIX separators.' });
  }
  if (value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    context.addIssue({ code: 'custom', message: 'Path must contain only canonical relative segments.' });
  }
});

export const managedFolderSummarySchema = z.strictObject({
  folderId: nonBlankString,
  parentFolderId: nonBlankString.nullable(),
  name: nonBlankString,
  relativePath: portableRelativePathSchema,
});

export type ManagedFolderSummary = z.infer<typeof managedFolderSummarySchema>;

export const linkedFolderSummarySchema = z.strictObject({
  folderId: nonBlankString,
  displayName: nonBlankString,
  status: z.enum(['available', 'offline']),
  assetCount: z.number().int().nonnegative(),
});

export type LinkedFolderSummary = z.infer<typeof linkedFolderSummarySchema>;

export const linkedFolderRuleSchema = z.strictObject({
  ruleId: nonBlankString,
  action: z.enum(['include', 'exclude']),
  target: z.enum(['path', 'filename', 'extension', 'folder']),
  pattern: nonBlankString.max(512),
  enabled: z.boolean(),
});

export type LinkedFolderRule = z.infer<typeof linkedFolderRuleSchema>;

export const assetSummarySchema = z.strictObject({
  assetId: nonBlankString,
  locationKind: z.enum(['managed', 'linked']),
  managedFolderId: nonBlankString.nullable(),
  relativeFilePath: portableRelativePathSchema,
  displayName: nonBlankString,
  currentRevisionId: nonBlankString,
  byteSize: z.number().int().nonnegative(),
  modifiedAt: nonBlankString,
  availability: z.enum(['available', 'missing']),
  rating: z.number().int().min(0).max(5),
  favorite: z.boolean(),
  deletedAt: nonBlankString.nullable(),
  trashedFromPath: portableRelativePathSchema.nullable(),
  remainingDays: z.number().int().nullable(),
  thumbnailStatus: z.enum(['ready', 'pending', 'failed']).nullable(),
  thumbnailArtifactId: nonBlankString.nullable(),
  mediaType: z.enum(['image', 'video', 'other']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable().optional().default(null),
});

export type AssetSummary = z.infer<typeof assetSummarySchema>;

export const tagSummarySchema = z.strictObject({
  tagId: nonBlankString,
  name: nonBlankString,
  assetCount: z.number().int().nonnegative(),
});

export type TagSummary = z.infer<typeof tagSummarySchema>;

export const collectionSummarySchema = z.strictObject({
  collectionId: nonBlankString,
  parentId: nonBlankString.nullable(),
  name: nonBlankString,
  description: nonBlankString.nullable(),
  coverAssetId: nonBlankString.nullable(),
  position: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  childCollectionCount: z.number().int().nonnegative(),
});

export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

export const assetMetadataResultSchema = z.strictObject({
  assetId: nonBlankString,
  description: nonBlankString.nullable(),
  rating: z.number().int().min(0).max(5),
  favorite: z.boolean(),
  palette: nonBlankString.nullable(),
  automaticPalette: z.array(z.strictObject({
    hex: z.string().regex(/^#[0-9A-F]{6}$/u),
    ratio: z.number().min(0).max(1),
  })).max(12).optional().default([]),
  effectivePalette: z.array(nonBlankString).max(20).optional().default([]),
  paletteSource: z.enum(['manual', 'automatic']).nullable().optional().default(null),
  sourcePageUrl: nonBlankString.nullable(),
  // Assets created before metadata is first written use version 0 as the
  // optimistic-lock token; the first successful set creates version 1.
  tags: z.array(z.strictObject({
    id: nonBlankString,
    name: nonBlankString,
    source: z.enum(['user', 'ai']),
  })).optional().default([]),
  entityVersion: z.number().int().min(0),
  updatedAt: nonBlankString,
});

export type AssetMetadataResult = z.infer<typeof assetMetadataResultSchema>;

export const sortDefinitionSchema = z.strictObject({
  field: z.enum([
    'name',
    'modified_at',
    'created_at',
    'byte_size',
    'long_edge',
    'duration',
    'rating',
    'color',
  ]),
  order: z.enum(['asc', 'desc']),
});

export type SortDefinition = z.infer<typeof sortDefinitionSchema>;

const categoricalFilterClauseSchema = z.strictObject({
  field: z.enum(['format', 'tag', 'rating', 'favorite', 'source_url', 'availability']),
  values: z.array(boundedSearchValue).max(32),
  exclude: z.boolean(),
});

const numericRangeSchema = z.strictObject({
  min: z.number().finite().nonnegative().optional(),
  max: z.number().finite().nonnegative().optional(),
}).superRefine((range, context) => {
  if (range.min === undefined && range.max === undefined) {
    context.addIssue({ code: 'custom', message: 'A numeric range requires min or max.' });
  }
  if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
    context.addIssue({ code: 'custom', message: 'Numeric range min cannot exceed max.' });
  }
});

const numericFilterClauseSchema = z.strictObject({
  field: z.enum(['width', 'height', 'aspect_ratio', 'duration_ms', 'long_edge']),
  ranges: z.array(numericRangeSchema).min(1).max(32),
  exclude: z.boolean(),
}).superRefine((filter, context) => {
  if (filter.field === 'aspect_ratio') {
    filter.ranges.forEach((range, index) => {
      if (range.min === 0 || range.max === 0) {
        context.addIssue({
          code: 'custom',
          message: 'Aspect ratio bounds must be greater than zero.',
          path: ['ranges', index],
        });
      }
    });
    return;
  }
  filter.ranges.forEach((range, index) => {
    if ((range.min !== undefined && !Number.isInteger(range.min))
      || (range.max !== undefined && !Number.isInteger(range.max))) {
      context.addIssue({
        code: 'custom',
        message: 'Pixel and duration bounds must be integers.',
        path: ['ranges', index],
      });
    }
  });
});

/**
 * Categorical filters retain the v0.1 `values` shape. Technical metadata uses
 * explicit numeric ranges so callers never encode comparison operators in
 * strings. Multiple ranges in one clause are ORed; separate clauses are ANDed.
 */
export const filterClauseSchema = z.union([
  categoricalFilterClauseSchema,
  numericFilterClauseSchema,
]);

export type FilterClause = z.infer<typeof filterClauseSchema>;

export const searchScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('folder'),
    folderId: nonBlankString.nullable(),
    recursive: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('collection'),
    collectionId: nonBlankString,
    recursive: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('trash'),
  }),
]);

export type SearchScope = z.infer<typeof searchScopeSchema>;

export const searchClauseSchema = z.strictObject({
  field: z.enum([
    'filename',
    'tags',
    'description',
    'source_url',
    'folder_path',
    'metadata_text',
  ]).nullable(),
  values: z.array(boundedSearchValue).min(1).max(32),
  exclude: z.boolean(),
});

export type SearchClause = z.infer<typeof searchClauseSchema>;

export const searchQuerySchema = z.strictObject({
  clauses: z.array(searchClauseSchema).max(32),
}).nullable();

export const smartCollectionQueryDefinitionSchema = z.strictObject({
  search: z.strictObject({ clauses: z.array(searchClauseSchema).max(32) }).optional(),
  filters: z.array(filterClauseSchema).max(16).optional(),
  sort: sortDefinitionSchema.optional(),
});

export type SmartCollectionQueryDefinition = z.infer<typeof smartCollectionQueryDefinitionSchema>;

/**
 * A provider-generated search plan is intentionally limited to values already
 * understood by Serpent's ordinary search engine. It cannot carry SQL,
 * filesystem paths, arbitrary operators, or executable expressions.
 */
export const aiSearchPlanSchema = z.strictObject({
  keywords: z.array(boundedSearchValue).max(16),
  synonyms: z.array(boundedSearchValue).max(16),
  exclusions: z.array(boundedSearchValue).max(16),
  filters: z.array(filterClauseSchema).max(16),
  sort: sortDefinitionSchema.optional(),
}).superRefine((plan, context) => {
  if (plan.keywords.length === 0
    && plan.synonyms.length === 0
    && plan.exclusions.length === 0
    && plan.filters.length === 0
    && plan.sort === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'An AI search plan requires a positive term, filter, or sort.',
    });
  }
});

export type AiSearchPlan = z.infer<typeof aiSearchPlanSchema>;

export const smartCollectionSummarySchema = z.strictObject({
  collectionId: nonBlankString,
  name: nonBlankString,
  queryDefinition: nonBlankString,
  position: z.number().int().nonnegative(),
});

export type SmartCollectionSummary = z.infer<typeof smartCollectionSummarySchema>;
