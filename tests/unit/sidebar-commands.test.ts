import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCommandRegistry } from '../../src/renderer/commands/command-registry';
import type { ResolvedMenuItem } from '../../src/renderer/commands/command-types';
import {
  sidebarCommandDefinitions,
  type SidebarCommandActions,
  type SidebarCommandContext,
} from '../../src/renderer/commands/sidebar-commands';
import type { LinkedFolderSummary } from '../../src/shared/asset-types';

// REQ-COMMAND-001 / 切片 0015-D：侧边栏（文件夹 / 合集 / 智能合集）右键菜单
// 定义的等价性验证。每条规则对照 0015-D 之前 AssetContextMenu 的内联 JSX
// 条件；纯数据，node 环境。删除两项的 window.confirm 保留在 run 内，测试
// 通过 vi.stubGlobal 注入 confirm 验证确认 / 取消两条路径。

const registry = createCommandRegistry(sidebarCommandDefinitions);

const LINKED_FOLDER: LinkedFolderSummary = {
  folderId: 'folder-1',
  displayName: '外部素材库',
  status: 'available',
  assetCount: 12,
  absoluteRootPath: '/Volumes/Art/外部素材库',
};

interface RecordedCall {
  readonly action: string;
  readonly args: readonly unknown[];
}

function makeActions(calls: RecordedCall[]): SidebarCommandActions {
  const record =
    (action: string) =>
    (...args: unknown[]): void => {
      calls.push({ action, args });
    };
  return {
    openFolderInFileManager: record('openFolderInFileManager'),
    openFolderWith: record('openFolderWith'),
    createSubfolder: record('createSubfolder'),
    renameFolder: record('renameFolder'),
    openLinkedRules: record('openLinkedRules'),
    copyFolderPath: record('copyFolderPath'),
    copyFolder: record('copyFolder'),
    pasteIntoFolder: record('pasteIntoFolder'),
    cloneFolder: record('cloneFolder'),
    moveFolder: record('moveFolder'),
    trashManagedFolder: record('trashManagedFolder'),
    deleteFolderFromDisk: record('deleteFolderFromDisk'),
    removeLinkedFolder: record('removeLinkedFolder'),
    trashLinkedFolderSubtree: record('trashLinkedFolderSubtree'),
    renameOrganization: record('renameOrganization'),
    editCollectionDetails: record('editCollectionDetails'),
    deleteOrganization: record('deleteOrganization'),
    renameSmartCollection: record('renameSmartCollection'),
    updateSmartCollection: record('updateSmartCollection'),
    deleteSmartCollection: record('deleteSmartCollection'),
  };
}

function makeCtx(
  overrides: Partial<SidebarCommandContext> = {},
): { ctx: SidebarCommandContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const ctx: SidebarCommandContext = {
    surface: 'sidebar',
    platform: 'mac',
    locale: 'zh-CN',
    selectedAssetIds: [],
    primaryAssetId: null,
    assetScope: 'none',
    trashMode: false,
    menuKind: 'folder',
    subjectId: 'folder-1',
    subjectName: '素材',
    locationKind: 'managed',
    status: undefined,
    linkedFolderResolved: false,
    actions: makeActions(calls),
    ...overrides,
  };
  return { ctx, calls };
}

function resolveIds(ctx: SidebarCommandContext): string[] {
  return registry.resolveMenu(ctx).map((item) => item.id);
}

