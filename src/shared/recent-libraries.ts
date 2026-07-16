import { z } from 'zod';

/**
 * One entry of the Main-owned recent libraries store (`recent-library.json`,
 * schema v2). Shared between Main, preload, and renderer for the
 * `library.list-recent.request` / `library.open-recent.request` IPC contract.
 */

const nonBlankString = z.string().min(1);

export const RECENT_LIBRARIES_LIMIT = 8;

export const recentLibraryEntrySchema = z.strictObject({
  path: nonBlankString,
  name: nonBlankString,
  lastOpenedAt: nonBlankString,
});

export type RecentLibraryEntry = z.infer<typeof recentLibraryEntrySchema>;

export const recentLibraryListSchema = z
  .array(recentLibraryEntrySchema)
  .max(RECENT_LIBRARIES_LIMIT);
