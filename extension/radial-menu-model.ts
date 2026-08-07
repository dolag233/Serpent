import type { ExtensionFolderOption } from './folder-menu';

/**
 * Serpent-c0ml / REQ-EXT-005 拖拽思维导图树状保存菜单纯逻辑。
 * 规格：docs/ui/0002-extension-drag-radial-save-menu.md（v7 树状）。
 * 本模块不接触 DOM；命中矩形与层级项生成可单测。渲染在 radial-menu.ts。
 */

/* ================= 布局常量 ================= */

export const TREE_ITEM_HEIGHT = 36;
export const TREE_ITEM_GAP = 6;
export const TREE_DRILL_WIDTH = 32;
export const TREE_BACK_WIDTH = 30;
export const TREE_PARENT_MIN_WIDTH = 148;
export const TREE_LIST_WIDTH = 256;
export const TREE_LIST_MAX_HEIGHT = 320;
export const TREE_PANEL_PAD = 16;
export const TREE_BRIDGE_GAP = 36;
/** 仅列表最上/最下一小条触发边缘滚动（约不到一行高）。 */
export const TREE_EDGE_SCROLL_ZONE = 28;
/** 边缘滚动基础像素/帧；靠边缘略加速，整体偏慢。 */
export const TREE_EDGE_SCROLL_SPEED = 3.75;
export const TREE_VIEWPORT_MARGIN = 20;
export const TREE_SEPARATOR_HEIGHT = 14;
/** › / ‹ 悬停满此时长才进层/返回，避免误触。 */
export const TREE_NAV_DWELL_MS = 500;
/** 根级最近保存快捷项上限。 */
export const TREE_MAX_RECENT_SAVED = 4;
/** 根级最近打开/浏览快捷项上限（不含已计入保存最近的）。 */
export const TREE_MAX_RECENT_BROWSED = 2;

export interface TreeGeometry {
  readonly itemHeight: number;
  readonly itemGap: number;
  readonly drillWidth: number;
  readonly backWidth: number;
  readonly parentMinWidth: number;
  readonly listWidth: number;
  readonly listMaxHeight: number;
  readonly panelPad: number;
  readonly bridgeGap: number;
  readonly edgeScrollZone: number;
  readonly viewportMargin: number;
}

export const DEFAULT_TREE_GEOMETRY: TreeGeometry = {
  itemHeight: TREE_ITEM_HEIGHT,
  itemGap: TREE_ITEM_GAP,
  drillWidth: TREE_DRILL_WIDTH,
  backWidth: TREE_BACK_WIDTH,
  parentMinWidth: TREE_PARENT_MIN_WIDTH,
  listWidth: TREE_LIST_WIDTH,
  listMaxHeight: TREE_LIST_MAX_HEIGHT,
  panelPad: TREE_PANEL_PAD,
  bridgeGap: TREE_BRIDGE_GAP,
  edgeScrollZone: TREE_EDGE_SCROLL_ZONE,
  viewportMargin: TREE_VIEWPORT_MARGIN,
};

/* ================= 文件夹树 ================= */

export interface FolderNode {
  folderId: string | null;
  readonly name: string;
  /** 以 / 分隔的相对路径（与 relativePath 口径一致） */
  readonly path: string;
  readonly children: FolderNode[];
}

export interface FolderTree {
  readonly roots: FolderNode[];
  readonly byId: Map<string, FolderNode>;
}

/** 扁平 relativePath 列表 → 树；每层按名称 zh-CN 排序。空 relativePath 退化为 name。 */
export function buildFolderTree(folders: readonly ExtensionFolderOption[]): FolderTree {
  const roots: FolderNode[] = [];
  const byId = new Map<string, FolderNode>();

  for (const folder of folders) {
    const path = folder.relativePath || folder.name;
    const segments = path.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) continue;

    let siblings = roots;
    let parentPath = '';
    let node: FolderNode | undefined;
    for (const segment of segments) {
      const currentPath = parentPath ? `${parentPath}/${segment}` : segment;
      node = siblings.find((sibling) => sibling.name === segment);
      if (!node) {
        node = { folderId: null, name: segment, path: currentPath, children: [] };
        siblings.push(node);
      }
      siblings = node.children;
      parentPath = currentPath;
    }
    if (node) {
      node.folderId = folder.folderId;
      byId.set(folder.folderId, node);
    }
  }

  const sortLevel = (nodes: FolderNode[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    for (const node of nodes) sortLevel(node.children);
  };
  sortLevel(roots);

  return { roots, byId };
}

