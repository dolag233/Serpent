import { describe, expect, it } from 'vitest';

import {
  assetCommandDefinitions,
  type AssetCommandActions,
  type AssetCommandContext,
} from '../../src/renderer/commands/asset-commands';
import { createCommandRegistry } from '../../src/renderer/commands/command-registry';
import type { ResolvedMenuItem } from '../../src/renderer/commands/command-types';

// REQ-COMMAND-001 / 切片 0015-B：单资产右键菜单定义的等价性验证。
// 每条规则对照 0015-B 之前 AssetContextMenu 的内联 JSX 条件；纯数据，node 环境。

const registry = createCommandRegistry(assetCommandDefinitions);

interface RecordedCall {
  readonly action: string;
  readonly args: readonly unknown[];
}

function makeActions(calls: RecordedCall[]): AssetCommandActions {
  const record =
    (action: string) =>
    (...args: unknown[]): void => {
      calls.push({ action, args });
    };
  return {
    view: record('view'),
    openExternal: record('openExternal'),
    revealInFolder: record('revealInFolder'),
    copyFilePath: record('copyFilePath'),
    rename: record('rename'),
    aiAnalyze: record('aiAnalyze'),
    moveToTrash: record('moveToTrash'),
    moveToFolder: record('moveToFolder'),
    relink: record('relink'),
    restore: record('restore'),
    deletePermanent: record('deletePermanent'),
    deleteLinked: record('deleteLinked'),
    removeFromCurrentCollection: record('removeFromCurrentCollection'),
  };
}

function makeCtx(
  overrides: Partial<AssetCommandContext> = {},
): { ctx: AssetCommandContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const ctx: AssetCommandContext = {
    surface: 'asset-single',
    platform: 'mac',
    locale: 'zh-CN',
    selectedAssetIds: ['asset-1'],
    primaryAssetId: 'asset-1',
    assetScope: 'single',
    trashMode: false,
    locationKind: 'managed',
    assetAvailable: true,
    assetDeleted: false,
    activeCollectionId: null,
    aiCanAnalyze: true,
    assetDisplayName: '示例.png',
    actions: makeActions(calls),
    ...overrides,
  };
  return { ctx, calls };
}

function resolveIds(ctx: AssetCommandContext): string[] {
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
  it('managed + available：常规项全部可见，relink / delete-linked / 回收站项隐藏', () => {
    const { ctx } = makeCtx();
    expect(resolveIds(ctx)).toEqual([
      'asset.view',
      'asset.open-external',
      'asset.reveal-in-folder',
      'asset.move-to-folder',
      'asset.copy-file-path',
      'asset.rename',
      'asset.ai-analyze',
      'asset.clear-ai-content',
      'asset.move-to-trash',
    ]);
  });

  it('managed + unavailable：relink 可见，move-to-folder 隐藏，其余常规项保留', () => {
    const { ctx } = makeCtx({ assetAvailable: false });
    expect(resolveIds(ctx)).toEqual([
      'asset.view',
      'asset.open-external',
      'asset.reveal-in-folder',
      'asset.relink',
      'asset.copy-file-path',
      'asset.rename',
      'asset.ai-analyze',
      'asset.clear-ai-content',
      'asset.move-to-trash',
    ]);
  });

  it('linked + available：delete-linked 可见，move-to-folder / move-to-trash / relink 隐藏', () => {
    const { ctx } = makeCtx({ locationKind: 'linked' });
    expect(resolveIds(ctx)).toEqual([
      'asset.view',
      'asset.open-external',
      'asset.reveal-in-folder',
      'asset.copy-file-path',
      'asset.rename',
      'asset.ai-analyze',
      'asset.clear-ai-content',
      'asset.delete-linked',
    ]);
  });

  it('linked + unavailable：delete-linked 仍可见，relink / move-to-folder 隐藏', () => {
    const { ctx } = makeCtx({ locationKind: 'linked', assetAvailable: false });
    expect(resolveIds(ctx)).toEqual([
      'asset.view',
      'asset.open-external',
      'asset.reveal-in-folder',
      'asset.copy-file-path',
      'asset.rename',
      'asset.ai-analyze',
      'asset.clear-ai-content',
      'asset.delete-linked',
    ]);
  });

  it.each([
    ['managed', 'managed'],
    ['linked', 'linked'],
  ] as const)('deleted（%s）：仅回收站两项可见，常规项全部隐藏', (_label, locationKind) => {
    const { ctx } = makeCtx({ assetDeleted: true, locationKind });
    expect(resolveIds(ctx)).toEqual([
      'asset.restore',
      'asset.delete-permanent',
    ]);
  });

  it('activeCollectionId 控制 remove-from-current-collection，且排在组织组首位', () => {
    const withCollection = makeCtx({ activeCollectionId: 'col-1' });
    expect(resolveIds(withCollection.ctx)).toEqual([
      'asset.view',
      'asset.open-external',
      'asset.reveal-in-folder',
      'asset.remove-from-current-collection',
      'asset.move-to-folder',
      'asset.copy-file-path',
      'asset.rename',
      'asset.ai-analyze',
      'asset.clear-ai-content',
      'asset.move-to-trash',
    ]);
    const without = makeCtx({ activeCollectionId: null });
    expect(resolveIds(without.ctx)).not.toContain(
      'asset.remove-from-current-collection',
    );
  });

  it('deleted 时即使 activeCollectionId 存在也不显示常规项', () => {
    const { ctx } = makeCtx({
      assetDeleted: true,
      activeCollectionId: 'col-1',
    });
    expect(resolveIds(ctx)).toEqual([
      'asset.restore',
      'asset.delete-permanent',
    ]);
  });
});

