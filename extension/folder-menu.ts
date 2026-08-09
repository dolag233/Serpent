import {
  buildFolderTree,
  pickTreeRecentFolderIds,
  type FolderNode,
} from './radial-menu-model';

export const EXTENSION_ROOT_FOLDER_KEY = '__root__';
export const RECENT_FOLDER_IDS_KEY = 'recentFolderIds';
export const MAX_RECENT_FOLDERS = 20;

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

/** 右键保存菜单的文件夹树节点；folderId 为 null 表示纯容器（仅用于展开子级）。 */
export type SaveMenuTreeFolder = {
  readonly folderId: string | null;
  name: string;
  readonly path: string;
  readonly children: SaveMenuTreeFolder[];
};

export type SaveMenuTreeItem =
  | { readonly kind: 'separator' }
  | { readonly kind: 'folder'; readonly folder: SaveMenuTreeFolder };

export function folderMenuId(folderId: string): string {
  return `serpent-save-folder:${folderId}`;
}

/** 「根目录」父菜单（子项「保存至此」= 保存到库根）。 */
export const MENU_ROOT_PARENT_ID = 'serpent-save-root-parent';

export function parseFolderMenuId(
  menuItemId: string | number,
): string | null | undefined {
  if (menuItemId === 'serpent-save-root') return null;
  if (typeof menuItemId !== 'string') return undefined;
  if (menuItemId.startsWith('serpent-save-folder-path:')) {
    // 纯容器节点（仅用于展开子级，自身不可保存）
    return undefined;
  }
  if (menuItemId.startsWith('serpent-save-here:')) {
    return menuItemId.slice('serpent-save-here:'.length);
  }
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

/** 纯容器节点（无自己文件夹记录）的唯一菜单 id。 */
export function folderMenuPathId(path: string): string {
  return `serpent-save-folder-path:${path}`;
}

/** 有子文件夹的文件夹子菜单第一行的「保存到此文件夹」id。 */
export function saveHereMenuId(folderId: string): string {
  return `serpent-save-here:${folderId}`;
}

/** 文件夹节点的菜单 id：优先 folderId，退化为路径 id。 */
export function folderMenuItemId(folder: SaveMenuTreeFolder): string {
  return folder.folderId !== null
    ? folderMenuId(folder.folderId)
    : folderMenuPathId(folder.path);
}

function folderNodeToTreeFolder(node: FolderNode): SaveMenuTreeFolder {
  return {
    folderId: node.folderId,
    name: node.name,
    path: node.path,
    children: node.children.map(folderNodeToTreeFolder),
  };
}

/** 同级重名时展开为完整路径消歧（与拖拽树一致）。 */
function disambiguateLevel(folders: SaveMenuTreeFolder[]): void {
  const counts = new Map<string, number>();
  for (const folder of folders) {
    counts.set(folder.name, (counts.get(folder.name) ?? 0) + 1);
  }
  for (const folder of folders) {
    if ((counts.get(folder.name) ?? 0) > 1) {
      folder.name = folder.path.split('/').join(' / ');
    }
    disambiguateLevel(folder.children);
  }
}

/**
 * 构建右键保存菜单树，与拖拽树（radial-menu-model.itemsForLevel 根级）一致：
 * 最近保存 → 最近浏览 → 分割线 → 所有一级目录；有子文件夹的目录递归展开下一级。
 */
export function buildSaveMenuTree(
  folders: readonly ExtensionFolderOption[],
  hints: SaveMenuFolderHints,
): SaveMenuTreeItem[] {
  const tree = buildFolderTree(folders);

  const recentIds = pickTreeRecentFolderIds(
    hints.savedRecentIds,
    hints.browsedRecentIds,
  );
  const recentPaths = new Set<string>();
  const recent: SaveMenuTreeFolder[] = [];
  for (const folderId of recentIds) {
    const node = tree.byId.get(folderId);
    if (!node) continue;
    recentPaths.add(node.path);
    recent.push(folderNodeToTreeFolder(node));
  }
  disambiguateLevel(recent);

  const tops: SaveMenuTreeFolder[] = tree.roots
    .filter((node) => !recentPaths.has(node.path))
    .map(folderNodeToTreeFolder);
  disambiguateLevel(tops);

  const item = (folder: SaveMenuTreeFolder): SaveMenuTreeItem => ({
    kind: 'folder',
    folder,
  });
  if (recent.length === 0) return tops.map(item);
  if (tops.length === 0) return recent.map(item);
  return [...recent.map(item), { kind: 'separator' }, ...tops.map(item)];
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