export function findFolderNode(
  roots: readonly FolderNode[],
  path: string,
): FolderNode | null {
  let siblings: readonly FolderNode[] = roots;
  let found: FolderNode | null = null;
  for (const segment of path.split('/')) {
    found = siblings.find((node) => node.name === segment) ?? null;
    if (!found) return null;
    siblings = found.children;
  }
  return found;
}

/* ================= 层级与列表项 ================= */

export type TreeLevel =
  | { readonly kind: 'root' }
  | { readonly kind: 'all' }
  | { readonly kind: 'folder'; readonly path: string };

/** @deprecated 兼容旧名；与 TreeLevel 相同 */
export type RadialLevel = TreeLevel;

export type TreeItemNav = 'save';

export type TreeFolderItem = {
  readonly kind: 'folder';
  label: string;
  readonly nav: TreeItemNav;
  readonly path: string;
  readonly folderId: string | null;
  /** 有子级时右侧显示 › 热区，悬停进入下一级 */
  readonly expandable: boolean;
  readonly target?: TreeLevel;
  /** 根级分区：最近项 / 一级文件夹 */
  readonly section?: 'recent' | 'folders';
};

export type TreeSeparatorItem = {
  readonly kind: 'separator';
};

export type TreeItem = TreeFolderItem | TreeSeparatorItem;

/** @deprecated 兼容旧名 */
export type RadialItem = TreeFolderItem;
export type RadialItemNav = TreeItemNav;

export interface TreeMenuContext {
  readonly roots: readonly FolderNode[];
  /** 最近保存 / 最近浏览等快捷文件夹（根级上方区块）。 */
  readonly recentFolders: readonly FolderNode[];
  /** 当前打开的资源库显示名（根级左侧父节点）。 */
  readonly libraryDisplayName: string;
}

/** @deprecated 兼容旧名 */
export type RadialMenuContext = TreeMenuContext;

export interface TreeParentInfo {
  readonly label: string;
  readonly path: string;
  readonly folderId: string | null;
  /** 返回后的目标层级 */
  readonly backTarget: TreeLevel;
  /** 根级库名父节点不显示 ‹ */
  readonly showBack: boolean;
}

const ROOT_FOLDER_PATH = '根目录';

export function isFolderItem(item: TreeItem): item is TreeFolderItem {
  return item.kind === 'folder';
}

function folderItem(
  node: FolderNode,
  section?: 'recent' | 'folders',
): TreeFolderItem {
  const expandable = node.children.length > 0;
  return {
    kind: 'folder',
    label: node.name,
    nav: 'save',
    path: node.path,
    folderId: node.folderId,
    expandable,
    target: expandable ? { kind: 'folder', path: node.path } : undefined,
    ...(section ? { section } : {}),
  };
}

/** 同级重名自动展开为完整路径消歧。 */
export function disambiguateLabels(items: TreeFolderItem[]): TreeFolderItem[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.label) {
      counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
    }
  }
  for (const item of items) {
    if ((counts.get(item.label) ?? 0) > 1 && item.path) {
      item.label = item.path.split('/').join(' / ');
    }
  }
  return items;
}

export function rowHeight(item: TreeItem, geometry: TreeGeometry = DEFAULT_TREE_GEOMETRY): number {
  return item.kind === 'separator' ? TREE_SEPARATOR_HEIGHT : geometry.itemHeight;
}

export function listContentHeight(
  items: readonly TreeItem[],
  geometry: TreeGeometry = DEFAULT_TREE_GEOMETRY,
): number {
  if (items.length === 0) return 0;
  let height = 0;
  for (let i = 0; i < items.length; i += 1) {
    if (i > 0) height += geometry.itemGap;
    height += rowHeight(items[i]!, geometry);
  }
  return height;
}

/**
 * 当前层右侧列表（无限纵向）。根级 = 最近项 + 分割线 + 一级文件夹。
 */
