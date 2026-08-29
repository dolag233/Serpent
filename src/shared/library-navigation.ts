import { z } from 'zod';

import {
  collectionSummarySchema,
  linkedFolderSummarySchema,
  managedFolderSummarySchema,
  smartCollectionSummarySchema,
  tagSummarySchema,
  trashedFolderSummarySchema,
} from './asset-types';

/**
 * One coherent read model for navigation chrome and its count badges. The
 * Worker keys this model by the library change sequence so a navigation
 * cannot mix folder rows from one mutation with collection counts from
 * another.
 */
export const libraryNavigationSummarySchema = z.strictObject({
  libraryId: z.string().min(1),
  changeSequence: z.number().int().nonnegative(),
  allAssetCount: z.number().int().nonnegative(),
  rootAssetCount: z.number().int().nonnegative(),
  trashedAssetCount: z.number().int().nonnegative(),
  folders: z.array(managedFolderSummarySchema),
  linkedFolders: z.array(linkedFolderSummarySchema),
  tags: z.array(tagSummarySchema),
  collections: z.array(collectionSummarySchema),
  smartCollections: z.array(smartCollectionSummarySchema),
  trashedFolders: z.array(trashedFolderSummarySchema),
});

export type LibraryNavigationSummary = z.infer<typeof libraryNavigationSummarySchema>;
