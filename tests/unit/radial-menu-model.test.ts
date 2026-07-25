import { describe, expect, it } from 'vitest';

import type { ExtensionFolderOption } from '../../extension/folder-menu';
import {
  DEFAULT_RADIAL_GEOMETRY,
  RADIAL_CONTENT_PAGE,
  RADIAL_LEVEL_CAPACITY,
  RADIAL_TAU,
  armedCrumb,
  buildFolderTree,
  clampCenter,
  crumbForLevel,
  disambiguateLabels,
  expandRadius,
  findFolderNode,
  isReleaseInRing,
  itemsForLevel,
  midAngle,
  pageCountForLevel,
  rotationForEntry,
  sectorAt,
  type FolderNode,
  type RadialMenuContext,
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

function contextWithRecents(recentIds: readonly string[]): RadialMenuContext {
  const tree = buildFolderTree(FIXTURE_FOLDERS);
  return {
    roots: tree.roots,
    recents: recentIds
      .map((id) => tree.byId.get(id))
      .filter((node): node is FolderNode => node !== undefined)
      .slice(0, 5),
  };
}

describe('radial geometry', () => {
  it('maps cardinal directions to sectors with 8 items', () => {
    expect(sectorAt(-Math.PI / 2, 8, 0)).toBe(0);
    expect(sectorAt(0, 8, 0)).toBe(2);
    expect(sectorAt(Math.PI / 2, 8, 0)).toBe(4);
    expect(sectorAt(Math.PI, 8, 0)).toBe(6);
    expect(sectorAt(-Math.PI, 8, 0)).toBe(6);
  });

  it('is the exact inverse of midAngle for any count/rotation', () => {
    for (const [count, rotation] of [
      [8, 0],
      [5, 0.7],
      [3, -1.2],
      [7, 2.4],
      [2, 0.3],
      [1, 1.1],
    ] as const) {
      for (let i = 0; i < count; i += 1) {
        expect(sectorAt(midAngle(i, count, rotation), count, rotation)).toBe(i);
      }
    }
  });

  it('pins the back sector (index 0) exactly opposite the entry direction', () => {
    const norm = (angle: number) => ((angle % RADIAL_TAU) + RADIAL_TAU) % RADIAL_TAU;
    for (const theta of [Math.PI / 4, -Math.PI / 3, 2.9]) {
      const rotation = rotationForEntry(theta);
      expect(norm(midAngle(0, 8, rotation))).toBeCloseTo(norm(theta + Math.PI), 9);
    }
  });

  it('accepts release only inside the sector ring', () => {
    const g = DEFAULT_RADIAL_GEOMETRY;
    expect(isReleaseInRing(g.hub - 1, g)).toBe(false);
    expect(isReleaseInRing(g.hub, g)).toBe(true);
    expect(isReleaseInRing(g.ringOut, g)).toBe(true);
    expect(isReleaseInRing(g.ringOut + g.releaseTolerance, g)).toBe(true);
    expect(isReleaseInRing(g.ringOut + g.releaseTolerance + 1, g)).toBe(false);
  });

  it('clamps the wheel center inside the viewport margin', () => {
    const g = DEFAULT_RADIAL_GEOMETRY;
    const margin = expandRadius(g) + 16;
    expect(clampCenter(0, 0, 1280, 800, g)).toEqual({ x: margin, y: margin });
    expect(clampCenter(2000, 2000, 1280, 800, g)).toEqual({
      x: 1280 - margin,
      y: 800 - margin,
    });
    expect(clampCenter(640, 400, 1280, 800, g)).toEqual({ x: 640, y: 400 });
  });

  it('keeps the back-crossing landing point inside the parent hub (no bounce)', () => {
    // 从父级外甩 expandR 进入子级，再穿越返回：光标应落在父级中心圆内
    const g = DEFAULT_RADIAL_GEOMETRY;
    const radius = expandRadius(g);
    const theta = Math.PI / 4;
    const cxSub = radius * Math.cos(theta);
    const cySub = radius * Math.sin(theta);
    const backDirection = theta + Math.PI;
    const px = cxSub + (radius + 5) * Math.cos(backDirection);
    const py = cySub + (radius + 5) * Math.sin(backDirection);
    expect(Math.hypot(px, py)).toBeLessThan(g.hub);
  });
});

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

  it('sorts each level by zh-CN name and keeps intermediate containers expandable', () => {
    const tree = buildFolderTree(FIXTURE_FOLDERS);
    const cd = findFolderNode(tree.roots, '概念设计');
    expect(cd?.children.length).toBe(7);
    const names = cd?.children.map((child) => child.name) ?? [];
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b, 'zh-CN')));
  });

  it('tolerates empty relativePath by falling back to name', () => {
    const tree = buildFolderTree([folder('f-x', '散件', '')]);
    expect(findFolderNode(tree.roots, '散件')?.folderId).toBe('f-x');
  });
});

