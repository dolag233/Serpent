import { describe, expect, it } from 'vitest';

import { createCommandRegistry } from '../../src/renderer/commands/command-registry';
import type { ResolvedMenuItem } from '../../src/renderer/commands/command-types';
import {
  TOOLBAR_CANVAS_COMMAND_IDS,
  TOOLBAR_DIRECT_UTILITY_COMMAND_IDS,
  TOOLBAR_OVERFLOW_COMMAND_IDS,
  runToolbarCommand,
  toolbarCommandDefinitions,
  toolbarCommandRegistry,
  type ToolbarCommandActions,
  type ToolbarCommandContext,
} from '../../src/renderer/commands/toolbar-commands';

// REQ-COMMAND-001 / Serpent-2rk：工作区工具栏视图/字段/溢出工具接入注册表。

const registry = createCommandRegistry(toolbarCommandDefinitions);

interface RecordedCall {
  readonly action: string;
  readonly args: readonly unknown[];
}

function makeActions(calls: RecordedCall[]): ToolbarCommandActions {
  const record =
    (action: string) =>
    (...args: unknown[]): void => {
      calls.push({ action, args });
    };
  return {
    refresh: record('refresh'),
    setViewMode: record('setViewMode'),
    toggleField: record('toggleField'),
    openAiSettings: record('openAiSettings'),
    openAppSettings: record('openAppSettings'),
  };
}

function makeCtx(
  overrides: Partial<ToolbarCommandContext> = {},
): { ctx: ToolbarCommandContext; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const actions = overrides.actions ?? makeActions(calls);
  const ctx: ToolbarCommandContext = {
    surface: 'canvas',
    platform: 'mac',
    locale: 'zh-CN',
    selectedAssetIds: [],
    primaryAssetId: null,
    assetScope: 'canvas',
    trashMode: false,
    libraryOpen: true,
    busy: false,
    viewMode: 'grid',
    fields: {
      name: true,
      size: true,
      date: true,
      dimensions: true,
      badgeType: true,
      badgeDuration: true,
      badgeSource: true,
      badgeExtension: true,
    },
    ...overrides,
    actions,
  };
  return { ctx, calls };
}