describe('禁用原因（disabledReason 是唯一禁用来源）', () => {
  it('managed + available：所有可见项均启用', () => {
    const { ctx } = makeCtx({ activeCollectionId: 'col-1' });
    for (const item of registry.resolveMenu(ctx)) {
      expect(item.disabled, item.id).toBe(false);
      expect(item.disabledReason, item.id).toBeNull();
    }
  });

  it('managed + unavailable：文件操作禁用并给出统一原因', () => {
    const { ctx } = makeCtx({ assetAvailable: false });
    const menu = registry.resolveMenu(ctx);
    for (const id of [
      'asset.open-external',
      'asset.reveal-in-folder',
      'asset.copy-file-path',
      'asset.rename',
    ]) {
      expect(findItem(menu, id)).toMatchObject({
        disabled: true,
        disabledReason: '资产当前不可用',
      });
    }
  });

  it('managed + unavailable：move-to-trash 使用专属原因，relink 保持启用', () => {
    const { ctx } = makeCtx({ assetAvailable: false });
    const menu = registry.resolveMenu(ctx);
    expect(findItem(menu, 'asset.move-to-trash')).toMatchObject({
      disabled: true,
      disabledReason: '托管资产当前不可用，无法移入回收站',
    });
    expect(findItem(menu, 'asset.relink')).toMatchObject({
      disabled: false,
      disabledReason: null,
    });
  });

  it('linked + unavailable：路径操作禁用，delete-linked 保持启用', () => {
    const { ctx } = makeCtx({ locationKind: 'linked', assetAvailable: false });
    const menu = registry.resolveMenu(ctx);
    expect(findItem(menu, 'asset.open-external').disabledReason).toBe(
      '资产当前不可用',
    );
    expect(findItem(menu, 'asset.delete-linked')).toMatchObject({
      disabled: false,
      disabledReason: null,
    });
  });

  it('ai-analyze：available + 无 API Key → 仍可点（由 handler 提示未配置）', () => {
    const { ctx } = makeCtx({ aiCanAnalyze: false });
    expect(
      findItem(registry.resolveMenu(ctx), 'asset.ai-analyze'),
    ).toMatchObject({
      disabled: false,
      disabledReason: null,
    });
  });

  it('ai-analyze：unavailable 优先于 API Key 原因', () => {
    const { ctx } = makeCtx({ assetAvailable: false, aiCanAnalyze: false });
    expect(
      findItem(registry.resolveMenu(ctx), 'asset.ai-analyze'),
    ).toMatchObject({
      disabled: true,
      disabledReason: '资产当前不可用',
    });
  });

  it('ai-analyze：available + 已配置 → 启用', () => {
    const { ctx } = makeCtx({ aiCanAnalyze: true });
    expect(
      findItem(registry.resolveMenu(ctx), 'asset.ai-analyze'),
    ).toMatchObject({ disabled: false, disabledReason: null });
  });

  it('回收站分支两项始终启用', () => {
    const { ctx } = makeCtx({ assetDeleted: true, assetAvailable: false });
    for (const item of registry.resolveMenu(ctx)) {
      expect(item.disabled, item.id).toBe(false);
    }
  });
});