export function itemsForLevel(level: TreeLevel, context: TreeMenuContext): TreeItem[] {
  if (level.kind === 'root') {
    const recentIds = new Set(context.recentFolders.map((node) => node.path));
    const recent = disambiguateLabels(
      context.recentFolders.map((node) => folderItem(node, 'recent')),
    );
    // 一级文件夹排除已出现在最近区块的项，避免重复
    const tops = disambiguateLabels(
      context.roots
        .filter((node) => !recentIds.has(node.path))
        .map((node) => folderItem(node, 'folders')),
    );
    if (recent.length === 0) return tops;
    if (tops.length === 0) return recent;
    return [...recent, { kind: 'separator' }, ...tops];
  }

  if (level.kind === 'all') {
    return disambiguateLabels(context.roots.map((node) => folderItem(node, 'folders')));
  }

  const node = findFolderNode(context.roots, level.path);
  const children = node?.children ?? [];
  return disambiguateLabels(children.map((child) => folderItem(child)));
}

/** 左侧父级 pill；根级为资源库名（无返回）。 */
export function parentInfoForLevel(
  level: TreeLevel,
  context: TreeMenuContext,
): TreeParentInfo {
  if (level.kind === 'root') {
    return {
      label: context.libraryDisplayName || 'Serpent',
      path: ROOT_FOLDER_PATH,
      folderId: null,
      backTarget: { kind: 'root' },
      showBack: false,
    };
  }
  if (level.kind === 'all') {
    return {
      label: context.libraryDisplayName || 'Serpent',
      path: ROOT_FOLDER_PATH,
      folderId: null,
      backTarget: { kind: 'root' },
      showBack: true,
    };
  }
  const node = findFolderNode(context.roots, level.path);
  const segments = level.path.split('/');
  const parentPath = segments.slice(0, -1).join('/');
  const backTarget: TreeLevel =
    parentPath.length === 0 ? { kind: 'root' } : { kind: 'folder', path: parentPath };
  return {
    label: node?.name ?? segments[segments.length - 1] ?? level.path,
    path: level.path,
    folderId: node?.folderId ?? null,
    backTarget,
    showBack: true,
  };
}

export function armedHint(
  hit: TreeHit | null | undefined,
  items: readonly TreeItem[],
  parent: TreeParentInfo | null,
): string | null {
  if (!hit || hit.zone === 'none' || hit.zone === 'cancel') return null;
  if (hit.zone === 'back') return '返回上一级';
  if (hit.zone === 'parent' && parent) {
    if (parent.folderId === null && parent.path === ROOT_FOLDER_PATH) {
      return `保存到：${parent.label}（根目录）`;
    }
    return `保存到：${parent.path.split('/').join(' / ')}`;
  }
  if (hit.zone === 'drill' && hit.index >= 0) {
    const item = items[hit.index];
    return item && isFolderItem(item) ? `进入：${item.label}` : null;
  }
  if (hit.zone === 'item' && hit.index >= 0) {
    const item = items[hit.index];
    return item && isFolderItem(item)
      ? `保存到：${item.path.split('/').join(' / ')}`
      : null;
  }
  return null;
}

export function crumbForLevel(level: TreeLevel, libraryDisplayName?: string): string {
  if (level.kind === 'root') {
    return libraryDisplayName ? `保存到 ${libraryDisplayName}` : '保存到 Serpent';
  }
  if (level.kind === 'all') return libraryDisplayName ?? '根目录';
  return `根目录 / ${level.path.split('/').join(' / ')}`;
}

/* ================= 布局与命中 ================= */

export type TreeHitZone = 'none' | 'cancel' | 'back' | 'parent' | 'item' | 'drill';

