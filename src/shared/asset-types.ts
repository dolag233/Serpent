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
  /** Direct (non-recursive) managed assets in this folder. Interim FOLDER-003. */
  directAssetCount: z.number().int().nonnegative(),
  /** Immediate child managed folders. */
  childFolderCount: z.number().int().nonnegative(),
});

export type ManagedFolderSummary = z.infer<typeof managedFolderSummarySchema>;

/**
 * Mixed browse canvas entry for a direct child folder (REQ-FOLDER-001/002/003).
 * Covers and counts are batched by the Worker — Renderer never N+1 queries.
 */
export const folderBrowseEntrySchema = z.strictObject({
  folderId: nonBlankString,
  parentFolderId: nonBlankString.nullable(),
  locationKind: z.literal('managed'),
  name: nonBlankString,
  relativePath: portableRelativePathSchema,
  status: z.literal('available'),
  /** Direct-child assets only (covers / layout helpers). */
  directAssetCount: z.number().int().nonnegative(),
  /** All descendant assets (REQ-FOLDER-003 / Serpent-toh). */
  recursiveAssetCount: z.number().int().nonnegative(),
  childFolderCount: z.number().int().nonnegative(),
  /** Up to 3 ready thumbnail/poster artifact ids for the folder cover deck. */
  coverArtifactIds: z.array(nonBlankString).max(3),
});

export type FolderBrowseEntry = z.infer<typeof folderBrowseEntrySchema>;

export const trashedFolderSummarySchema = z.strictObject({
  tombstoneId: nonBlankString,
  /** Original managed folder id before trash removed the row. */
  folderId: nonBlankString,
  relativePath: portableRelativePathSchema,
  name: nonBlankString,
  parentRelativePath: portableRelativePathSchema.nullable(),
  trashedAt: nonBlankString,
  assetCount: z.number().int().nonnegative(),
  /** Up to three ready thumbnail/poster artifact ids for folder cards. */
  coverArtifactIds: z.array(nonBlankString).max(3),
});

export type TrashedFolderSummary = z.infer<typeof trashedFolderSummarySchema>;

export const linkedFolderSummarySchema = z.strictObject({
  folderId: nonBlankString,
  displayName: nonBlankString,
  status: z.enum(['available', 'offline']),
  assetCount: z.number().int().nonnegative(),
  /** Absolute linked root for hover affordance (Serpent-rc9). */
  absoluteRootPath: z.string().min(1).max(4096),
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

export const ignoredPathSchema = z.strictObject({
  locationKind: z.enum(['managed', 'linked']),
  linkedFolderId: nonBlankString.nullable(),
  relativePath: z.string().max(4096),
  pathKind: z.enum(['asset', 'folder', 'extension']),
  displayName: nonBlankString,
  ignoredAt: nonBlankString,
});

export type IgnoredPath = z.infer<typeof ignoredPathSchema>;

export const imageSequenceFrameSummarySchema = z.strictObject({
  assetId: nonBlankString,
  displayName: nonBlankString,
  relativeFilePath: portableRelativePathSchema,
  currentRevisionId: nonBlankString,
  frameNumber: z.number().int().nonnegative(),
  thumbnailArtifactId: nonBlankString.nullable(),
});

export const imageSequenceSummarySchema = z.strictObject({
  sequenceId: nonBlankString,
  fps: z.number().min(1).max(240),
  frameCount: z.number().int().min(3),
  frames: z.array(imageSequenceFrameSummarySchema).min(3),
});

export type ImageSequenceSummary = z.infer<typeof imageSequenceSummarySchema>;

export const assetSummarySchema = z.strictObject({
  assetId: nonBlankString,
  locationKind: z.enum(['managed', 'linked']),
  managedFolderId: nonBlankString.nullable(),
  linkedFolderId: nonBlankString.nullable().optional(),
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
  /** Tombstone that owned this asset when its folder was trashed (Serpent-whvm). */
  trashedFromTombstoneId: nonBlankString.nullable().optional().default(null),
  remainingDays: z.number().int().nullable(),
  thumbnailStatus: z.enum(['ready', 'pending', 'failed']).nullable(),
  thumbnailArtifactId: nonBlankString.nullable(),
  mediaType: z.enum(['image', 'video', 'audio', 'text', 'other']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  durationMs: z.number().int().nonnegative().nullable().optional().default(null),
  sequence: imageSequenceSummarySchema.nullable().optional(),
});

export type AssetSummary = z.infer<typeof assetSummarySchema>;

export const tagSummarySchema = z.strictObject({
  tagId: nonBlankString,
  name: nonBlankString,
  assetCount: z.number().int().nonnegative(),
});

export type TagSummary = z.infer<typeof tagSummarySchema>;

export const tagCooccurrenceNodeSchema = z.strictObject({
  tagId: nonBlankString,
  name: nonBlankString,
  assetCount: z.number().int().nonnegative(),
});

export type TagCooccurrenceNode = z.infer<typeof tagCooccurrenceNodeSchema>;

export const tagCooccurrenceEdgeSchema = z.strictObject({
  sourceTagId: nonBlankString,
  targetTagId: nonBlankString,
  weight: z.number().int().positive(),
});

export type TagCooccurrenceEdge = z.infer<typeof tagCooccurrenceEdgeSchema>;

export const tagCooccurrenceGraphSchema = z.strictObject({
  nodes: z.array(tagCooccurrenceNodeSchema),
  edges: z.array(tagCooccurrenceEdgeSchema),
  truncated: z.boolean(),
});

export type TagCooccurrenceGraph = z.infer<typeof tagCooccurrenceGraphSchema>;

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
  // Author/creator (Serpent-7x0): user-editable, auto-extracted from
  // EXIF/IPTC/XMP on first thumbnail generation when left empty.
  author: nonBlankString.nullable(),
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

/**
 * Technical fields from the `extracted_metadata` revision artifact (ffprobe JSON).
 * Kept off AssetSummary so list/search payloads stay lean (REQ-VIEW-003).
 *
 * `framerate` is the raw ffprobe ratio string (e.g. "30000/1001").
 * Bitrate / sampleRate may be numeric or string depending on probe output.
 * `containerBitrate` / `frameRateFps` are optional forward-compatible fields.
 */
const probeNumericSchema = z.union([z.number().finite(), z.string()]).nullable();

export const extractedVideoMetadataSchema = z.strictObject({
  container: z.string().nullable().optional().default(null),
  durationMs: z.number().finite().nonnegative().optional(),
  width: z.number().finite().nonnegative().optional(),
  height: z.number().finite().nonnegative().optional(),
  framerate: z.string().nullable().optional().default(null),
  rotation: z.number().finite().optional(),
  videoCodec: z.string().nullable().optional().default(null),
  videoBitrate: probeNumericSchema.optional().default(null),
  pixelFormat: z.string().nullable().optional().default(null),
  hasAudio: z.boolean().optional().default(false),
  audioCodec: z.string().nullable().optional().default(null),
  /** Audio-stream bit_rate when present (audio assets / video A/V). */
  audioBitrate: probeNumericSchema.optional().default(null),
  sampleRate: probeNumericSchema.optional().default(null),
  channels: z.number().int().positive().nullable().optional().default(null),
  containerBitrate: probeNumericSchema.optional(),
  frameRateFps: z.number().finite().positive().nullable().optional(),
  /** Animated GIF / multi-page still count when extracted via sharp. */
  frameCount: z.number().int().nonnegative().nullable().optional(),
});

export type ExtractedVideoMetadata = z.infer<typeof extractedVideoMetadataSchema>;

export const extractedMetadataResultSchema = z.strictObject({
  assetId: nonBlankString,
  status: z.enum(['ready', 'pending', 'failed', 'missing']),
  metadata: extractedVideoMetadataSchema.nullable(),
  errorCode: z.string().nullable().optional().default(null),
});

export type ExtractedMetadataResult = z.infer<typeof extractedMetadataResultSchema>;

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
    'author',
  ]),
  order: z.enum(['asc', 'desc']),
});