function resolveIds(ctx: ToolbarCommandContext): string[] {
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

describe('工具栏命令可见性', () => {
  it('资源库打开时：常驻画布命令可见', () => {
    const { ctx } = makeCtx();
    expect(resolveIds(ctx)).toEqual([
      'canvas.view.grid',
      'canvas.view.masonry',
      'canvas.refresh',
      'workspace.ai-settings',
      'workspace.app-settings',
      'canvas.field.name',
      'canvas.field.size',
      'canvas.field.date',
      'canvas.field.dimensions',
    ]);
  });

  it('无资源库：AI 设置隐藏，通用设置（app-settings）仍可见', () => {
    const { ctx } = makeCtx({ libraryOpen: false });
    expect(resolveIds(ctx)).toEqual([
      'canvas.view.grid',
      'canvas.view.masonry',
      'canvas.refresh',
      'workspace.app-settings',
      'canvas.field.name',
      'canvas.field.size',
      'canvas.field.date',
      'canvas.field.dimensions',
    ]);
  });

  it('溢出 id 列表为空（工具入口由更多工具菜单承载）', () => {
    expect([...TOOLBAR_OVERFLOW_COMMAND_IDS]).toEqual([]);
    expect([...TOOLBAR_DIRECT_UTILITY_COMMAND_IDS]).toEqual([]);
    for (const id of TOOLBAR_OVERFLOW_COMMAND_IDS) {
      expect(registry.get(id)).toBeDefined();
    }
    expect(registry.get('library.import-files')).toBeUndefined();
    expect(registry.get('toolbar.importFiles')).toBeUndefined();
  });

  it('常驻画布 id 列表覆盖刷新/视图/四字段', () => {
    expect([...TOOLBAR_CANVAS_COMMAND_IDS]).toEqual([
      'canvas.refresh',
      'canvas.view.grid',
      'canvas.view.masonry',
      'canvas.field.name',
      'canvas.field.size',
      'canvas.field.date',
      'canvas.field.dimensions',
    ]);
  });
});

describe('禁用原因', () => {
  it('刷新：无资源库时禁用', () => {
    const { ctx } = makeCtx({ libraryOpen: false });
    const item = findItem(registry.resolveMenu(ctx), 'canvas.refresh');
    expect(item.disabled).toBe(true);
    expect(item.disabledReason).toBe('请先打开资源库');
  });

  it('刷新：busy 时禁用', () => {
    const { ctx } = makeCtx({ busy: true });
    const item = findItem(registry.resolveMenu(ctx), 'canvas.refresh');
    expect(item.disabled).toBe(true);
    expect(item.disabledReason).toBe('另有资源库操作进行中');
  });

  it('视图与字段开关在无库时仍可用', () => {
    const { ctx } = makeCtx({ libraryOpen: false });
    for (const id of [
      'canvas.view.grid',
      'canvas.view.masonry',
      'canvas.field.name',
    ] as const) {
      expect(findItem(registry.resolveMenu(ctx), id).disabled).toBe(false);
    }
  });

  it('通用设置在无库或 busy 时仍可用（主题/语言/画布显示是全局偏好）', () => {
    const { ctx: noLibrary } = makeCtx({ libraryOpen: false });
    expect(
      findItem(registry.resolveMenu(noLibrary), 'workspace.app-settings')
        .disabled,
    ).toBe(false);
    const { ctx: busyCtx } = makeCtx({ busy: true });
    expect(
      findItem(registry.resolveMenu(busyCtx), 'workspace.app-settings')
        .disabled,
    ).toBe(false);
  });
});

describe('标题与 locale', () => {
  it('zh-CN 标题对齐 toolbar 文案', () => {
    const { ctx } = makeCtx({ locale: 'zh-CN' });
    const menu = registry.resolveMenu(ctx);
    expect(findItem(menu, 'canvas.view.grid').label).toBe('平铺视图');
    expect(findItem(menu, 'canvas.view.masonry').label).toBe('瀑布流视图');
    expect(findItem(menu, 'canvas.field.name').label).toBe('文件名');
    expect(findItem(menu, 'workspace.ai-settings').label).toBe('AI 设置');
  });

  it('en 标题对齐 toolbar 文案', () => {
    const { ctx } = makeCtx({ locale: 'en' });
    const menu = registry.resolveMenu(ctx);
    expect(findItem(menu, 'canvas.view.grid').label).toBe('Grid view');
    expect(findItem(menu, 'canvas.refresh').label).toBe(
      'Refresh disk changes',
    );
    expect(findItem(menu, 'workspace.ai-settings').label).toBe('AI settings');
  });
});

describe('run 委托 actions', () => {
  it('视图切换与字段开关调用注入回调', () => {
    const { ctx, calls } = makeCtx();
    registry.get('canvas.view.masonry')!.run(ctx);
    registry.get('canvas.field.size')!.run(ctx);
    registry.get('canvas.refresh')!.run(ctx);
    expect(calls).toEqual([
      { action: 'setViewMode', args: ['masonry'] },
      { action: 'toggleField', args: ['size'] },
      { action: 'refresh', args: [] },
    ]);
  });

  it('设置命令仍可通过注册表委托', () => {
    const { ctx, calls } = makeCtx();
    registry.get('workspace.ai-settings')!.run(ctx);
    expect(calls.map((c) => c.action)).toEqual([
      'openAiSettings',
    ]);
  });

  it('通用设置命令委托 openAppSettings', () => {
    const { ctx, calls } = makeCtx();
    registry.get('workspace.app-settings')!.run(ctx);
    expect(calls).toEqual([{ action: 'openAppSettings', args: [] }]);
  });

  it('runToolbarCommand 尊重 visible/disabled', () => {
    const { ctx, calls } = makeCtx({ libraryOpen: false, busy: true });
    runToolbarCommand(ctx, 'canvas.refresh');
    runToolbarCommand(ctx, 'canvas.view.grid');
    expect(calls).toEqual([{ action: 'setViewMode', args: ['grid'] }]);
  });

  it('导出的 toolbarCommandRegistry 与定义同源', () => {
    expect(toolbarCommandRegistry.list().map((d) => d.id)).toEqual(
      toolbarCommandDefinitions.map((d) => d.id),
    );
  });
});