export interface TreeHit {
  readonly zone: TreeHitZone;
  readonly index: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TreePanelLayout {
  readonly panel: Rect;
  readonly parentPill: Rect | null;
  readonly backHot: Rect | null;
  readonly parentBody: Rect | null;
  readonly listViewport: Rect;
  readonly contentHeight: number;
  readonly maxScroll: number;
}

export function measureTreePanel(
  originX: number,
  originY: number,
  items: readonly TreeItem[],
  parent: TreeParentInfo | null,
  viewportWidth: number,
  viewportHeight: number,
  geometry: TreeGeometry = DEFAULT_TREE_GEOMETRY,
): TreePanelLayout {
  const hasParent = parent !== null;
  const contentHeight = listContentHeight(items, geometry);
  const listHeight = Math.min(
    geometry.listMaxHeight,
    Math.max(geometry.itemHeight, contentHeight || geometry.itemHeight),
  );
  const parentBlockWidth = hasParent
    ? geometry.parentMinWidth + geometry.bridgeGap
    : 0;
  const panelW =
    geometry.panelPad * 2 + parentBlockWidth + geometry.listWidth;
  const panelH = geometry.panelPad * 2 + Math.max(listHeight, hasParent ? geometry.itemHeight : 0);

  let left = originX - (hasParent ? parentBlockWidth + geometry.listWidth / 2 : geometry.listWidth / 2);
  let top = originY - panelH / 2;
  const margin = geometry.viewportMargin;
  left = Math.min(Math.max(left, margin), Math.max(margin, viewportWidth - panelW - margin));
  top = Math.min(Math.max(top, margin), Math.max(margin, viewportHeight - panelH - margin));

  const panel: Rect = { x: left, y: top, w: panelW, h: panelH };
  let parentPill: Rect | null = null;
  let backHot: Rect | null = null;
  let parentBody: Rect | null = null;
  let listX = left + geometry.panelPad;

  if (hasParent && parent) {
    const pillY = top + geometry.panelPad + Math.max(0, (listHeight - geometry.itemHeight) / 2);
    parentPill = {
      x: left + geometry.panelPad,
      y: pillY,
      w: geometry.parentMinWidth,
      h: geometry.itemHeight,
    };
    if (parent.showBack) {
      backHot = {
        x: parentPill.x,
        y: parentPill.y,
        w: geometry.backWidth,
        h: parentPill.h,
      };
      parentBody = {
        x: parentPill.x + geometry.backWidth,
        y: parentPill.y,
        w: parentPill.w - geometry.backWidth,
        h: parentPill.h,
      };
    } else {
      parentBody = { ...parentPill };
    }
    listX = parentPill.x + parentPill.w + geometry.bridgeGap;
  }

  const listViewport: Rect = {
    x: listX,
    y: top + geometry.panelPad,
    w: geometry.listWidth,
    h: listHeight,
  };
  const maxScroll = Math.max(0, contentHeight - listHeight);

  return {
    panel,
    parentPill,
    backHot,
    parentBody,
    listViewport,
    contentHeight,
    maxScroll,
  };
}

function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h;
}

/**
 * 将指针映射到树菜单热区。scrollY 为列表内容向上滚动的像素。
 */
export function hitTestTree(
  clientX: number,
  clientY: number,
  layout: TreePanelLayout,
  items: readonly TreeItem[],
  scrollY: number,
  geometry: TreeGeometry = DEFAULT_TREE_GEOMETRY,
): TreeHit {
  if (!pointInRect(clientX, clientY, layout.panel)) {
    return { zone: 'cancel', index: -1 };
  }
  if (layout.backHot && pointInRect(clientX, clientY, layout.backHot)) {
    return { zone: 'back', index: -1 };
  }
  if (layout.parentBody && pointInRect(clientX, clientY, layout.parentBody)) {
    return { zone: 'parent', index: -1 };
  }
  if (!pointInRect(clientX, clientY, layout.listViewport)) {
    return { zone: 'none', index: -1 };
  }

  const localY = clientY - layout.listViewport.y + scrollY;
  let offset = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const height = rowHeight(item, geometry);
    const rowTop = offset;
    const rowBottom = offset + height;
    if (localY >= rowTop && localY < rowBottom) {
      if (item.kind === 'separator') {
        return { zone: 'none', index };
      }
      const localX = clientX - layout.listViewport.x;
      const drillLeft = layout.listViewport.w - geometry.drillWidth;
      if (item.expandable && localX >= drillLeft) {
        return { zone: 'drill', index };
      }
      return { zone: 'item', index };
    }
    offset = rowBottom + geometry.itemGap;
  }
  return { zone: 'none', index: -1 };
}

/** 边缘滚动带宽：固定小条；列表很矮时不超过半高。 */
export function resolveEdgeScrollZone(
  listHeight: number,
  geometry: TreeGeometry = DEFAULT_TREE_GEOMETRY,
): number {
  if (listHeight <= 0) return geometry.edgeScrollZone;
  return Math.min(geometry.edgeScrollZone, Math.floor(listHeight / 2));
}

/**
 * 列表边缘自动滚动。仅当指针落在列表视口最上/最下窄条内时返回增量；
 * 列表中部项上不滚动。越靠边缘略快，整体偏慢。
 */
