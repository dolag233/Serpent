import { z } from 'zod';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0);
const boundedSearchValue = nonBlankString.max(512);

export const managedFolderSummarySchema = z.strictObject({
  folderId: nonBlankString,
  parentFolderId: nonBlankString.nullable(),
  name: nonBlankString,
  relativePath: nonBlankString,
});

export type ManagedFolderSummary = z.infer<typeof managedFolderSummarySchema>;

export const linkedFolderSummarySchema = z.strictObject({
  folderId: nonBlankString,
  displayName: nonBlankString,
  status: z.enum(['available', 'offline']),
  assetCount: z.number().int().nonnegative(),
});

export type LinkedFolderSummary = z.infer<typeof linkedFolderSummarySchema>;

export const assetSummarySchema = z.strictObject({
  assetId: nonBlankString,
  locationKind: z.enum(['managed', 'linked']),
  managedFolderId: nonBlankString.nullable(),
  relativeFilePath: nonBlankString,
  displayName: nonBlankString,
  currentRevisionId: nonBlankString,
  byteSize: z.number().int().nonnegative(),
  modifiedAt: nonBlankString,
  availability: z.enum(['available', 'missing']),
  label: nonBlankString.nullable(),
  rating: z.number().int().min(0).max(5),
  favorite: z.boolean(),
  deletedAt: nonBlankString.nullable(),
  trashedFromPath: nonBlankString.nullable(),
  remainingDays: z.number().int().nullable(),
  thumbnailStatus: z.enum(['ready', 'pending', 'failed']).nullable(),
  thumbnailArtifactId: nonBlankString.nullable(),
  mediaType: z.enum(['image', 'video', 'other']),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
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
  label: nonBlankString.nullable(),
  description: nonBlankString.nullable(),
  rating: z.number().int().min(0).max(5),
  favorite: z.boolean(),
  palette: nonBlankString.nullable(),
  sourcePageUrl: nonBlankString.nullable(),
  // Assets created before metadata is first written use version 0 as the
  // optimistic-lock token; the first successful set creates version 1.
  entityVersion: z.number().int().min(0),
  updatedAt: nonBlankString,
});

export type AssetMetadataResult = z.infer<typeof assetMetadataResultSchema>;

export const sortDefinitionSchema = z.strictObject({
  field: z.enum(['name', 'modified_at', 'created_at', 'byte_size', 'duration', 'rating']),
  order: z.enum(['asc', 'desc']),
});

export type SortDefinition = z.infer<typeof sortDefinitionSchema>;

export const filterClauseSchema = z.strictObject({
  field: z.enum(['format', 'tag', 'rating', 'favorite', 'source_url', 'availability']),
  values: z.array(boundedSearchValue).max(32),
  exclude: z.boolean(),
});

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
]);

export type SearchScope = z.infer<typeof searchScopeSchema>;

export const searchClauseSchema = z.strictObject({
  field: boundedSearchValue.nullable(),
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

export const smartCollectionSummarySchema = z.strictObject({
  collectionId: nonBlankString,
  name: nonBlankString,
  queryDefinition: nonBlankString,
  position: z.number().int().nonnegative(),
});

export type SmartCollectionSummary = z.infer<typeof smartCollectionSummarySchema>;
