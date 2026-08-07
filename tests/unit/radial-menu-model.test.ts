import { describe, expect, it } from 'vitest';

import type { ExtensionFolderOption } from '../../extension/folder-menu';
import {
  DEFAULT_TREE_GEOMETRY,
  TREE_EDGE_SCROLL_ZONE,
  TREE_MAX_RECENT_BROWSED,
  TREE_MAX_RECENT_SAVED,
  TREE_NAV_DWELL_MS,
  TREE_SEPARATOR_HEIGHT,
  armedHint,
  buildFolderTree,
  clampScroll,
  crumbForLevel,
  disambiguateLabels,
  edgeScrollDelta,
  findFolderNode,
  hitTestTree,
  isFolderItem,
  itemsForLevel,
  listContentHeight,
  measureTreePanel,
  parentInfoForLevel,
  pickTreeRecentFolderIds,
  resolveEdgeScrollZone,
  type FolderNode,
  type TreeFolderItem,
  type TreeItem,
  type TreeMenuContext,
  type TreeParentInfo,
} from '../../extension/radial-menu-model';

function folder(folderId: string, name: string, relativePath: string): ExtensionFolderOption {
  return { folderId, name, relativePath };
}

const FIXTURE_FOLDERS: ExtensionFolderOption[] = [
  folder('f-cd', '概念设计', '概念设计'),
  folder('f-cd-role', '角色', '概念设计/角色'),
  folder('f-cd-scene', '场景', '概念设计/场景'),
  folder('f-cd-prop', '道具', '概念设计/道具'),
  folder('f-cd-vehicle', '载具', '概念设计/载具'),
  folder('f-cd-creature', '生物', '概念设计/生物'),
  folder('f-cd-weapon', '武器', '概念设计/武器'),
  folder('f-cd-mood', '氛围', '概念设计/氛围'),
  folder('f-ref', '参考', '参考'),
  folder('f-ref-role', '角色', '参考/角色'),
  folder('f-ref-role-body', '人体', '参考/角色/人体'),
  folder('f-tex', '贴图', '贴图'),
  folder('f-tex-skin', '皮肤', '贴图/皮肤'),
  folder('f-inspire', '灵感采集', '灵感采集'),
];

function contextWith(
  recentIds: readonly string[] = [],
  libraryDisplayName = '演示库',
): TreeMenuContext {
  const tree = buildFolderTree(FIXTURE_FOLDERS);
  return {
    roots: tree.roots,
    recentFolders: recentIds
      .map((id) => tree.byId.get(id))
      .filter((node): node is FolderNode => node !== undefined),
    libraryDisplayName,
  };
}

function folderRows(count: number, expandable = true): TreeItem[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'folder' as const,
    label: `项${index}`,
    nav: 'save' as const,
    path: `项${index}`,
    folderId: `id-${index}`,
    expandable,
  }));
}

const PARENT_WITH_BACK: TreeParentInfo = {
  label: '参考',
  path: '参考',
  folderId: 'f-ref',
  backTarget: { kind: 'root' },
  showBack: true,
};

describe('buildFolderTree', () => {
  it('nests relative paths and fills folderId on leaf nodes', () => {
    const tree = buildFolderTree(FIXTURE_FOLDERS);
    const ref = findFolderNode(tree.roots, '参考');
    expect(ref?.folderId).toBe('f-ref');
    const role = findFolderNode(tree.roots, '参考/角色');
    expect(role?.folderId).toBe('f-ref-role');
    expect(role?.children.map((child) => child.name)).toEqual(['人体']);
    expect(tree.byId.get('f-tex-skin')?.path).toBe('贴图/皮肤');
  });

  it('sorts each level by zh-CN name', () => {
    const tree = buildFolderTree(FIXTURE_FOLDERS);
    const cd = findFolderNode(tree.roots, '概念设计');
    expect(cd?.children.length).toBe(7);
    const names = cd?.children.map((child) => child.name) ?? [];
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh-CN')));
  });
});

