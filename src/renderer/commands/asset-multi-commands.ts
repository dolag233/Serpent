// ---------------------------------------------------------------------------
// 多资产右键菜单命令定义（REQ-COMMAND-001，切片 0015-C）
//
// AssetContextMenu 多资产分支的静态项逐条对接到这里的定义：可见性、禁用
// 原因、内嵌计数标题、快捷键与 0015-C 之前的内联 JSX 条件一一对应（布局
// 保持）。动态行（批量合集、复制到外部目录）与汇总/跳过原因提示块不进
// 注册表，仍在 JSX 内联。run 通过 AssetMultiCommandContext.actions 回调包
// 委托给 App 层处理器，本模块不 import App.tsx / AssetContextMenu.tsx，
// 避免循环依赖；node 环境可测。
// ---------------------------------------------------------------------------

import { translateForLocale } from '../i18n';
import type { CommandContext, CommandDefinition } from './command-types';

/**
 * App 层注入的动作回调包。签名与 AssetContextMenu 多资产分支实际使用的
 * props/处理器一一对应：标签两项只负责打开菜单内 TagPicker（真正的
 * onBatchAssignTag/onBatchRemoveTag 由 TagPickerMenu 的 onPick 触发），
 * 移动/回收站/恢复/永久删除接收本次操作实际生效的资产 id 集合。
 */
export interface AssetMultiCommandActions {
  readonly openAssignTagPicker: (assetIds: string[]) => void;
  readonly openRemoveTagPicker: (assetIds: string[]) => void;
  readonly copyFiles: (assetIds: string[]) => void;
  readonly pasteIntoFolder: (folderId: string | null) => void;
  readonly moveToFolder: (
    assetIds: string[],
    folderIds?: readonly string[],
  ) => void;
  /** Assets + managed folder cards that trash can process (Serpent-koy). */
  readonly moveToTrash: (
    assetIds: string[],
    folderIds?: readonly string[],
  ) => void;
  readonly deleteFromDisk: (
    assetIds: string[],
    folderIds?: readonly string[],
  ) => void;
  readonly restore: (assetIds: string[]) => void;
  readonly deletePermanent: (assetIds: string[]) => void;
  readonly clearSelection: () => void;
  readonly aiAnalyze?: (assetIds: string[]) => void;
  readonly clearAiContent?: (assetIds: string[]) => void;
}

/**
 * 多资产菜单在基线 CommandContext 之上追加的计数与判定字段。
 * ctx.selectedAssetIds 即描述符里的完整选中集合（恢复/永久删除/清除选择/
 * 标签入口的操作对象）；managedAssetIds / availableManagedAssetIds 是
 * managedCount / availableManagedCount 对应的 id 明细，供 run 转调。
 * linkedCount 供菜单跳过报告与上下文齐备；页脚文案由 menu-skip-report 生成。
 */
export interface AssetMultiCommandContext extends CommandContext {
  readonly selectionCount: number;
  readonly managedCount: number;
  readonly availableManagedCount: number;
  readonly linkedCount: number;
  /** Managed folder cards included in trash / disk-delete process counts. */
  readonly folderCount: number;
  readonly processFolderIds: readonly string[];
  /** 对应原 allTrashed：选中资产全部在回收站时切换为回收站分支。 */
  readonly trashedAll: boolean;
  readonly managedAssetIds: readonly string[];
  readonly availableManagedAssetIds: readonly string[];
  /** Available (non-missing) assets that can be written to OS clipboard. */
  readonly availableAssetIds: readonly string[];
  /**
   * 选中里没有任何 AI 生成数据的资产（菜单打开时预取）——「AI分析未分析项」。
   */
  readonly aiPendingAssetIds: readonly string[];
  /**
   * Managed folder that receives OS clipboard paste. Null hides paste.
   */
  readonly pasteTargetFolderId: string | null | undefined;
  readonly actions: AssetMultiCommandActions;
}

export type AssetMultiCommandDefinition =
  CommandDefinition<AssetMultiCommandContext>;

function t(
  ctx: AssetMultiCommandContext,
  key: string,
  params?: Readonly<Record<string, string | number>>,
): string {
  return translateForLocale(ctx.locale, key, params);
}

