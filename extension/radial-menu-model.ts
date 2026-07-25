import type { ExtensionFolderOption } from './folder-menu';

/**
 * Serpent-6llg / REQ-EXT-005 拖拽径向保存菜单（Hotbox）纯逻辑。
 * 设计规格：docs/ui/0002-extension-drag-radial-save-menu.md（v4）。
 * 本模块不接触 DOM，几何/树/分页/消歧全部可单测；渲染与拖拽事件在 radial-menu.ts。
 */

export interface RadialGeometry {
  /** 中心圆半径：d < hub 为中心（取消） */
  readonly hub: number;
  /** 扇区外径：hub–ringOut 为扇区选择环 */
  readonly ringOut: number;
  /** 展开带宽：ringOut–(ringOut+band) 之间穿越触发导航动作 */
  readonly band: number;
  /** 环内松开容差：ringOut+releaseTolerance 以内仍算落在扇区上 */
  readonly releaseTolerance: number;
}

/** 2026-07-25 产品负责人在原型上调定：外径 120、中心半径 45。 */
export const DEFAULT_RADIAL_GEOMETRY: RadialGeometry = {
  hub: 45,
  ringOut: 120,
  band: 16,
  releaseTolerance: 8,
};

export function expandRadius(geometry: RadialGeometry): number {
  return geometry.ringOut + geometry.band;
}

/** 只有落在扇区环内的松开才执行动作；中心与环外松开一律退出不保存。 */
export function isReleaseInRing(distance: number, geometry: RadialGeometry): boolean {
  return distance >= geometry.hub && distance <= geometry.ringOut + geometry.releaseTolerance;
}

export function clampCenter(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  geometry: RadialGeometry,
): { x: number; y: number } {
  const margin = expandRadius(geometry) + 16;
  return {
    x: Math.min(Math.max(x, margin), Math.max(margin, viewportWidth - margin)),
    y: Math.min(Math.max(y, margin), Math.max(margin, viewportHeight - margin)),
  };
}

/* ================= 角度（命中与渲染共用同一角坐标系） ================= */

export const RADIAL_TAU = Math.PI * 2;
export const RADIAL_TOP = -Math.PI / 2;

/** 扇区 i 的中线角 = TOP + i·(2π/count) + rotation。 */
export function midAngle(index: number, count: number, rotation: number): number {
  return RADIAL_TOP + index * (RADIAL_TAU / count) + rotation;
}

/** midAngle 的严格逆运算：sectorAt(midAngle(i)) === i（任意 count/rotation）。 */
export function sectorAt(angle: number, count: number, rotation: number): number {
  const width = RADIAL_TAU / count;
  let relative = angle - rotation - RADIAL_TOP + width / 2;
  relative = ((relative % RADIAL_TAU) + RADIAL_TAU) % RADIAL_TAU;
  return Math.min(count - 1, Math.floor(relative / width));
}

/** 子级整体旋转角：使「返回」扇区（index 0）中线 = 进入方向 + π（正对来路）。 */
export function rotationForEntry(entryAngle: number): number {
  return entryAngle + Math.PI - RADIAL_TOP;
}

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
    // 末端节点回填真实 folderId（中间节点保持 null，只是路径容器）
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

/* ================= 层级与扇区项 ================= */

export type RadialLevel =
  | { readonly kind: 'root' }
  | { readonly kind: 'all' }
  | { readonly kind: 'folder'; readonly path: string };

export type RadialItemNav = 'save' | 'expand' | 'page' | 'back';

export interface RadialItem {
  label: string;
  readonly nav: RadialItemNav;
  /** save 项的保存目标路径（根目录为 '根目录'） */
  readonly path?: string;
  /** save 项的保存目标 folderId（根目录为 null） */
  readonly folderId?: string | null;
  /** 可穿越外环执行导航动作（展开/返回/翻页） */
  readonly expandable: boolean;
  readonly target?: RadialLevel;
  /** 最近使用（根级着重显示） */
  readonly recent?: boolean;
}

/** 每级内容槽位：返回 1 + 内容 7；>7 → 返回 + 6 + 更多 */
export const RADIAL_CONTENT_PAGE = 6;
export const RADIAL_LEVEL_CAPACITY = 7;
export const RADIAL_MAX_RECENTS = 5;

export interface RadialMenuContext {
  readonly roots: readonly FolderNode[];
  /** 最近使用文件夹节点，按最近顺序（最多 RADIAL_MAX_RECENTS 个） */
  readonly recents: readonly FolderNode[];
}