describe('itemsForLevel (tree)', () => {
  it('root lists recent folders, separator, then top-level folders (no duplicate)', () => {
    const context = contextWith(['f-tex-skin', 'f-inspire']);
    const items = itemsForLevel({ kind: 'root' }, context);
    expect(items.map((item) => (isFolderItem(item) ? item.label : '—'))).toEqual([
      '皮肤',
      '灵感采集',
      '—',
      '参考',
      '概念设计',
      '贴图',
    ]);
    expect(items[2]).toEqual({ kind: 'separator' });
    expect(items.filter(isFolderItem).every((item) => item.nav === 'save')).toBe(true);
    // 灵感采集已在最近区，一级区不再重复
    expect(items.filter(isFolderItem).filter((item) => item.label === '灵感采集')).toHaveLength(1);
  });

  it('root without recents lists only top-level folders (no separator)', () => {
    const items = itemsForLevel({ kind: 'root' }, contextWith([]));
    expect(items.every(isFolderItem)).toBe(true);
    expect(items.map((item) => (isFolderItem(item) ? item.label : '')).sort()).toEqual(
      ['概念设计', '参考', '贴图', '灵感采集'].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    );
  });

  it('disambiguates duplicate recent names with full paths', () => {
    const context = contextWith(['f-ref-role', 'f-cd-role', 'f-tex-skin']);
    const labels = itemsForLevel({ kind: 'root' }, context)
      .filter(isFolderItem)
      .map((item) => item.label);
    expect(labels).toContain('参考 / 角色');
    expect(labels).toContain('概念设计 / 角色');
    expect(labels).toContain('皮肤');
  });

  it('all level lists every top-level folder without pagination or back row', () => {
    const items = itemsForLevel({ kind: 'all' }, contextWith([]));
    expect(items.every((item) => isFolderItem(item) && item.nav === 'save')).toBe(true);
    expect(
      items.filter(isFolderItem).map((item) => item.label).sort(),
    ).toEqual(
      ['概念设计', '参考', '贴图', '灵感采集'].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    );
  });

  it('folder level lists all children without an 8-item cap', () => {
    const items = itemsForLevel({ kind: 'folder', path: '概念设计' }, contextWith([]));
    expect(items).toHaveLength(7);
    expect(items.some((item) => isFolderItem(item) && item.label === '保存在此')).toBe(false);
  });

  it('lists more than 7 children in one level (scroll, no page item)', () => {
    const manyChildren: ExtensionFolderOption[] = [folder('big', '大目录', '大目录')];
    for (let i = 1; i <= 12; i += 1) {
      manyChildren.push(folder(`big-${i}`, `子${i}`, `大目录/子${i}`));
    }
    const tree = buildFolderTree(manyChildren);
    const context: TreeMenuContext = {
      roots: tree.roots,
      recentFolders: [],
      libraryDisplayName: '演示库',
    };
    const items = itemsForLevel({ kind: 'folder', path: '大目录' }, context);
    expect(items).toHaveLength(12);
    expect(items.every((item) => isFolderItem(item) && item.nav === 'save')).toBe(true);
  });
});

describe('parentInfoForLevel', () => {
  it('root shows library display name with no back chevron; drop saves to library root', () => {
    expect(parentInfoForLevel({ kind: 'root' }, contextWith([], '我的素材库'))).toMatchObject({
      label: '我的素材库',
      folderId: null,
      path: '根目录',
      showBack: false,
      backTarget: { kind: 'root' },
    });
  });

  it('all level parents to library name with back to root', () => {
    expect(parentInfoForLevel({ kind: 'all' }, contextWith([], '演示库'))).toMatchObject({
      label: '演示库',
      folderId: null,
      showBack: true,
      backTarget: { kind: 'root' },
    });
  });

  it('nested folder parents back toward root (not all)', () => {
    const context = contextWith([]);
    expect(parentInfoForLevel({ kind: 'folder', path: '参考' }, context)).toMatchObject({
      label: '参考',
      folderId: 'f-ref',
      backTarget: { kind: 'root' },
      showBack: true,
    });
    expect(parentInfoForLevel({ kind: 'folder', path: '参考/角色' }, context)).toMatchObject({
      label: '角色',
      folderId: 'f-ref-role',
      backTarget: { kind: 'folder', path: '参考' },
      showBack: true,
    });
  });
});