describe('itemsForLevel', () => {
  it('root emphasizes recents first (most recent at index 0), then 根目录 and 全部文件夹', () => {
    const context = contextWithRecents(['f-tex-skin', 'f-inspire']);
    const items = itemsForLevel({ kind: 'root' }, 0, context);
    expect(items.map((item) => item.label)).toEqual(['皮肤', '灵感采集', '根目录', '全部文件夹']);
    expect(items[0]).toMatchObject({ recent: true, nav: 'save', folderId: 'f-tex-skin' });
    expect(items[1]).toMatchObject({ recent: true });
    expect(items[2]).toMatchObject({ nav: 'save', folderId: null });
    expect(items[3]).toMatchObject({ nav: 'expand', expandable: true });
  });

  it('root works with zero recents (fresh library)', () => {
    const context = contextWithRecents([]);
    const items = itemsForLevel({ kind: 'root' }, 0, context);
    expect(items.map((item) => item.label)).toEqual(['根目录', '全部文件夹']);
  });

  it('disambiguates duplicate recent names with full paths', () => {
    const context = contextWithRecents(['f-ref-role', 'f-cd-role', 'f-tex-skin']);
    const items = itemsForLevel({ kind: 'root' }, 0, context);
    const labels = items.map((item) => item.label);
    expect(labels).toContain('参考 / 角色');
    expect(labels).toContain('概念设计 / 角色');
    expect(labels).toContain('皮肤');
    expect(labels.filter((label) => label === '角色')).toHaveLength(0);
  });

  it('all level prepends crossable back item and shows top-level folders', () => {
    const context = contextWithRecents([]);
    const items = itemsForLevel({ kind: 'all' }, 0, context);
    expect(items[0]).toMatchObject({ nav: 'back', expandable: true });
    expect(items.length).toBe(1 + 4); // 返回 + 概念设计/参考/贴图/灵感采集
    const cd = items.find((item) => item.label === '概念设计');
    expect(cd).toMatchObject({ expandable: true, target: { kind: 'folder', path: '概念设计' } });
  });

  it('folder level has no save-here item; ≤7 children fit one page', () => {
    const context = contextWithRecents([]);
    const level = { kind: 'folder', path: '概念设计' } as const;
    expect(pageCountForLevel(level, context)).toBe(1);
    const items = itemsForLevel(level, 0, context);
    expect(items[0].nav).toBe('back');
    expect(items.filter((item) => item.nav === 'page')).toHaveLength(0);
    expect(items.length).toBe(1 + 7);
    expect(items.some((item) => item.label === '保存在此')).toBe(false);
  });

  it('paginates >7 children as 返回+6+更多', () => {
    const manyChildren: ExtensionFolderOption[] = [folder('big', '大目录', '大目录')];
    for (let i = 1; i <= 8; i += 1) {
      manyChildren.push(folder(`big-${i}`, `子${i}`, `大目录/子${i}`));
    }
    const tree = buildFolderTree(manyChildren);
    const context: RadialMenuContext = { roots: tree.roots, recents: [] };
    const level = { kind: 'folder', path: '大目录' } as const;
    expect(pageCountForLevel(level, context)).toBe(2);
    const page0 = itemsForLevel(level, 0, context);
    expect(page0.length).toBe(1 + RADIAL_CONTENT_PAGE + 1);
    expect(page0.at(-1)?.nav).toBe('page');
    const page1 = itemsForLevel(level, 1, context);
    expect(page1.length).toBe(1 + 2 + 1);
  });

  it('empty folder level shows only the back item', () => {
    const context = contextWithRecents([]);
    const items = itemsForLevel({ kind: 'folder', path: '灵感采集' }, 0, context);
    expect(items.map((item) => item.nav)).toEqual(['back']);
  });

  it('capacity constants stay consistent with the 8-sector wheel', () => {
    expect(RADIAL_CONTENT_PAGE + 2).toBe(8);
    expect(RADIAL_LEVEL_CAPACITY + 1).toBe(8);
  });
});

describe('crumbs', () => {
  it('previews the full save path for armed save items', () => {
    const context = contextWithRecents(['f-ref-role']);
    const root = itemsForLevel({ kind: 'root' }, 0, context);
    expect(armedCrumb(root[0])).toBe('保存到：参考 / 角色');
  });

  it('previews navigation actions', () => {
    const context = contextWithRecents([]);
    const all = itemsForLevel({ kind: 'all' }, 0, context);
    expect(armedCrumb(all[0])).toBe('返回上一级');
    const expand = itemsForLevel({ kind: 'root' }, 0, context).find(
      (item) => item.nav === 'expand',
    );
    expect(armedCrumb(expand)).toBe('展开：全部文件夹');
  });

  it('describes the current level path', () => {
    const context = contextWithRecents([]);
    expect(crumbForLevel({ kind: 'root' }, context)).toBe('保存到 Serpent');
    expect(crumbForLevel({ kind: 'folder', path: '参考/角色' }, context)).toBe(
      '全部文件夹 / 参考 / 角色',
    );
  });
});

describe('disambiguateLabels', () => {
  it('only expands duplicated save labels, leaves navigation labels alone', () => {
    const items = disambiguateLabels([
      { label: '返回', nav: 'back', expandable: true },
      { label: '角色', nav: 'save', path: '参考/角色', expandable: false },
      { label: '角色', nav: 'save', path: '概念设计/角色', expandable: false },
      { label: '皮肤', nav: 'save', path: '贴图/皮肤', expandable: false },
    ]);
    expect(items[0].label).toBe('返回');
    expect(items[1].label).toBe('参考 / 角色');
    expect(items[2].label).toBe('概念设计 / 角色');
    expect(items[3].label).toBe('皮肤');
  });
});