function findItem(
  menu: readonly ResolvedMenuItem[],
  id: string,
): ResolvedMenuItem {
  const item = menu.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`expected menu to contain "${id}"`);
  return item;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('文件夹分支：可见性矩阵（与历史内联 JSX 条件一致）', () => {
  it('managed：open / create / rename / copy-paste-clone-move / trash 可见', () => {
    const { ctx } = makeCtx();
    expect(resolveIds(ctx)).toEqual([
      'folder.open-in-file-manager',
      'folder.open-with',
      'folder.create-subfolder',
      'folder.rename',
      'folder.copy-path',
      'folder.copy',
      'folder.paste',
      'folder.clone',
      'folder.move-to',
      'folder.move-to-trash',
      'folder.delete-from-disk',
    ]);
  });

  it('linked 根：linked-rules + remove-from-library 可见，无 trash / disk-delete', () => {
    const { ctx } = makeCtx({
      locationKind: 'linked',
      status: 'available',
      linkedFolderResolved: true,
      linkedFolder: LINKED_FOLDER,
      isLinkedRoot: true,
    });
    expect(resolveIds(ctx)).toEqual([
      'folder.open-in-file-manager',
      'folder.open-with',
      'folder.linked-rules',
      'folder.copy-path',
      'folder.copy',
      'folder.remove-from-library',
    ]);
  });

  it('linked 子文件夹：trash / disk-delete 可见，无 remove-from-library', () => {
    const { ctx } = makeCtx({
      locationKind: 'linked',
      status: 'available',
      linkedFolderResolved: true,
      linkedFolder: LINKED_FOLDER,
      isLinkedRoot: false,
      linkedRelativePath: 'props/wood',
    });
    expect(resolveIds(ctx)).toEqual([
      'folder.open-in-file-manager',
      'folder.open-with',
      'folder.linked-rules',
      'folder.copy-path',
      'folder.copy',
      'folder.move-to-trash',
      'folder.delete-from-disk',
    ]);
  });

  it('linked 但未解析出摘要：linked-rules 隐藏（对应历史 linkedFolder && 条件）', () => {
    const { ctx } = makeCtx({
      locationKind: 'linked',
      status: 'available',
      linkedFolderResolved: false,
      isLinkedRoot: true,
    });
    expect(resolveIds(ctx)).toEqual([
      'folder.open-in-file-manager',
      'folder.open-with',
      'folder.copy-path',
      'folder.copy',
      'folder.remove-from-library',
    ]);
  });

  it('linked + offline：open / copy-path 保持可见但以统一原因禁用', () => {
    const { ctx } = makeCtx({
      locationKind: 'linked',
      status: 'offline',
      linkedFolderResolved: true,
      linkedFolder: { ...LINKED_FOLDER, status: 'offline' },
      isLinkedRoot: true,
    });
    const menu = registry.resolveMenu(ctx);
    expect(resolveIds(ctx)).toEqual([
      'folder.open-in-file-manager',
      'folder.open-with',
      'folder.linked-rules',
      'folder.copy-path',
      'folder.copy',
      'folder.remove-from-library',
    ]);
    for (const id of [
      'folder.open-in-file-manager',
      'folder.open-with',
      'folder.copy-path',
      'folder.copy',
    ]) {
      expect(findItem(menu, id)).toMatchObject({
        disabled: true,
        disabledReason: '链接文件夹当前离线',
      });
    }
  });

  it('linked + available：open / copy-path 启用（无禁用原因）', () => {
    const { ctx } = makeCtx({
      locationKind: 'linked',
      status: 'available',
      linkedFolderResolved: true,
      linkedFolder: LINKED_FOLDER,
      isLinkedRoot: true,
    });
    const menu = registry.resolveMenu(ctx);
    for (const item of menu) {
      expect(item.disabled, item.id).toBe(false);
      expect(item.disabledReason, item.id).toBeNull();
    }
  });

  it('managed 即使携带 status 也不触发离线禁用（离线语义仅属链接文件夹）', () => {
    const { ctx } = makeCtx({ locationKind: 'managed', status: 'offline' });
    const menu = registry.resolveMenu(ctx);
    for (const item of menu) {
      expect(item.disabled, item.id).toBe(false);
    }
  });
});

