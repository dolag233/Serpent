export const EXTENSION_ROOT_FOLDER_KEY = '__root__';
export const RECENT_FOLDER_IDS_KEY = 'recentFolderIds';
export const MAX_RECENT_FOLDERS = 20;

/** 右键/轮盘每一级最多展示的条目数（含导航项时由轮盘逻辑另行扣减）。 */
export const MAX_ITEMS_PER_MENU_LEVEL = 8;

/** 顶栏留给「根目录」父菜单 1 格，其余给快捷文件夹。 */
export const MAX_TOP_LEVEL_FOLDER_SLOTS = MAX_ITEMS_PER_MENU_LEVEL - 1;

export type ExtensionFolderOption = {
  readonly folderId: string;
  readonly name: string;
  readonly relativePath: string;
  readonly assetCount?: number;
};

export type SaveMenuFolderHints = {
  readonly savedRecentIds: readonly string[];
  readonly browsedRecentIds: readonly string[];
};

export type SaveMenuFolderSplit = {
  /** 「保存到 Serpent」下直接展示的文件夹（最多 7 个）。 */
  readonly topLevel: ExtensionFolderOption[];
  /** 「根目录」子菜单内的文件夹（其余全部）。 */
  readonly underRoot: ExtensionFolderOption[];
};

export function folderMenuId(folderId: string): string {
  return `serpent-save-folder:${folderId}`;
}

/** 「根目录」父菜单（子项含「保存至此」+ 其余文件夹）。 */
export const MENU_ROOT_PARENT_ID = 'serpent-save-root-parent';

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

export function filterSavedRecentFolderIds(
  recentFolderIds: readonly string[],
  validFolderIds: ReadonlySet<string>,
): string[] {
  return recentFolderIds.filter(
    (folderId) =>
      folderId !== EXTENSION_ROOT_FOLDER_KEY && validFolderIds.has(folderId),
  );
}

/** 三档合并：最近保存 → 最近浏览 → 其余按资产数降序。 */
export function sortFoldersForSaveMenu(
  folders: readonly ExtensionFolderOption[],
  hints: SaveMenuFolderHints,
): ExtensionFolderOption[] {
  const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
  const seen = new Set<string>();
  const ordered: ExtensionFolderOption[] = [];

  const push = (folderId: string) => {
    if (seen.has(folderId)) return;
    const folder = byId.get(folderId);
    if (!folder) return;
    seen.add(folderId);
    ordered.push(folder);
  };

  for (const folderId of hints.savedRecentIds) push(folderId);
  for (const folderId of hints.browsedRecentIds) push(folderId);

  const rest = folders
    .filter((folder) => !seen.has(folder.folderId))
    .sort((left, right) => {
      const countDiff = (right.assetCount ?? 0) - (left.assetCount ?? 0);
      if (countDiff !== 0) return countDiff;
      return folderMenuLabel(left).localeCompare(folderMenuLabel(right), 'zh-CN');
    });

  return [...ordered, ...rest];
}

/**
 * 拆分顶栏与「根目录」子菜单：顶栏最多 {@link MAX_TOP_LEVEL_FOLDER_SLOTS} 个文件夹，
 * 其余进入根目录下一级。
 */
export function splitSaveMenuFolders(
  folders: readonly ExtensionFolderOption[],
  hints: SaveMenuFolderHints,
): SaveMenuFolderSplit {
  const sorted = sortFoldersForSaveMenu(folders, hints);
  return {
    topLevel: sorted.slice(0, MAX_TOP_LEVEL_FOLDER_SLOTS),
    underRoot: sorted.slice(MAX_TOP_LEVEL_FOLDER_SLOTS),
  };
}

/** @deprecated Use {@link splitSaveMenuFolders}. */
export function pickFirstLevelSaveFolders(
  folders: readonly ExtensionFolderOption[],
  hints: SaveMenuFolderHints,
): ExtensionFolderOption[] {
  return splitSaveMenuFolders(folders, hints).topLevel;
}

export function buildSaveMenuFolderHints(
  folders: readonly ExtensionFolderOption[],
  recentFolderIds: readonly string[],
  browsedRecentIds: readonly string[],
): SaveMenuFolderHints {
  const validFolderIds = new Set(folders.map((folder) => folder.folderId));
  return {
    savedRecentIds: filterSavedRecentFolderIds(recentFolderIds, validFolderIds),
    browsedRecentIds: browsedRecentIds.filter((folderId) => validFolderIds.has(folderId)),
  };
}

/** @deprecated Use {@link sortFoldersForSaveMenu}. */
export function sortFoldersForMenu(
  folders: readonly ExtensionFolderOption[],
  recentFolderIds: readonly string[],
): ExtensionFolderOption[] {
  const validFolderIds = new Set(folders.map((folder) => folder.folderId));
  return sortFoldersForSaveMenu(folders, {
    savedRecentIds: filterSavedRecentFolderIds(recentFolderIds, validFolderIds),
    browsedRecentIds: [],
  });
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
