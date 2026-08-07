import { describe, expect, it } from 'vitest';

import type { ExtensionFolderOption } from '../../extension/folder-menu';
import {
  DEFAULT_TREE_GEOMETRY,
  armedHint,
  buildFolderTree,
  clampScroll,
  crumbForLevel,
  disambiguateLabels,
  edgeScrollDelta,
  findFolderNode,
  hitTestTree,
  itemsForLevel,
  measureTreePanel,
  parentInfoForLevel,
  type FolderNode,
  type TreeMenuContext,
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

function contextWithQuickPick(quickPickIds: readonly string[]): TreeMenuContext {
  const tree = buildFolderTree(FIXTURE_FOLDERS);
  return {
    roots: tree.roots,
    quickPickFolders: quickPickIds
      .map((id) => tree.byId.get(id))
      .filter((node): node is FolderNode => node !== undefined),
  };
}

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
  it('root lists quick-pick folders first, then expandable 根目录', () => {
    const context = contextWithQuickPick(['f-tex-skin', 'f-inspire']);
    const items = itemsForLevel({ kind: 'root' }, context);
    expect(items.map((item) => item.label)).toEqual(['皮肤', '灵感采集', '根目录']);
    expect(items[2]).toMatchObject({
      nav: 'save',
      folderId: null,
      expandable: true,
      target: { kind: 'all' },
    });
  });

  it('disambiguates duplicate quick-pick names with full paths', () => {
    const context = contextWithQuickPick(['f-ref-role', 'f-cd-role', 'f-tex-skin']);
    const labels = itemsForLevel({ kind: 'root' }, context).map((item) => item.label);
    expect(labels).toContain('参考 / 角色');
    expect(labels).toContain('概念设计 / 角色');
    expect(labels).toContain('皮肤');
  });

  it('all level lists every top-level folder without pagination or back row', () => {
    const context = contextWithQuickPick([]);
    const items = itemsForLevel({ kind: 'all' }, context);
    expect(items.every((item) => item.nav === 'save')).toBe(true);
    expect(items.map((item) => item.label).sort()).toEqual(
      ['概念设计', '参考', '贴图', '灵感采集'].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    );
  });

  it('folder level lists all children without an 8-item cap', () => {
    const context = contextWithQuickPick([]);
    const items = itemsForLevel({ kind: 'folder', path: '概念设计' }, context);
    expect(items).toHaveLength(7);
    expect(items.some((item) => item.label === '保存在此')).toBe(false);
  });

  it('lists more than 7 children in one level (scroll, no page item)', () => {
    const manyChildren: ExtensionFolderOption[] = [folder('big', '大目录', '大目录')];
    for (let i = 1; i <= 12; i += 1) {
      manyChildren.push(folder(`big-${i}`, `子${i}`, `大目录/子${i}`));
    }
    const tree = buildFolderTree(manyChildren);
    const context: TreeMenuContext = { roots: tree.roots, quickPickFolders: [] };
    const items = itemsForLevel({ kind: 'folder', path: '大目录' }, context);
    expect(items).toHaveLength(12);
    expect(items.every((item) => item.nav === 'save')).toBe(true);
  });
});

describe('parentInfoForLevel', () => {
  it('root has no parent pill', () => {
    expect(parentInfoForLevel({ kind: 'root' }, contextWithQuickPick([]))).toBeNull();
  });

  it('all level parents to 根目录 with back to root', () => {
    expect(parentInfoForLevel({ kind: 'all' }, contextWithQuickPick([]))).toMatchObject({
      label: '根目录',
      folderId: null,
      backTarget: { kind: 'root' },
    });
  });

  it('nested folder parents back to its parent path or all', () => {
    const context = contextWithQuickPick([]);
    expect(parentInfoForLevel({ kind: 'folder', path: '参考' }, context)).toMatchObject({
      label: '参考',
      folderId: 'f-ref',
      backTarget: { kind: 'all' },
    });
    expect(parentInfoForLevel({ kind: 'folder', path: '参考/角色' }, context)).toMatchObject({
      label: '角色',
      folderId: 'f-ref-role',
      backTarget: { kind: 'folder', path: '参考' },
    });
  });
});