describe('标题与快捷键标签', () => {
  it.each([
    ['asset.restore', '恢复'],
    ['asset.delete-permanent', '永久删除'],
    ['asset.view', '查看'],
    ['asset.open-external', '使用外部应用打开'],
    ['asset.remove-from-current-collection', '从当前合集移除'],
    ['asset.relink', '找回资产…'],
    ['asset.move-to-folder', '移动到文件夹…'],
    ['asset.copy-file-path', '复制文件路径'],
    ['asset.rename', '重命名…'],
    ['asset.ai-analyze', 'AI 分析'],
    ['asset.move-to-trash', '移入回收站'],
    ['asset.delete-linked', '删除链接资产…'],
  ] as const)('%s 标题为「%s」（与历史渲染一致）', (id, expected) => {
    // 用全开 ctx 让每项都可见：deleted 覆盖回收站项，正常 ctx 覆盖其余。
    const { ctx } = makeCtx({
      activeCollectionId: 'col-1',
      assetDeleted: id === 'asset.restore' || id === 'asset.delete-permanent',
      locationKind: id === 'asset.delete-linked' ? 'linked' : 'managed',
      assetAvailable: id !== 'asset.relink',
    });
    expect(findItem(registry.resolveMenu(ctx), id).label).toBe(expected);
  });

  it('reveal-in-folder 标题随平台切换', () => {
    const mac = makeCtx({ platform: 'mac' });
    expect(
      findItem(registry.resolveMenu(mac.ctx), 'asset.reveal-in-folder').label,
    ).toBe('在 Finder 中显示');
    const windows = makeCtx({ platform: 'windows' });
    expect(
      findItem(registry.resolveMenu(windows.ctx), 'asset.reveal-in-folder')
        .label,
    ).toBe('在文件资源管理器中显示');
  });

  it('快捷键标签按平台解析，未声明快捷键的项为 null', () => {
    const mac = registry.resolveMenu(makeCtx({ platform: 'mac' }).ctx);
    expect(findItem(mac, 'asset.view').shortcutLabel).toBe('↵');
    expect(findItem(mac, 'asset.open-external').shortcutLabel).toBe('⌘O');
    expect(findItem(mac, 'asset.move-to-trash').shortcutLabel).toBe('⌘⌫');
    expect(findItem(mac, 'asset.copy-file-path').shortcutLabel).toBeNull();

    const windows = registry.resolveMenu(
      makeCtx({ platform: 'windows' }).ctx,
    );
    expect(findItem(windows, 'asset.open-external').shortcutLabel).toBe(
      'Ctrl+O',
    );
    expect(findItem(windows, 'asset.move-to-trash').shortcutLabel).toBe(
      'Delete',
    );
  });
});

describe('run 委托到 actions 回调包', () => {
  it.each([
    ['asset.view', {}, 'view', ['asset-1']],
    ['asset.open-external', {}, 'openExternal', ['asset-1']],
    ['asset.reveal-in-folder', {}, 'revealInFolder', ['asset-1']],
    ['asset.copy-file-path', {}, 'copyFilePath', ['asset-1']],
    ['asset.rename', {}, 'rename', ['asset-1']],
    ['asset.ai-analyze', {}, 'aiAnalyze', ['asset-1']],
    ['asset.move-to-trash', {}, 'moveToTrash', [['asset-1']]],
    ['asset.move-to-folder', {}, 'moveToFolder', [['asset-1']]],
    [
      'asset.relink',
      { assetAvailable: false },
      'relink',
      ['asset-1'],
    ],
    [
      'asset.restore',
      { assetDeleted: true },
      'restore',
      [['asset-1']],
    ],
    [
      'asset.delete-permanent',
      { assetDeleted: true },
      'deletePermanent',
      [['asset-1']],
    ],
    [
      'asset.delete-linked',
      { locationKind: 'linked' },
      'deleteLinked',
      ['asset-1', '示例.png', true],
    ],
    [
      'asset.remove-from-current-collection',
      { activeCollectionId: 'col-1' },
      'removeFromCurrentCollection',
      ['asset-1'],
    ],
  ] as const)(
    '%s 以 primaryAssetId 转调 %s',
    (id, overrides, expectedAction, expectedArgs) => {
      const { ctx, calls } = makeCtx(overrides);
      const def = registry.get(id);
      expect(def).toBeDefined();
      void def?.run(ctx);
      expect(calls).toEqual([
        { action: expectedAction, args: expectedArgs },
      ]);
    },
  );

  it('delete-linked 把 assetAvailable 传给 canDeleteSourceFile', () => {
    const { ctx, calls } = makeCtx({
      locationKind: 'linked',
      assetAvailable: false,
    });
    void registry.get('asset.delete-linked')?.run(ctx);
    expect(calls).toEqual([
      {
        action: 'deleteLinked',
        args: ['asset-1', '示例.png', false],
      },
    ]);
  });

  it('primaryAssetId 为空时 run 落空、不调用任何 action', () => {
    const { ctx, calls } = makeCtx({ primaryAssetId: null });
    for (const def of registry.list()) {
      void def.run(ctx);
    }
    expect(calls).toEqual([]);
  });
});

describe('注册表完整性', () => {
  it('13 条定义全部注册且 id 唯一（createCommandRegistry 未抛错）', () => {
    expect(registry.list().map((def) => def.id)).toEqual([
      'asset.restore',
      'asset.delete-permanent',
      'asset.view',
      'asset.open-external',
      'asset.reveal-in-folder',
      'asset.remove-from-current-collection',
      'asset.relink',
      'asset.move-to-folder',
      'asset.copy-file-path',
      'asset.rename',
      'asset.ai-analyze',
      'asset.clear-ai-content',
      'asset.move-to-trash',
      'asset.delete-linked',
    ]);
  });

  it('解析结果按 open → organize → metadata → delete 组序排列', () => {
    const { ctx } = makeCtx({ activeCollectionId: 'col-1' });
    const groups = registry.resolveMenu(ctx).map((item) => item.group);
    expect(groups).toEqual([
      'open',
      'open',
      'open',
      'organize',
      'organize',
      'organize',
      'organize',
      'metadata',
      'metadata',
      'delete',
    ]);
  });
});