export type SortDefinition = z.infer<typeof sortDefinitionSchema>;

const categoricalFilterClauseSchema = z.strictObject({
  field: z.enum([
    'format',
    'tag',
    'rating',
    'favorite',
    'source_url',
    'availability',
    'color',
  ]),
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
    // A smart collection is a stored query, not a materialized asset list.
    // Search resolves the saved definition in the Worker and ANDs the live
    // user query/filter state with it so the current browse scope is retained.
    kind: z.literal('smart_collection'),
    collectionId: nonBlankString,
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
    'author',
    'folder_path',
    'metadata_text',
  ]).nullable(),
  values: z.array(boundedSearchValue).min(1).max(32),
  exclude: z.boolean(),
});

export type SearchClause = z.infer<typeof searchClauseSchema>;

const searchQueryDefinitionSchema = z.strictObject({
  /**
   * A backwards-compatible conjunction used by saved searches created before
   * contextual `|` alternatives existed. When `groups` is absent, every
   * clause here must match.
   */
  clauses: z.array(searchClauseSchema).max(32),
  /**
   * A disjunction of conjunctions: each inner group is ANDed and the groups
   * are ORed. This keeps `name:hero tag:y2k | author:Jane` structured across
   * renderer, preload, main and worker without passing a query string over
   * the process boundary.
   */
  groups: z.array(z.array(searchClauseSchema).min(1).max(32)).min(1).max(32).optional(),
}).superRefine((query, context) => {
  if (query.groups !== undefined && query.clauses.length > 0) {
    context.addIssue({
      code: 'custom',
      message: 'A search query must use either legacy clauses or contextual groups, not both.',
      path: ['groups'],
    });
  }
}).nullable();

export const searchQuerySchema = searchQueryDefinitionSchema;

export type SearchQuery = Exclude<z.infer<typeof searchQuerySchema>, null>;

export const smartCollectionQueryDefinitionSchema = z.strictObject({
  search: searchQueryDefinitionSchema.unwrap().optional(),
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
  /** Live match count for the saved query (CU-M6); computed via search total. */
  assetCount: z.number().int().nonnegative(),
});

export type SmartCollectionSummary = z.infer<typeof smartCollectionSummarySchema>;