describe('文件夹分支：快捷键展示（Serpent-vf8x）', () => {
  it('managed 菜单显示新建/重命名/回收站平台标签', () => {
    const mac = makeCtx({ platform: 'mac' });
    const macMenu = registry.resolveMenu(mac.ctx);
    expect(findItem(macMenu, 'folder.create-subfolder').shortcutLabel).toBe(
      '⌘⇧N',
    );
    expect(findItem(macMenu, 'folder.rename').shortcutLabel).toBe('F2');
    expect(findItem(macMenu, 'folder.move-to-trash').shortcutLabel).toBe(
      '⌘⌫',
    );

    const win = makeCtx({ platform: 'windows' });
    const winMenu = registry.resolveMenu(win.ctx);
    expect(findItem(winMenu, 'folder.create-subfolder').shortcutLabel).toBe(
      'Ctrl+Shift+N',
    );
    expect(findItem(winMenu, 'folder.rename').shortcutLabel).toBe('F2');
    expect(findItem(winMenu, 'folder.move-to-trash').shortcutLabel).toBe(
      'Delete',
    );
  });
});

describe('文件夹分支：平台条件标题', () => {
  it('mac → 在 Finder 中打开；windows → 在文件资源管理器中打开', () => {
    const mac = makeCtx({ platform: 'mac' });
    expect(
      findItem(registry.resolveMenu(mac.ctx), 'folder.open-in-file-manager')
        .label,
    ).toBe('在 Finder 中打开');
    const windows = makeCtx({ platform: 'windows' });
    expect(
      findItem(
        registry.resolveMenu(windows.ctx),
        'folder.open-in-file-manager',
      ).label,
    ).toBe('在文件资源管理器中打开');
  });

  it.each([
    ['folder.create-subfolder', '新建子文件夹'],
    ['folder.rename', '重命名…'],
    ['folder.copy-path', '复制文件夹路径'],
    ['folder.copy', '复制'],
    ['folder.paste', '粘贴'],
    ['folder.clone', '克隆'],
    ['folder.move-to', '移动到…'],
  ] as const)('%s 标题为「%s」（与历史渲染一致）', (id, expected) => {
    const { ctx } = makeCtx();
    expect(findItem(registry.resolveMenu(ctx), id).label).toBe(expected);
  });

  it('folder.linked-rules 标题为「链接规则…」', () => {
    const { ctx } = makeCtx({
      locationKind: 'linked',
      linkedFolderResolved: true,
      linkedFolder: LINKED_FOLDER,
    });
    expect(
      findItem(registry.resolveMenu(ctx), 'folder.linked-rules').label,
    ).toBe('链接规则…');
  });
});

describe('合集 / 智能合集分支：三项恒可见且恒启用', () => {
  it('organization：rename / edit-details / delete 全部可见、全部启用', () => {
    const { ctx } = makeCtx({
      menuKind: 'organization',
      subjectId: 'col-1',
      subjectName: '年度合集',
      locationKind: undefined,
    });
    const menu = registry.resolveMenu(ctx);
    expect(menu.map((item) => item.id)).toEqual([
      'collection.rename',
      'collection.edit-details',
      'collection.delete',
    ]);
    expect(menu.map((item) => item.label)).toEqual([
      '重命名合集',
      '编辑合集详情',
      '删除合集',
    ]);
    for (const item of menu) {
      expect(item.disabled, item.id).toBe(false);
      expect(item.disabledReason, item.id).toBeNull();
    }
  });

  it('smart-collection：rename / update-query / delete 全部可见、全部启用', () => {
    const { ctx } = makeCtx({
      menuKind: 'smart-collection',
      subjectId: 'smart-1',
      subjectName: '我的智能合集',
      locationKind: undefined,
    });
    const menu = registry.resolveMenu(ctx);
    expect(menu.map((item) => item.id)).toEqual([
      'smart-collection.rename',
      'smart-collection.update-query',
      'smart-collection.delete',
    ]);
    expect(menu.map((item) => item.label)).toEqual([
      '重命名智能合集',
      '用当前条件更新',
      '删除智能合集',
    ]);
    for (const item of menu) {
      expect(item.disabled, item.id).toBe(false);
      expect(item.disabledReason, item.id).toBeNull();
    }
  });

  it('menuKind 互斥：合集上下文不出现文件夹 / 智能合集项', () => {
    const { ctx } = makeCtx({
      menuKind: 'organization',
      locationKind: 'managed',
    });
    const ids = resolveIds(ctx);
    expect(ids.some((id) => id.startsWith('folder.'))).toBe(false);
    expect(ids.some((id) => id.startsWith('smart-collection.'))).toBe(false);
  });
});