export function edgeScrollDelta(
  clientX: number,
  clientY: number,
  layout: TreePanelLayout,
  geometry: TreeGeometry = DEFAULT_TREE_GEOMETRY,
): number {
  const { listViewport } = layout;
  // 必须在列表视口内（含窄边缘带），避免在中部命令上误滚
  if (
    clientX < listViewport.x
    || clientX > listViewport.x + listViewport.w
    || clientY < listViewport.y
    || clientY > listViewport.y + listViewport.h
  ) {
    return 0;
  }

  const top = listViewport.y;
  const bottom = listViewport.y + listViewport.h;
  const zone = resolveEdgeScrollZone(listViewport.h, geometry);
  const topDist = clientY - top;
  const bottomDist = bottom - clientY;

  if (clientY <= top + zone) {
    const depth = Math.min(1, Math.max(0, 1 - topDist / zone));
    return -Math.max(1, Math.round(TREE_EDGE_SCROLL_SPEED * (0.65 + depth * 0.85)));
  }
  if (clientY >= bottom - zone) {
    const depth = Math.min(1, Math.max(0, 1 - bottomDist / zone));
    return Math.max(1, Math.round(TREE_EDGE_SCROLL_SPEED * (0.65 + depth * 0.85)));
  }
  return 0;
}

/**
 * 根级快捷最近项：最多 4 个最近保存 + 2 个最近打开（打开侧去重保存已出现的）。
 */
export function pickTreeRecentFolderIds(
  savedRecentIds: readonly string[],
  browsedRecentIds: readonly string[],
): string[] {
  const saved = savedRecentIds.slice(0, TREE_MAX_RECENT_SAVED);
  const savedSet = new Set(saved);
  const browsed: string[] = [];
  for (const folderId of browsedRecentIds) {
    if (savedSet.has(folderId)) continue;
    browsed.push(folderId);
    if (browsed.length >= TREE_MAX_RECENT_BROWSED) break;
  }
  return [...saved, ...browsed];
}

export function clampScroll(scrollY: number, maxScroll: number): number {
  return Math.min(Math.max(0, scrollY), maxScroll);
}

/* ================= 兼容旧径向 API（测试/迁移残留） ================= */

/** @deprecated 树状菜单无扇区几何；保留常量避免外部硬崩。 */
export const DEFAULT_RADIAL_GEOMETRY = {
  hub: 45,
  ringOut: 120,
  band: 16,
  releaseTolerance: 8,
};

export const RADIAL_CROSS_OUTWARD_PX = 100;
export const RADIAL_CONTENT_PAGE = 6;
export const RADIAL_LEVEL_CAPACITY = 7;
export const RADIAL_MAX_RECENTS = 5;
export const RADIAL_TAU = Math.PI * 2;
export const RADIAL_TOP = -Math.PI / 2;

export function expandRadius(geometry: { ringOut: number; band: number }): number {
  return geometry.ringOut + geometry.band;
}

export function radialCrossTriggerRadius(geometry: { ringOut: number }): number {
  return geometry.ringOut + RADIAL_CROSS_OUTWARD_PX;
}

export function isReleaseInRing(
  distance: number,
  geometry: { hub: number; ringOut: number; releaseTolerance: number },
): boolean {
  return distance >= geometry.hub && distance <= geometry.ringOut + geometry.releaseTolerance;
}

export function clampCenter(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const margin = DEFAULT_TREE_GEOMETRY.viewportMargin + 40;
  return {
    x: Math.min(Math.max(x, margin), Math.max(margin, viewportWidth - margin)),
    y: Math.min(Math.max(y, margin), Math.max(margin, viewportHeight - margin)),
  };
}

export function midAngle(index: number, count: number, rotation: number): number {
  return RADIAL_TOP + index * (RADIAL_TAU / count) + rotation;
}

export function sectorAt(angle: number, count: number, rotation: number): number {
  const width = RADIAL_TAU / count;
  let relative = angle - rotation - RADIAL_TOP + width / 2;
  relative = ((relative % RADIAL_TAU) + RADIAL_TAU) % RADIAL_TAU;
  return Math.min(count - 1, Math.floor(relative / width));
}

export function rotationForEntry(entryAngle: number): number {
  return entryAngle + Math.PI - RADIAL_TOP;
}

export function pageCountForLevel(): number {
  return 1;
}

export function armedCrumb(item: TreeFolderItem | null | undefined): string | null {
  if (!item) return null;
  return `保存到：${item.path.split('/').join(' / ')}`;
}
