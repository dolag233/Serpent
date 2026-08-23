// ---------------------------------------------------------------------------
// 工作区工具栏命令定义（REQ-COMMAND-001 收尾，Serpent-2rk）
//
// canvas 视图切换、字段开关、刷新与「更多工具」溢出项接入统一注册表。
// 导入/导出类动作已由 Serpent-2d0 迁入资源库菜单，不在此注册。
// run 经 ToolbarCommandContext.actions 回调包委托给 App 层，本模块不
// import App.tsx，避免循环依赖；node 环境可测。
// ---------------------------------------------------------------------------

import type { CanvasPreferences } from '../canvas-preferences';
import { translateForLocale } from '../i18n';
import { createCommandRegistry } from './command-registry';
import type { CommandContext, CommandDefinition } from './command-types';

export type CanvasFieldKey = keyof CanvasPreferences['fields'];
export type CanvasViewMode = CanvasPreferences['viewMode'];

/**
 * App 层注入的动作回调包。工具栏按钮与溢出菜单均经同一份定义 run，
 * 避免 JSX onClick 与后续命令盘/快捷键路径各维护一份 handler。
 */
export interface ToolbarCommandActions {
  readonly refresh: () => void;
  readonly setViewMode: (mode: CanvasViewMode) => void;
  readonly toggleField: (field: CanvasFieldKey) => void;
  /** Opens the AI category in the consolidated settings center. */
  readonly openAiSettings: () => void;
  /** Opens the general category in the consolidated settings center. */
  readonly openAppSettings: () => void;
}

export interface ToolbarCommandContext extends CommandContext {
  readonly libraryOpen: boolean;
  readonly busy: boolean;
  readonly viewMode: CanvasViewMode;
  readonly fields: CanvasPreferences['fields'];
  readonly actions: ToolbarCommandActions;
}

export type ToolbarCommandDefinition = CommandDefinition<ToolbarCommandContext>;

/** 常驻画布控件（不含缩略图滑块；滑块不是离散命令）。 */
export const TOOLBAR_CANVAS_COMMAND_IDS = [
  'canvas.refresh',
  'canvas.view.grid',
  'canvas.view.masonry',
  'canvas.field.name',
  'canvas.field.size',
  'canvas.field.date',
  'canvas.field.dimensions',
] as const;

/** 工作区工具栏直出按钮。 */
export const TOOLBAR_DIRECT_UTILITY_COMMAND_IDS = [] as const;

/** 「更多工具」溢出菜单条目（导入类不在此列）。AI 设置已迁入设置中心。 */
export const TOOLBAR_OVERFLOW_COMMAND_IDS = [] as const;

export type ToolbarCanvasCommandId = (typeof TOOLBAR_CANVAS_COMMAND_IDS)[number];
export type ToolbarOverflowCommandId =
  (typeof TOOLBAR_OVERFLOW_COMMAND_IDS)[number];

function t(ctx: ToolbarCommandContext, key: string): string {
  return translateForLocale(ctx.locale, key);
}

function libraryBusyReason(ctx: ToolbarCommandContext): string | null {
  if (!ctx.libraryOpen) return t(ctx, 'command.reason.noLibrary');
  if (ctx.busy) return t(ctx, 'command.reason.busy');
  return null;
}

export const toolbarCommandDefinitions: readonly ToolbarCommandDefinition[] = [
  {
    id: 'canvas.refresh',
    title: (ctx) => t(ctx, 'toolbar.refreshDisk'),
    group: 'organize',
    shortcut: {
      mac: { label: 'F5', key: 'F5' },
      windows: { label: 'F5', key: 'F5' },
    },
    disabledReason: libraryBusyReason,
    run: (ctx) => ctx.actions.refresh(),
  },
  {
    id: 'canvas.view.grid',
    title: (ctx) => t(ctx, 'toolbar.gridView'),
    group: 'open',
    run: (ctx) => ctx.actions.setViewMode('grid'),
  },
  {
    id: 'canvas.view.masonry',
    title: (ctx) => t(ctx, 'toolbar.masonryView'),
    group: 'open',
    run: (ctx) => ctx.actions.setViewMode('masonry'),
  },
  {
    id: 'canvas.field.name',
    title: (ctx) => t(ctx, 'toolbar.showFileName'),
    group: 'metadata',
    run: (ctx) => ctx.actions.toggleField('name'),
  },
  {
    id: 'canvas.field.size',
    title: (ctx) => t(ctx, 'toolbar.showFileSize'),
    group: 'metadata',
    run: (ctx) => ctx.actions.toggleField('size'),
  },
  {
    id: 'canvas.field.date',
    title: (ctx) => t(ctx, 'toolbar.showModifiedDate'),
    group: 'metadata',
    run: (ctx) => ctx.actions.toggleField('date'),
  },
  {
    id: 'canvas.field.dimensions',
    title: (ctx) => t(ctx, 'toolbar.showDimensions'),
    group: 'metadata',
    run: (ctx) => ctx.actions.toggleField('dimensions'),
  },
  {
    id: 'workspace.ai-settings',
    title: (ctx) => t(ctx, 'toolbar.aiSettings'),
    group: 'organize',
    visible: (ctx) => ctx.libraryOpen,
    run: (ctx) => ctx.actions.openAiSettings(),
  },
  {
    // REQ-PREF-001 / Serpent-97l: app-level prefs. UI entry is the gear
    // beside the library switcher (not the canvas toolbar); this command
    // remains for command-palette / keyboard paths.
    id: 'workspace.app-settings',
    title: (ctx) => t(ctx, 'toolbar.appSettings'),
    group: 'organize',
    run: (ctx) => ctx.actions.openAppSettings(),
  },
];

/** 与工具栏按钮共用的注册表实例；命令盘/快捷键路径可按 id 查询并 run。 */
export const toolbarCommandRegistry = createCommandRegistry(
  toolbarCommandDefinitions,
);

/**
 * 按 id 执行工具栏命令：尊重 visible / disabledReason。
 * 供后续命令盘或快捷键路径与按钮共用同一守卫。
 */
export function runToolbarCommand(
  ctx: ToolbarCommandContext,
  id: string,
): void {
  const def = toolbarCommandRegistry.get(id);
  if (def === undefined) return;
  if (def.visible !== undefined && !def.visible(ctx)) return;
  if (def.disabledReason?.(ctx) != null) return;
  void def.run(ctx);
}