describe('danger 处理：注册表核心无 danger 字段，红色样式留在 JSX', () => {
  it('删除项的解析结果不携带 danger（与 0015-B/C 相同，JSX 按历史位置声明）', () => {
    const { ctx } = makeCtx({
      menuKind: 'organization',
      locationKind: undefined,
    });
    const menu = registry.resolveMenu(ctx);
    for (const item of menu) {
      expect('danger' in item, item.id).toBe(false);
    }
  });
});

describe('run 委托到 actions 回调包', () => {
  it.each([
    [
      'folder.open-in-file-manager',
      {},
      'openFolderInFileManager',
      ['folder-1'],
    ],
    [
      'folder.open-with',
      {},
      'openFolderWith',
      ['folder-1'],
    ],
    ['folder.create-subfolder', {}, 'createSubfolder', ['folder-1']],
    ['folder.rename', {}, 'renameFolder', ['folder-1', '素材']],
    ['folder.copy-path', {}, 'copyFolderPath', ['folder-1']],
    ['folder.copy', {}, 'copyFolder', ['folder-1']],
    ['folder.paste', {}, 'pasteIntoFolder', ['folder-1']],
    ['folder.clone', {}, 'cloneFolder', ['folder-1']],
    ['folder.move-to', {}, 'moveFolder', [['folder-1']]],
    [
      'folder.move-to-trash',
      {},
      'trashManagedFolder',
      ['folder-1', '素材'],
    ],
    [
      'folder.delete-from-disk',
      {},
      'deleteFolderFromDisk',
      ['folder-1', '素材'],
    ],
    [
      'folder.remove-from-library',
      {
        locationKind: 'linked',
        isLinkedRoot: true,
        linkedFolderResolved: true,
        linkedFolder: LINKED_FOLDER,
      },
      'removeLinkedFolder',
      ['folder-1', '素材'],
    ],
    [
      'collection.rename',
      { menuKind: 'organization', subjectId: 'col-1', subjectName: '年度合集' },
      'renameOrganization',
      ['col-1', '年度合集'],
    ],
    [
      'collection.edit-details',
      { menuKind: 'organization', subjectId: 'col-1', subjectName: '年度合集' },
      'editCollectionDetails',
      ['col-1'],
    ],
    [
      'smart-collection.rename',
      {
        menuKind: 'smart-collection',
        subjectId: 'smart-1',
        subjectName: '我的智能合集',
      },
      'renameSmartCollection',
      ['smart-1', '我的智能合集'],
    ],
    [
      'smart-collection.update-query',
      {
        menuKind: 'smart-collection',
        subjectId: 'smart-1',
        subjectName: '我的智能合集',
      },
      'updateSmartCollection',
      ['smart-1'],
    ],
  ] as const)(
    '%s 以 subjectId/subjectName 转调 %s',
    (id, overrides, expectedAction, expectedArgs) => {
      const { ctx, calls } = makeCtx(overrides);
      const def = registry.get(id);
      expect(def).toBeDefined();
      void def?.run(ctx);
      expect(calls).toEqual([{ action: expectedAction, args: expectedArgs }]);
    },
  );

  it('folder.linked-rules 把 ctx.linkedFolder 原样透传给 openLinkedRules', () => {
    const { ctx, calls } = makeCtx({
      locationKind: 'linked',
      linkedFolderResolved: true,
      linkedFolder: LINKED_FOLDER,
    });
    void registry.get('folder.linked-rules')?.run(ctx);
    expect(calls).toEqual([
      { action: 'openLinkedRules', args: [LINKED_FOLDER] },
    ]);
  });

  it('folder.linked-rules 在 linkedFolder 缺失时落空（防御；visible 已先行拦截）', () => {
    const { ctx, calls } = makeCtx({
      locationKind: 'linked',
      linkedFolderResolved: false,
    });
    void registry.get('folder.linked-rules')?.run(ctx);
    expect(calls).toEqual([]);
  });
});

