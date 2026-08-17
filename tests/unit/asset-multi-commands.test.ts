import { describe, expect, it } from 'vitest';

import {
  assetMultiCommandDefinitions,
  type AssetMultiCommandActions,
  type AssetMultiCommandContext,
} from '../../src/renderer/commands/asset-multi-commands';
import { createCommandRegistry } from '../../src/renderer/commands/command-registry';
import type { ResolvedMenuItem } from '../../src/renderer/commands/command-types';

// REQ-COMMAND-001 / 切片 0015-C：多资产右键菜单定义的等价性验证。
// 每条规则对照 0015-C 之前 AssetContextMenu 多资产分支的内联 JSX 条件；
// 纯数据，node 环境。菜单按 id 取解析结果，JSX 负责视觉位置，因此这里的
// 顺序断言只反映组序，不代表渲染顺序。

const registry = createCommandRegistry(assetMultiCommandDefinitions);

interface RecordedCall {
  readonly action: string;
  readonly args: readonly unknown[];
}

function makeActions(calls: RecordedCall[]): AssetMultiCommandActions {
  const record =
    (action: string) =>
    (...args: unknown[]): void => {
      calls.push({ action, args });
    };
  return {
    openAssignTagPicker: record('openAssignTagPicker'),
    openRemoveTagPicker: record('openRemoveTagPicker'),
    copyFiles: record('copyFiles'),
    pasteIntoFolder: record('pasteIntoFolder'),
    moveToFolder: record('moveToFolder'),
    moveToTrash: record('moveToTrash'),
    deleteFromDisk: record('deleteFromDisk'),
    restore: record('restore'),
    deletePermanent: record('deletePermanent'),
    aiAnalyze: record('aiAnalyze'),
    clearAiContent: record('clearAiContent'),
    clearSelection: record('clearSelection'),
  };
}

// 默认场景：选中 3 项 = 2 项托管（1 可用 1 不可用）+ 1 项链接。
function makeCtx(
  overrides: Partial<AssetMultiCommandContext> = {},
): { ctx: AssetMultiCommandContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const ctx: AssetMultiCommandContext = {
    surface: 'asset-multi',
    platform: 'mac',
    locale: 'zh-CN',
    selectedAssetIds: ['a-1', 'a-2', 'a-3'],
    primaryAssetId: null,
    assetScope: 'multi',
    trashMode: false,
    selectionCount: 3,
    managedCount: 2,
    availableManagedCount: 1,
    linkedCount: 1,
    linkedAssetIds: ['a-3'],
    folderCount: 0,
    processFolderIds: [],
    trashedAll: false,
    managedAssetIds: ['a-1', 'a-2'],
    availableManagedAssetIds: ['a-1'],
    availableAssetIds: ['a-1', 'a-3'],
    aiPendingAssetIds: [],
    pasteTargetFolderId: 'folder-1',
    actions: makeActions(calls),
    ...overrides,
  };
  return { ctx, calls };
}

function makeTrashedCtx(
  overrides: Partial<AssetMultiCommandContext> = {},
): { ctx: AssetMultiCommandContext; calls: RecordedCall[] } {
  return makeCtx({ trashMode: true, trashedAll: true, ...overrides });
}

