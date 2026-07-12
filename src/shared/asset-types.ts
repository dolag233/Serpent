import { z } from 'zod';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0);

export const managedFolderSummarySchema = z.strictObject({
  folderId: nonBlankString,
  parentFolderId: nonBlankString.nullable(),
  name: nonBlankString,
  relativePath: nonBlankString,
});

export type ManagedFolderSummary = z.infer<typeof managedFolderSummarySchema>;

export const assetSummarySchema = z.strictObject({
  assetId: nonBlankString,
  managedFolderId: nonBlankString.nullable(),
  relativeFilePath: nonBlankString,
  displayName: nonBlankString,
  currentRevisionId: nonBlankString,
  byteSize: z.number().int().nonnegative(),
  modifiedAt: nonBlankString,
  availability: z.enum(['available', 'missing']),
});

export type AssetSummary = z.infer<typeof assetSummarySchema>;