describe('删除确认：window.confirm 保留在 run 内', () => {
  it('collection.delete：confirm 通过 → 删除；文案与历史一致', () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('window', { confirm });
    const { ctx, calls } = makeCtx({
      menuKind: 'organization',
      subjectId: 'col-1',
      subjectName: '年度合集',
      locationKind: undefined,
    });
    void registry.get('collection.delete')?.run(ctx);
    expect(confirm).toHaveBeenCalledWith(
      '删除合集"年度合集"？\n（仅删除合集结构，不删除资产）',
    );
    expect(calls).toEqual([
      { action: 'deleteOrganization', args: ['col-1', '年度合集'] },
    ]);
  });

  it('collection.delete：confirm 取消 → 不调用任何 action', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    const { ctx, calls } = makeCtx({
      menuKind: 'organization',
      subjectId: 'col-1',
      subjectName: '年度合集',
      locationKind: undefined,
    });
    void registry.get('collection.delete')?.run(ctx);
    expect(calls).toEqual([]);
  });

  it('smart-collection.delete：confirm 通过 → 删除；文案与历史一致', () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('window', { confirm });
    const { ctx, calls } = makeCtx({
      menuKind: 'smart-collection',
      subjectId: 'smart-1',
      subjectName: '我的智能合集',
      locationKind: undefined,
    });
    void registry.get('smart-collection.delete')?.run(ctx);
    expect(confirm).toHaveBeenCalledWith('删除智能合集"我的智能合集"？');
    expect(calls).toEqual([
      { action: 'deleteSmartCollection', args: ['smart-1', '我的智能合集'] },
    ]);
  });

  it('smart-collection.delete：confirm 取消 → 不调用任何 action', () => {
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    const { ctx, calls } = makeCtx({
      menuKind: 'smart-collection',
      subjectId: 'smart-1',
      subjectName: '我的智能合集',
      locationKind: undefined,
    });
    void registry.get('smart-collection.delete')?.run(ctx);
    expect(calls).toEqual([]);
  });
});

describe('注册表完整性', () => {
  it('19 条定义全部注册且 id 唯一（createCommandRegistry 未抛错）', () => {
    expect(registry.list().map((def) => def.id)).toEqual([
      'folder.open-in-file-manager',
      'folder.open-with',
      'folder.create-subfolder',
      'folder.rename',
      'folder.linked-rules',
      'folder.copy-path',
      'folder.copy',
      'folder.paste',
      'folder.clone',
      'folder.move-to',
      'folder.move-to-trash',
      'folder.delete-from-disk',
      'folder.remove-from-library',
      'collection.rename',
      'collection.edit-details',
      'collection.delete',
      'smart-collection.rename',
      'smart-collection.update-query',
      'smart-collection.delete',
    ]);
  });

  it('文件夹分支解析结果按 open → organize → delete 组序排列', () => {
    const { ctx } = makeCtx();
    const groups = registry.resolveMenu(ctx).map((item) => item.group);
    expect(groups).toEqual([
      'open',
      'open',
      'organize',
      'organize',
      'organize',
      'organize',
      'organize',
      'organize',
      'organize',
      'delete',
      'delete',
    ]);
  });
});