function resolveIds(ctx: AssetMultiCommandContext): string[] {
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

describe('可见性（与历史内联 JSX 条件一致）', () => {
  it('正常分支：批量标签/移动/回收站/清除选择可见，回收站两项隐藏', () => {
    const { ctx } = makeCtx();
    expect(resolveIds(ctx)).toEqual([
      'assets.copy',
      'assets.paste',
      'assets.move-to-folder',
      'assets.assign-tag',
      'assets.remove-tag',
      'assets.ai-analyze',
      'assets.clear-ai-content',
      'assets.move-to-trash',
      'assets.delete-from-disk',
      'assets.clear-selection',
    ]);
  });

  it('回收站分支（trashedAll）：仅恢复/永久删除/清除选择可见', () => {
    const { ctx } = makeTrashedCtx();
    expect(resolveIds(ctx)).toEqual([
      'assets.restore',
      'assets.delete-permanent',
      'assets.clear-selection',
    ]);
  });

  it.each([false, true] as const)(
    '清除选择始终可见（trashedAll=%s）',
    (trashedAll) => {
      const { ctx } = makeCtx({ trashedAll, trashMode: trashedAll });
      expect(resolveIds(ctx)).toContain('assets.clear-selection');
    },
  );

  it('计数为 0 不影响可见性（禁用由 disabledReason 表达）', () => {
    const { ctx } = makeCtx({
      managedCount: 0,
      availableManagedCount: 0,
      managedAssetIds: [],
      availableManagedAssetIds: [],
    });
    expect(resolveIds(ctx)).toContain('assets.move-to-folder');
    expect(resolveIds(ctx)).toContain('assets.move-to-trash');
  });
});

describe('内嵌计数标题（与历史渲染一致）', () => {
  it.each([
    ['assets.assign-tag', '添加标签…'],
    ['assets.remove-tag', '移除标签…'],
    ['assets.copy', '复制（2 项）'],
    ['assets.paste', '粘贴'],
    ['assets.move-to-folder', '移动到文件夹…（1 项）'],
    ['assets.move-to-trash', '移入回收站（3 项）'],
    ['assets.clear-selection', '清除选择（3 项）'],
  ] as const)('正常分支 %s 标题为「%s」', (id, expected) => {
    const { ctx } = makeCtx();
    expect(findItem(registry.resolveMenu(ctx), id).label).toBe(expected);
  });

  it.each([
    ['assets.restore', '恢复所选（3 项）'],
    ['assets.delete-permanent', '永久删除（3 项）'],
    ['assets.clear-selection', '清除选择（3 项）'],
  ] as const)('回收站分支 %s 标题为「%s」', (id, expected) => {
    const { ctx } = makeTrashedCtx();
    expect(findItem(registry.resolveMenu(ctx), id).label).toBe(expected);
  });

  it.each([
    [{ selectionCount: 5 }, 'assets.restore', '恢复所选（5 项）'],
    [{ selectionCount: 5 }, 'assets.delete-permanent', '永久删除（5 项）'],
    [{ selectionCount: 5 }, 'assets.clear-selection', '清除选择（5 项）'],
    [{ managedCount: 7, linkedCount: 0, linkedAssetIds: [] }, 'assets.move-to-trash', '移入回收站（7 项）'],
    [
      { availableManagedCount: 4 },
      'assets.move-to-folder',
      '移动到文件夹…（4 项）',
    ],
    [{ availableManagedCount: 0 }, 'assets.move-to-folder', '移动到文件夹…（0 项）'],
    [{ managedCount: 0, linkedCount: 0, linkedAssetIds: [] }, 'assets.move-to-trash', '移入回收站（0 项）'],
  ] as const)(
    '计数随 ctx 变化：%o → %s =「%s」',
    (overrides, id, expected) => {
      const trashed =
        id === 'assets.restore' || id === 'assets.delete-permanent';
      const { ctx } = makeCtx({
        ...(overrides as Partial<AssetMultiCommandContext>),
        trashedAll: trashed,
        trashMode: trashed,
      });
      expect(findItem(registry.resolveMenu(ctx), id).label).toBe(expected);
    },
  );
});

describe('禁用原因（disabledReason 是唯一禁用来源）', () => {
  it('move-to-folder：可用托管为 0 时禁用并给出原因', () => {
    const { ctx } = makeCtx({
      availableManagedCount: 0,
      availableManagedAssetIds: [],
    });
    expect(
      findItem(registry.resolveMenu(ctx), 'assets.move-to-folder'),
    ).toMatchObject({
      disabled: true,
      disabledReason: '所选资产中没有可移动的托管资产',
    });
  });

  it('move-to-folder：可用托管 > 0 时启用', () => {
    const { ctx } = makeCtx();
    expect(
      findItem(registry.resolveMenu(ctx), 'assets.move-to-folder'),
    ).toMatchObject({ disabled: false, disabledReason: null });
  });

  it('move-to-trash：托管与链接均为 0 时禁用并给出原因', () => {
    const { ctx } = makeCtx({
      managedCount: 0,
      managedAssetIds: [],
      linkedCount: 0,
      linkedAssetIds: [],
    });
    expect(
      findItem(registry.resolveMenu(ctx), 'assets.move-to-trash'),
    ).toMatchObject({
      disabled: true,
      disabledReason: '所选资产中没有托管资产',
    });
  });

  it('move-to-trash：托管 > 0 时启用（含不可用托管，与原内联条件一致）', () => {
    const { ctx } = makeCtx({ availableManagedCount: 0 });
    expect(
      findItem(registry.resolveMenu(ctx), 'assets.move-to-trash'),
    ).toMatchObject({ disabled: false, disabledReason: null });
  });

  it('其余静态项始终启用', () => {
    for (const make of [makeCtx, makeTrashedCtx]) {
      const { ctx } = make();
      const menu = registry.resolveMenu(ctx);
      for (const id of [
        'assets.assign-tag',
        'assets.remove-tag',
        'assets.restore',
        'assets.delete-permanent',
        'assets.clear-selection',
      ]) {
        const item = menu.find((candidate) => candidate.id === id);
        if (!item) continue;
        expect(item.disabled, `${id} (trashedAll=${ctx.trashedAll})`).toBe(
          false,
        );
        expect(
          item.disabledReason,
          `${id} (trashedAll=${ctx.trashedAll})`,
        ).toBeNull();
      }
    }
  });
});

describe('快捷键标签按平台解析', () => {
  it.each([
    ['mac', '⌘⌫'],
    ['windows', 'Delete'],
  ] as const)('assets.move-to-trash 在 %s 显示「%s」', (platform, expected) => {
    const { ctx } = makeCtx({ platform });
    expect(
      findItem(registry.resolveMenu(ctx), 'assets.move-to-trash').shortcutLabel,
    ).toBe(expected);
  });

  it('未声明快捷键的项 shortcutLabel 为 null', () => {
    const { ctx } = makeCtx();
    const menu = registry.resolveMenu(ctx);
    for (const id of [
      'assets.assign-tag',
      'assets.remove-tag',
      'assets.move-to-folder',
      'assets.clear-selection',
    ]) {
      expect(findItem(menu, id).shortcutLabel, id).toBeNull();
    }
    const { ctx: trashedCtx } = makeTrashedCtx();
    const trashedMenu = registry.resolveMenu(trashedCtx);
    for (const id of ['assets.restore', 'assets.delete-permanent']) {
      expect(findItem(trashedMenu, id).shortcutLabel, id).toBeNull();
    }
  });
});

describe('run 委托到 actions 回调包', () => {
  it.each([
    [
      'assets.restore',
      { trashedAll: true, trashMode: true },
      'restore',
      [['a-1', 'a-2', 'a-3']],
    ],
    [
      'assets.delete-permanent',
      { trashedAll: true, trashMode: true },
      'deletePermanent',
      [['a-1', 'a-2', 'a-3']],
    ],
    [
      'assets.assign-tag',
      {},
      'openAssignTagPicker',
      [['a-1', 'a-2', 'a-3']],
    ],
    [
      'assets.remove-tag',
      {},
      'openRemoveTagPicker',
      [['a-1', 'a-2', 'a-3']],
    ],
    ['assets.copy', {}, 'copyFiles', [['a-1', 'a-3']]],
    ['assets.paste', {}, 'pasteIntoFolder', ['folder-1']],
    ['assets.move-to-folder', {}, 'moveToFolder', [['a-1'], []]],
    ['assets.move-to-trash', {}, 'moveToTrash', [['a-1', 'a-2', 'a-3'], []]],
    ['assets.delete-from-disk', {}, 'deleteFromDisk', [['a-1', 'a-2'], []]],
    ['assets.clear-selection', {}, 'clearSelection', []],
  ] as const)(
    '%s 转调 %s（操作对象与原内联 onAction 一致）',
    (id, overrides, expectedAction, expectedArgs) => {
      const { ctx, calls } = makeCtx(overrides);
      const def = registry.get(id);
      expect(def).toBeDefined();
      void def?.run(ctx);
      expect(calls).toEqual([{ action: expectedAction, args: expectedArgs }]);
    },
  );

  it('move-to-folder 只传可用托管 id，move-to-trash 传托管与链接 id', () => {
    const { ctx, calls } = makeCtx({
      managedAssetIds: ['m-1', 'm-2', 'm-3'],
      availableManagedAssetIds: ['m-2'],
      linkedAssetIds: ['l-1'],
      linkedCount: 1,
    });
    void registry.get('assets.move-to-folder')?.run(ctx);
    void registry.get('assets.move-to-trash')?.run(ctx);
    expect(calls).toEqual([
      { action: 'moveToFolder', args: [['m-2'], []] },
      { action: 'moveToTrash', args: [['m-1', 'm-2', 'm-3', 'l-1'], []] },
    ]);
  });

  it('trash/disk-delete counts and payload include selected folder cards', () => {
    const { ctx, calls } = makeCtx({
      folderCount: 2,
      processFolderIds: ['f-1', 'f-2'],
      managedCount: 1,
      managedAssetIds: ['a-1'],
      linkedCount: 0,
      linkedAssetIds: [],
    });
    const trash = findItem(registry.resolveMenu(ctx), 'assets.move-to-trash');
    expect(trash.label).toContain('3');
    void registry.get('assets.move-to-trash')?.run(ctx);
    void registry.get('assets.delete-from-disk')?.run(ctx);
    expect(calls).toEqual([
      { action: 'moveToTrash', args: [['a-1'], ['f-1', 'f-2']] },
      { action: 'deleteFromDisk', args: [['a-1'], ['f-1', 'f-2']] },
    ]);
  });
});

describe('注册表完整性', () => {
  it('12 条定义全部注册且 id 唯一（createCommandRegistry 未抛错）', () => {
    expect(registry.list().map((def) => def.id)).toEqual([
      'assets.restore',
      'assets.delete-permanent',
      'assets.assign-tag',
      'assets.remove-tag',
      'assets.ai-analyze-pending',
      'assets.ai-analyze',
      'assets.clear-ai-content',
      'assets.copy',
      'assets.paste',
      'assets.move-to-folder',
      'assets.move-to-trash',
      'assets.delete-from-disk',
      'assets.clear-selection',
    ]);
  });

  it('解析结果按 open → organize → metadata → delete 组序排列', () => {
    const { ctx } = makeCtx();
    const groups = registry.resolveMenu(ctx).map((item) => item.group);
    expect(groups).toEqual([
      'organize',
      'organize',
      'organize',
      'metadata',
      'metadata',
      'metadata',
      'metadata',
      'delete',
      'delete',
      'delete',
    ]);
  });

  it('AI分析未分析项：有 pending 时可见且排在 ai-analyze 前，run 只传 pending id', () => {
    const { ctx, calls } = makeCtx({
      aiPendingAssetIds: ['a-1'],
    });
    const ids = resolveIds(ctx);
    const pendingIndex = ids.indexOf('assets.ai-analyze-pending');
    const analyzeIndex = ids.indexOf('assets.ai-analyze');
    expect(pendingIndex).toBeGreaterThanOrEqual(0);
    expect(pendingIndex).toBeLessThan(analyzeIndex);
    const def = registry.get('assets.ai-analyze-pending');
    expect(def).toBeDefined();
    void def?.run(ctx);
    expect(calls).toEqual([
      { action: 'aiAnalyze', args: [['a-1']] },
    ]);
  });

  it('AI分析未分析项：无 pending 时不可见，不干扰普通 AI 分析', () => {
    const { ctx } = makeCtx();
    expect(resolveIds(ctx)).not.toContain('assets.ai-analyze-pending');
  });
});