const BACK_ITEM: RadialItem = { label: '返回', nav: 'back', expandable: true };
const ROOT_FOLDER_PATH = '根目录';

function folderItem(node: FolderNode, recent: boolean): RadialItem {
  const expandable = node.children.length > 0;
  return {
    label: node.name,
    nav: 'save',
    path: node.path,
    folderId: node.folderId,
    expandable,
    target: expandable ? { kind: 'folder', path: node.path } : undefined,
    recent,
  };
}

/** 同级重名（如两个「角色」来自不同父目录）自动展开为完整路径消歧。 */
export function disambiguateLabels(items: RadialItem[]): RadialItem[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.nav === 'save' && item.label) {
      counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
    }
  }
  for (const item of items) {
    if (item.nav === 'save' && (counts.get(item.label) ?? 0) > 1 && item.path) {
      item.label = item.path.split('/').join(' / ');
    }
  }
  return items;
}

function contentTotal(level: RadialLevel, context: RadialMenuContext): number {
  if (level.kind === 'all') return context.roots.length;
  if (level.kind === 'folder') {
    return findFolderNode(context.roots, level.path)?.children.length ?? 0;
  }
  return 0;
}

export function pageCountForLevel(level: RadialLevel, context: RadialMenuContext): number {
  if (level.kind === 'root') return 1;
  const total = contentTotal(level, context);
  return total <= RADIAL_LEVEL_CAPACITY ? 1 : Math.ceil(total / RADIAL_CONTENT_PAGE);
}

function pagedContent<T>(items: readonly T[], page: number): { slice: T[]; paged: boolean } {
  const paged = items.length > RADIAL_LEVEL_CAPACITY;
  if (!paged) return { slice: [...items], paged };
  const start = page * RADIAL_CONTENT_PAGE;
  return { slice: items.slice(start, start + RADIAL_CONTENT_PAGE), paged };
}

/**
 * 根级布局（最近位置着重显示，v4 决策）：最近 ×N（最近第 1 名在 12 点位，顺时针递次）
 * → 根目录 → 全部文件夹。子级 index 0 固定为「返回」（钉在进入方向正对面）。
 * 无「保存在此」：存进某文件夹在上一级松开于它的扇区即可。
 */
export function itemsForLevel(
  level: RadialLevel,
  page: number,
  context: RadialMenuContext,
): RadialItem[] {
  if (level.kind === 'root') {
    const items: RadialItem[] = [
      ...context.recents.map((node) => folderItem(node, true)),
      { label: ROOT_FOLDER_PATH, nav: 'save', path: ROOT_FOLDER_PATH, folderId: null, expandable: false },
      { label: '全部文件夹', nav: 'expand', expandable: true, target: { kind: 'all' } },
    ];
    return disambiguateLabels(items);
  }

  if (level.kind === 'all') {
    const { slice, paged } = pagedContent(context.roots, page);
    const items = slice.map((node) => folderItem(node, false));
    if (paged) items.push({ label: '更多', nav: 'page', expandable: true });
    return disambiguateLabels([BACK_ITEM, ...items]);
  }

  // folder
  const node = findFolderNode(context.roots, level.path);
  const children = node?.children ?? [];
  const { slice, paged } = pagedContent(children, page);
  const items = slice.map((child) => folderItem(child, false));
  if (paged) items.push({ label: '更多', nav: 'page', expandable: true });
  return disambiguateLabels([{ ...BACK_ITEM }, ...items]);
}

/** 指针武装时面包屑的动作预告（重名消歧的第二层保障）。 */
export function armedCrumb(item: RadialItem | null | undefined): string | null {
  if (!item) return null;
  if (item.nav === 'save' && item.path) {
    return `保存到：${item.path.split('/').join(' / ')}`;
  }
  if (item.nav === 'back') return '返回上一级';
  if (item.nav === 'page') return '下一页';
  if (item.nav === 'expand') return `展开：${item.label}`;
  return null;
}

export function crumbForLevel(level: RadialLevel, context: RadialMenuContext): string {
  if (level.kind === 'root') return '保存到 Serpent';
  if (level.kind === 'all') {
    return pageCountForLevel(level, context) > 1 ? '全部文件夹（翻页）' : '全部文件夹';
  }
  return `全部文件夹 / ${level.path.split('/').join(' / ')}`;
}
