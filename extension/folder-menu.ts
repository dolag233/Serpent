export const EXTENSION_ROOT_FOLDER_KEY = '__root__';
export const RECENT_FOLDER_IDS_KEY = 'recentFolderIds';
export const MAX_RECENT_FOLDERS = 20;

export type ExtensionFolderOption = {
  readonly folderId: string;
  readonly name: string;
  readonly relativePath: string;
};

export function folderMenuId(folderId: string): string {
  return `serpent-save-folder:${folderId}`;
}

export function parseFolderMenuId(
  menuItemId: string | number,
): string | null | undefined {
  if (menuItemId === 'serpent-save-root') return null;
  if (typeof menuItemId !== 'string') return undefined;
  if (!menuItemId.startsWith('serpent-save-folder:')) return undefined;
  return menuItemId.slice('serpent-save-folder:'.length);
}

export function folderMenuLabel(folder: ExtensionFolderOption): string {
  return folder.relativePath || folder.name;
}

/**
 * Root is rendered separately. Recent folders keep their save order; the rest
 * are sorted alphabetically by display label.
 */
export function sortFoldersForMenu(
  folders: readonly ExtensionFolderOption[],
  recentFolderIds: readonly string[],
): ExtensionFolderOption[] {
  const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
  const recent = recentFolderIds
    .map((folderId) => byId.get(folderId))
    .filter((folder): folder is ExtensionFolderOption => folder !== undefined);
  const recentSet = new Set(recentFolderIds);
  const rest = folders
    .filter((folder) => !recentSet.has(folder.folderId))
    .sort((left, right) =>
      folderMenuLabel(left).localeCompare(folderMenuLabel(right), 'zh-CN'),
    );
  return [...recent, ...rest];
}

export function normalizeRecentFolderIds(
  recentFolderIds: readonly string[],
  validFolderIds: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const folderId of recentFolderIds) {
    if (!validFolderIds.has(folderId) || seen.has(folderId)) continue;
    seen.add(folderId);
    normalized.push(folderId);
    if (normalized.length >= MAX_RECENT_FOLDERS) break;
  }
  return normalized;
}

export function pushRecentFolderId(
  recentFolderIds: readonly string[],
  folderId: string | null,
  validFolderIds: ReadonlySet<string>,
): string[] {
  const key = folderId ?? EXTENSION_ROOT_FOLDER_KEY;
  const withoutCurrent = recentFolderIds.filter((entry) => entry !== key);
  if (key !== EXTENSION_ROOT_FOLDER_KEY && !validFolderIds.has(key)) {
    return normalizeRecentFolderIds(withoutCurrent, validFolderIds);
  }
  return normalizeRecentFolderIds(
    [key, ...withoutCurrent],
    new Set([...validFolderIds, EXTENSION_ROOT_FOLDER_KEY]),
  );
}