describe('measureTreePanel + hitTestTree', () => {
  it('places parent pill left of the list and hit-tests back/item/drill', () => {
    const items = folderRows(4);
    const layout = measureTreePanel(400, 300, items, PARENT_WITH_BACK, 1280, 800);
    expect(layout.parentPill).not.toBeNull();
    expect(layout.backHot).not.toBeNull();
    expect(layout.listViewport.x).toBeGreaterThan(layout.parentPill!.x + layout.parentPill!.w - 1);

    const back = hitTestTree(
      layout.backHot!.x + 4,
      layout.backHot!.y + 4,
      layout,
      items,
      0,
    );
    expect(back.zone).toBe('back');

    const itemX = layout.listViewport.x + 20;
    const itemY = layout.listViewport.y + DEFAULT_TREE_GEOMETRY.itemHeight / 2;
    expect(hitTestTree(itemX, itemY, layout, items, 0).zone).toBe('item');
    expect(hitTestTree(itemX, itemY, layout, items, 0).index).toBe(0);

    const drillX = layout.listViewport.x + layout.listViewport.w - 4;
    expect(hitTestTree(drillX, itemY, layout, items, 0)).toEqual({ zone: 'drill', index: 0 });
  });

  it('root library parent has no back hotzone; body still saves to root', () => {
    const items = folderRows(3, false);
    const parent = parentInfoForLevel({ kind: 'root' }, contextWith([], '演示库'));
    const layout = measureTreePanel(400, 300, items, parent, 1280, 800);
    expect(layout.backHot).toBeNull();
    expect(layout.parentBody).not.toBeNull();
    expect(
      hitTestTree(
        layout.parentBody!.x + 8,
        layout.parentBody!.y + 8,
        layout,
        items,
        0,
      ).zone,
    ).toBe('parent');
  });

  it('treats separators as non-save hits and skips them for bridges content height', () => {
    const items: TreeItem[] = [
      ...folderRows(1, false),
      { kind: 'separator' },
      ...folderRows(1, false).map((item) =>
        isFolderItem(item) ? { ...item, label: '二级', path: '二级', folderId: 'id-b' } : item,
      ),
    ];
    expect(listContentHeight(items)).toBe(
      DEFAULT_TREE_GEOMETRY.itemHeight
        + DEFAULT_TREE_GEOMETRY.itemGap
        + TREE_SEPARATOR_HEIGHT
        + DEFAULT_TREE_GEOMETRY.itemGap
        + DEFAULT_TREE_GEOMETRY.itemHeight,
    );
    const layout = measureTreePanel(400, 300, items, null, 1280, 800);
    const sepY =
      layout.listViewport.y
      + DEFAULT_TREE_GEOMETRY.itemHeight
      + DEFAULT_TREE_GEOMETRY.itemGap
      + TREE_SEPARATOR_HEIGHT / 2;
    expect(
      hitTestTree(layout.listViewport.x + 20, sepY, layout, items, 0).zone,
    ).toBe('none');
  });

  it('treats outside the panel as cancel', () => {
    const items = folderRows(3);
    const layout = measureTreePanel(400, 300, items, null, 1280, 800);
    expect(hitTestTree(layout.panel.x - 10, layout.panel.y, layout, items, 0).zone).toBe('cancel');
  });

  it('accounts for scroll when hitting lower items', () => {
    const items = folderRows(20);
    const layout = measureTreePanel(400, 300, items, null, 1280, 800);
    expect(layout.maxScroll).toBeGreaterThan(0);
    const stride = DEFAULT_TREE_GEOMETRY.itemHeight + DEFAULT_TREE_GEOMETRY.itemGap;
    const y = layout.listViewport.y + 10;
    const x = layout.listViewport.x + 20;
    expect(hitTestTree(x, y, layout, items, 0).index).toBe(0);
    expect(hitTestTree(x, y, layout, items, stride * 5).index).toBe(5);
  });

  it('clamps scroll and only edge-scrolls within a narrow top/bottom band', () => {
    expect(clampScroll(-10, 100)).toBe(0);
    expect(clampScroll(150, 100)).toBe(100);
    const layout = measureTreePanel(400, 300, folderRows(20), null, 1280, 800);
    const midX = layout.listViewport.x + layout.listViewport.w / 2;
    const zone = resolveEdgeScrollZone(layout.listViewport.h);
    expect(zone).toBe(TREE_EDGE_SCROLL_ZONE);
    expect(zone).toBeLessThan(DEFAULT_TREE_GEOMETRY.itemHeight);

    expect(edgeScrollDelta(midX, layout.listViewport.y + 4, layout)).toBeLessThan(0);
    expect(
      edgeScrollDelta(midX, layout.listViewport.y + layout.listViewport.h - 4, layout),
    ).toBeGreaterThan(0);
    // 列表中部（含原先约 25%/40% 带宽）不得滚动
    expect(
      edgeScrollDelta(midX, layout.listViewport.y + layout.listViewport.h / 2, layout),
    ).toBe(0);
    const formerWideBand = layout.listViewport.y + Math.floor(layout.listViewport.h * 0.25);
    expect(edgeScrollDelta(midX, formerWideBand, layout)).toBe(0);
    // 刚出窄带内侧也不滚
    expect(
      edgeScrollDelta(midX, layout.listViewport.y + zone + 2, layout),
    ).toBe(0);
  });
});