// 注册顺序即组内展示顺序，与历史 JSX 中的条目顺序一致。清除选择始终渲染在
// 菜单末尾（两个分支都出现），归入 delete 组让 resolveMenu 顺序与视觉位置
// 一致；它本身不是破坏性操作，只是视觉上位于删除区之后。
export const assetMultiCommandDefinitions: readonly AssetMultiCommandDefinition[] =
  [
    // ---- 回收站分支：trashedAll 时仅这两项 + clear-selection 可见 ----
    {
      id: 'assets.restore',
      title: (ctx) =>
        t(ctx, 'command.assets.restore', { count: ctx.selectionCount }),
      group: 'delete',
      visible: (ctx) => ctx.trashedAll,
      run: (ctx) => ctx.actions.restore([...ctx.selectedAssetIds]),
    },
    {
      id: 'assets.delete-permanent',
      title: (ctx) =>
        t(ctx, 'command.assets.deletePermanent', {
          count: ctx.selectionCount,
        }),
      group: 'delete',
      visible: (ctx) => ctx.trashedAll,
      run: (ctx) => ctx.actions.deletePermanent([...ctx.selectedAssetIds]),
    },
    // ---- 批量标签（tags.length > 0 的闸门仍在 JSX；此处只表达分支可见性）----
    {
      id: 'assets.assign-tag',
      title: (ctx) => t(ctx, 'command.asset.addTags'),
      group: 'metadata',
      visible: (ctx) => !ctx.trashedAll,
      run: (ctx) => ctx.actions.openAssignTagPicker([...ctx.selectedAssetIds]),
    },
    {
      id: 'assets.remove-tag',
      title: (ctx) => t(ctx, 'command.asset.removeTags'),
      group: 'metadata',
      visible: (ctx) => !ctx.trashedAll,
      run: (ctx) => ctx.actions.openRemoveTagPicker([...ctx.selectedAssetIds]),
    },
    // ---- AI 元数据 ----
    {
      // 「AI分析未分析项」排在最前：只分析没有任何 AI 生成数据的资产，
      // 计数来自 ctx.aiPendingAssetIds（菜单打开时预取）。
      id: 'assets.ai-analyze-pending',
      title: (ctx) =>
        t(ctx, 'command.assets.aiAnalyzeMissing', {
          count: ctx.aiPendingAssetIds.length,
        }),
      group: 'metadata',
      visible: (ctx) =>
        !ctx.trashedAll && ctx.aiPendingAssetIds.length > 0,
      run: (ctx) => ctx.actions.aiAnalyze?.([...ctx.aiPendingAssetIds]),
    },
    {
      id: 'assets.ai-analyze',
      title: (ctx) =>
        t(ctx, 'command.assets.aiAnalyze', { count: ctx.selectionCount }),
      group: 'metadata',
      visible: (ctx) => !ctx.trashedAll,
      run: (ctx) => ctx.actions.aiAnalyze?.([...ctx.selectedAssetIds]),
    },
    {
      id: 'assets.clear-ai-content',
      title: (ctx) => t(ctx, 'command.asset.clearAiContent'),
      group: 'metadata',
      visible: (ctx) => !ctx.trashedAll,
      run: (ctx) => ctx.actions.clearAiContent?.([...ctx.selectedAssetIds]),
    },
    // ---- 组织 ----
    {
      id: 'assets.copy',
      title: (ctx) =>
        t(ctx, 'command.assets.copy', { count: ctx.availableAssetIds.length }),
      group: 'organize',
      shortcut: {
        mac: { label: '⌘C', key: 'c', metaKey: true },
        windows: { label: 'Ctrl+C', key: 'c', ctrlKey: true },
      },
      visible: (ctx) => !ctx.trashedAll,
      disabledReason: (ctx) =>
        ctx.availableAssetIds.length === 0
          ? t(ctx, 'command.reason.unavailable')
          : null,
      run: (ctx) => ctx.actions.copyFiles([...ctx.availableAssetIds]),
    },
    {
      id: 'assets.paste',
      title: (ctx) => t(ctx, 'command.asset.paste'),
      group: 'organize',
      shortcut: {
        mac: { label: '⌘V', key: 'v', metaKey: true },
        windows: { label: 'Ctrl+V', key: 'v', ctrlKey: true },
      },
      visible: (ctx) =>
        !ctx.trashedAll && ctx.pasteTargetFolderId !== undefined,
      run: (ctx) => {
        if (ctx.pasteTargetFolderId !== undefined) {
          ctx.actions.pasteIntoFolder(ctx.pasteTargetFolderId);
        }
      },
    },
    {
      id: 'assets.move-to-folder',
      title: (ctx) =>
        t(ctx, 'command.assets.moveToFolder', {
          count: ctx.availableManagedCount + ctx.folderCount,
        }),
      group: 'organize',
      visible: (ctx) => !ctx.trashedAll,
      disabledReason: (ctx) =>
        ctx.availableManagedCount + ctx.folderCount === 0
          ? t(ctx, 'command.reason.noMovableManaged')
          : null,
      run: (ctx) =>
        ctx.actions.moveToFolder(
          [...ctx.availableManagedAssetIds],
          [...ctx.processFolderIds],
        ),
    },
    // ---- 删除 ----
    {
      id: 'assets.move-to-trash',
      title: (ctx) =>
        t(ctx, 'command.assets.moveToTrash', {
          count: ctx.managedCount + ctx.folderCount,
        }),
      group: 'delete',
      shortcut: {
        mac: { label: '⌘⌫', key: 'Backspace', metaKey: true },
        windows: { label: 'Delete', key: 'Delete' },
      },
      visible: (ctx) => !ctx.trashedAll,
      disabledReason: (ctx) =>
        ctx.managedCount + ctx.folderCount === 0
          ? t(ctx, 'command.reason.noManaged')
          : null,
      run: (ctx) =>
        ctx.actions.moveToTrash(
          [...ctx.managedAssetIds],
          [...ctx.processFolderIds],
        ),
    },
    {
      id: 'assets.delete-from-disk',
      title: (ctx) =>
        t(ctx, 'command.assets.deleteFromDisk', {
          count: ctx.managedCount + ctx.folderCount,
        }),
      group: 'delete',
      visible: (ctx) => !ctx.trashedAll,
      disabledReason: (ctx) =>
        ctx.managedCount + ctx.folderCount === 0
          ? t(ctx, 'command.reason.noManaged')
          : null,
      run: (ctx) =>
        ctx.actions.deleteFromDisk(
          [...ctx.managedAssetIds],
          [...ctx.processFolderIds],
        ),
    },
    // ---- 选择管理：两个分支都渲染，视觉上位于菜单末尾 ----
    {
      id: 'assets.clear-selection',
      title: (ctx) =>
        t(ctx, 'command.assets.clearSelection', { count: ctx.selectionCount }),
      group: 'delete',
      run: (ctx) => ctx.actions.clearSelection(),
    },
  ];
