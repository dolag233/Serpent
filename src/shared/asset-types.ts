import { z } from 'zod';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0);

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
  entityVersion: z.number().int().min(1),
  updatedAt: nonBlankString,
});

export type AssetMetadataResult = z.infer<typeof assetMetadataResultSchema>;

export const smartCollectionSummarySchema = z.strictObject({
  smartCollectionId: nonBlankString,
  name: nonBlankString,
  queryDefinition: nonBlankString,
  sortDefinition: nonBlankString,
});

export type SmartCollectionSummary = z.infer<typeof smartCollectionSummarySchema>;