describe('pickTreeRecentFolderIds', () => {
  it('keeps at most 4 saved + 2 browsed without duplicating saved ids', () => {
    expect(TREE_MAX_RECENT_SAVED).toBe(4);
    expect(TREE_MAX_RECENT_BROWSED).toBe(2);
    expect(
      pickTreeRecentFolderIds(
        ['s1', 's2', 's3', 's4', 's5'],
        ['s2', 'b1', 'b2', 'b3'],
      ),
    ).toEqual(['s1', 's2', 's3', 's4', 'b1', 'b2']);
  });
});

describe('hints', () => {
  it('describes save / drill / back / library-root actions', () => {
    const context = contextWith(['f-tex-skin', 'f-inspire'], '演示库');
    const items = itemsForLevel({ kind: 'root' }, context);
    expect(armedHint({ zone: 'item', index: 0 }, items, null)).toBe('保存到：贴图 / 皮肤');
    const drillIndex = items.findIndex(
      (item) => isFolderItem(item) && item.expandable && item.section === 'folders',
    );
    expect(armedHint({ zone: 'drill', index: drillIndex }, items, null)).toMatch(/^进入：/);
    const parent = parentInfoForLevel({ kind: 'root' }, context);
    expect(armedHint({ zone: 'parent', index: -1 }, items, parent)).toBe(
      '保存到：演示库（根目录）',
    );
    expect(armedHint({ zone: 'back', index: -1 }, items, parent)).toBe('返回上一级');
    expect(crumbForLevel({ kind: 'root' }, '演示库')).toBe('保存到 演示库');
    expect(crumbForLevel({ kind: 'folder', path: '参考/角色' })).toBe('根目录 / 参考 / 角色');
  });
});

describe('disambiguateLabels', () => {
  it('only expands duplicated save labels', () => {
    const items = disambiguateLabels([
      {
        kind: 'folder',
        label: '角色',
        nav: 'save',
        path: '参考/角色',
        folderId: 'a',
        expandable: false,
      },
      {
        kind: 'folder',
        label: '角色',
        nav: 'save',
        path: '概念设计/角色',
        folderId: 'b',
        expandable: false,
      },
      {
        kind: 'folder',
        label: '皮肤',
        nav: 'save',
        path: '贴图/皮肤',
        folderId: 'c',
        expandable: false,
      },
    ] satisfies TreeFolderItem[]);
    expect(items[0]!.label).toBe('参考 / 角色');
    expect(items[1]!.label).toBe('概念设计 / 角色');
    expect(items[2]!.label).toBe('皮肤');
  });
});

describe('nav dwell constant', () => {
  it('requires 500ms before level change', () => {
    expect(TREE_NAV_DWELL_MS).toBe(500);
  });
});
