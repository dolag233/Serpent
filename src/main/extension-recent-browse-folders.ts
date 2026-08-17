import { readFileSync, writeFileSync } from 'node:fs';

import { z } from 'zod';

const MAX_RECENT_BROWSED_FOLDERS = 20;

const storeSchema = z.strictObject({
  version: z.literal(1),
  byLibrary: z.record(z.string(), z.array(z.string())),
});

type BrowseFolderStore = z.infer<typeof storeSchema>;

function readStore(filePath: string): BrowseFolderStore {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    const result = storeSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // Missing or corrupt store — start fresh.
  }
  return { version: 1, byLibrary: {} };
}

function writeStore(filePath: string, store: BrowseFolderStore): void {
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

/** Record a managed-folder browse scope for extension save-menu ranking. */
export function recordExtensionBrowseFolder(
  filePath: string,
  libraryId: string,
  folderId: string,
): void {
  if (!libraryId || !folderId) return;
  const store = readStore(filePath);
  const current = store.byLibrary[libraryId] ?? [];
  const without = current.filter((entry) => entry !== folderId);
  store.byLibrary[libraryId] = [folderId, ...without].slice(0, MAX_RECENT_BROWSED_FOLDERS);
  writeStore(filePath, store);
}

export function readExtensionBrowseFolderIds(
  filePath: string,
  libraryId: string,
): string[] {
  if (!libraryId) return [];
  const store = readStore(filePath);
  return store.byLibrary[libraryId] ?? [];
}