describe('measureTreePanel + hitTestTree', () => {
  it('places parent pill left of the list and hit-tests back/item/drill', () => {
    const layout = measureTreePanel(400, 300, 4, true, 1280, 800);
    expect(layout.parentPill).not.toBeNull();
    expect(layout.backHot).not.toBeNull();
    expect(layout.listViewport.x).toBeGreaterThan(layout.parentPill!.x + layout.parentPill!.w - 1);

    const back = hitTestTree(
      layout.backHot!.x + 4,
      layout.backHot!.y + 4,
      layout,
      4,
      0,
    );
    expect(back.zone).toBe('back');

    const itemX = layout.listViewport.x + 20;
    const itemY = layout.listViewport.y + DEFAULT_TREE_GEOMETRY.itemHeight / 2;
    expect(hitTestTree(itemX, itemY, layout, 4, 0).zone).toBe('item');
    expect(hitTestTree(itemX, itemY, layout, 4, 0).index).toBe(0);

    const drillX = layout.listViewport.x + layout.listViewport.w - 4;
    expect(hitTestTree(drillX, itemY, layout, 4, 0)).toEqual({ zone: 'drill', index: 0 });
  });

  it('treats outside the panel as cancel', () => {
    const layout = measureTreePanel(400, 300, 3, false, 1280, 800);
    expect(hitTestTree(layout.panel.x - 10, layout.panel.y, layout, 3, 0).zone).toBe('cancel');
  });

  it('accounts for scroll when hitting lower items', () => {
    const layout = measureTreePanel(400, 300, 20, false, 1280, 800);
    expect(layout.maxScroll).toBeGreaterThan(0);
    const stride = DEFAULT_TREE_GEOMETRY.itemHeight + DEFAULT_TREE_GEOMETRY.itemGap;
    const y = layout.listViewport.y + 10;
    const x = layout.listViewport.x + 20;
    expect(hitTestTree(x, y, layout, 20, 0).index).toBe(0);
    expect(hitTestTree(x, y, layout, 20, stride * 5).index).toBe(5);
  });

  it('clamps scroll and reports edge scroll deltas', () => {
    expect(clampScroll(-10, 100)).toBe(0);
    expect(clampScroll(150, 100)).toBe(100);
    const layout = measureTreePanel(400, 300, 20, false, 1280, 800);
    expect(edgeScrollDelta(layout.listViewport.y + 4, layout)).toBeLessThan(0);
    expect(
      edgeScrollDelta(layout.listViewport.y + layout.listViewport.h - 4, layout),
    ).toBeGreaterThan(0);
    expect(
      edgeScrollDelta(layout.listViewport.y + layout.listViewport.h / 2, layout),
    ).toBe(0);
  });
});

describe('hints', () => {
  it('describes save / drill / back actions', () => {
    const context = contextWithQuickPick(['f-tex-skin']);
    const items = itemsForLevel({ kind: 'root' }, context);
    expect(armedHint({ zone: 'item', index: 0 }, items, null)).toBe('保存到：贴图 / 皮肤');
    expect(armedHint({ zone: 'drill', index: 1 }, items, null)).toMatch(/^进入：/);
    const parent = parentInfoForLevel({ kind: 'all' }, context);
    expect(armedHint({ zone: 'back', index: -1 }, items, parent)).toBe('返回上一级');
    expect(crumbForLevel({ kind: 'folder', path: '参考/角色' })).toBe('根目录 / 参考 / 角色');
  });
});

describe('disambiguateLabels', () => {
  it('only expands duplicated save labels', () => {
    const items = disambiguateLabels([
      { label: '角色', nav: 'save', path: '参考/角色', folderId: 'a', expandable: false },
      { label: '角色', nav: 'save', path: '概念设计/角色', folderId: 'b', expandable: false },
      { label: '皮肤', nav: 'save', path: '贴图/皮肤', folderId: 'c', expandable: false },
    ]);
    expect(items[0]!.label).toBe('参考 / 角色');
    expect(items[1]!.label).toBe('概念设计 / 角色');
    expect(items[2]!.label).toBe('皮肤');
  });
});
