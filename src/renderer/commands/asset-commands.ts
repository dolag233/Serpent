// ---------------------------------------------------------------------------
// 单资产右键菜单命令定义（REQ-COMMAND-001，切片 0015-B）
//
// AssetContextMenu 单资产分支的静态项逐条对接到这里的定义：可见性、禁用
// 原因、标题、快捷键与 0015-B 之前的内联 JSX 条件一一对应（布局保持）。
// run 通过 AssetCommandContext.actions 回调包委托给 App 层处理器，本模块
// 不 import App.tsx / AssetContextMenu.tsx，避免循环依赖；node 环境可测。
// ---------------------------------------------------------------------------

import { translateForLocale } from '../i18n';
import type { CommandContext, CommandDefinition } from './command-types';
import { DELETE_FROM_DISK_SHORTCUT } from './asset-shortcuts';

/**
 * App 层注入的动作回调包。签名与 AssetContextMenu 的相关 props 一一对应，
 * 注册表的 run 只负责按 primaryAssetId 转调，不内联任何 App 处理器。
 */
export interface AssetCommandActions {
  readonly view: (assetId: string) => void;
  readonly openExternal: (assetId: string) => void;
  readonly revealInFolder: (assetId: string) => void;
  /** Jump the browse canvas to the asset's library folder. */
  readonly showInLibraryFolder: (assetId: string) => void;
  readonly findSimilar: (assetId: string) => void;
  /** OS file clipboard (Finder/Explorer interoperable). */
  readonly copyFiles: (assetIds: string[]) => void;
  readonly cutFiles?: (assetIds: string[]) => void;
  /** Paste OS clipboard into a managed folder (reuse folder.paste). */
  readonly pasteIntoFolder: (folderId: string | null) => void;
  readonly copyFilePath: (assetId: string) => void;
  readonly rename: (assetId: string) => void;
  readonly aiAnalyze: (assetId: string) => void;
  readonly clearAiContent?: (assetIds: string[]) => void;
  readonly moveToTrash: (assetIds: string[]) => void;
  readonly deleteFromDisk: (assetIds: string[]) => void;
  readonly moveToFolder: (assetIds: string[]) => void;
  readonly relink: (assetId: string) => void;
  readonly restore: (assetIds: string[]) => void;
  readonly deletePermanent: (assetIds: string[]) => void;
  readonly removeFromCurrentCollection: (assetId: string) => void;
}

/**
 * 单资产菜单在基线 CommandContext 之上追加的可用性判定字段。
 * 与 ContextMenuDescriptor 的 asset 分支字段对齐，外加合集/AI 状态。
 */
export interface AssetCommandContext extends CommandContext {
  readonly locationKind: 'managed' | 'linked';
  readonly assetAvailable: boolean;
  readonly assetDeleted: boolean;
  readonly activeCollectionId: string | null;
  readonly aiCanAnalyze: boolean;
  /**
   * Managed folder that receives OS clipboard paste (current browse folder
   * or the asset's parent). Null hides paste.
   */
  readonly pasteTargetFolderId: string | null | undefined;
  /** Semantic search is on. The menu item stays hidden while this is false. */
  readonly semanticSearchEnabled: boolean;
  /** Current encoder can consume the asset directly or through its preview. */
  readonly similarSourceSupported: boolean;
  readonly actions: AssetCommandActions;
}

export type AssetCommandDefinition = CommandDefinition<AssetCommandContext>;

function t(
  ctx: AssetCommandContext,
  key: string,
): string {
  return translateForLocale(ctx.locale, key);
}

function unavailableReason(ctx: AssetCommandContext): string | null {
  return ctx.assetAvailable ? null : t(ctx, 'command.reason.unavailable');
}

/**
 * run 只服务单资产菜单：primaryAssetId 为空时落空（防御；菜单层保证非空）。
 */
function withPrimaryAsset(
  ctx: AssetCommandContext,
  run: (assetId: string) => void,
): void {
  if (ctx.primaryAssetId === null) return;
  run(ctx.primaryAssetId);
}

// 注册顺序即组内展示顺序，与历史 JSX 中的条目顺序一致。
export const assetCommandDefinitions: readonly AssetCommandDefinition[] = [
  // ---- 回收站分支：assetDeleted 时仅这两项可见（与原 isDeleted 三元分支一致） ----
  {
    id: 'asset.restore',
    title: (ctx) => t(ctx, 'command.asset.restore'),
    group: 'delete',
    visible: (ctx) => ctx.assetDeleted,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.restore([id])),
  },
  {
    id: 'asset.delete-permanent',
    title: (ctx) => t(ctx, 'command.asset.deletePermanent'),
    group: 'delete',
    visible: (ctx) => ctx.assetDeleted,
    run: (ctx) =>
      withPrimaryAsset(ctx, (id) => ctx.actions.deletePermanent([id])),
  },
  // ---- 打开 ----
  {
    id: 'asset.view',
    title: (ctx) => t(ctx, 'command.asset.view'),
    group: 'open',
    shortcut: {
      mac: { label: '↵', key: 'Enter' },
      windows: { label: 'Enter', key: 'Enter' },
    },
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: unavailableReason,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.view(id)),
  },
  {
    id: 'asset.open-external',
    title: (ctx) => t(ctx, 'command.asset.openExternal'),
    group: 'open',
    shortcut: {
      mac: { label: '⌘O', key: 'o', metaKey: true },
      windows: { label: 'Ctrl+O', key: 'o', ctrlKey: true },
    },
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: unavailableReason,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.openExternal(id)),
  },
  {
    id: 'asset.reveal-in-folder',
    title: (ctx) =>
      t(
        ctx,
        ctx.platform === 'mac'
          ? 'command.asset.revealInFolder'
          : 'command.asset.revealInFolderWindows',
      ),
    group: 'open',
    shortcut: {
      mac: { label: '⌘⇧S', key: 's', metaKey: true, shiftKey: true },
      windows: { label: 'Ctrl+Shift+S', key: 's', ctrlKey: true, shiftKey: true },
    },
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: unavailableReason,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.revealInFolder(id)),
  },
  {
    id: 'asset.show-in-library-folder',
    title: (ctx) => t(ctx, 'command.asset.showInLibraryFolder'),
    group: 'open',
    shortcut: {
      mac: { label: '⌘B', key: 'b', metaKey: true },
      windows: { label: 'Ctrl+B', key: 'b', ctrlKey: true },
    },
    visible: (ctx) => !ctx.assetDeleted,
    run: (ctx) =>
      withPrimaryAsset(ctx, (id) => ctx.actions.showInLibraryFolder(id)),
  },
  {
    id: 'asset.find-similar',
    title: (ctx) => t(ctx, 'command.asset.findSimilar'),
    group: 'open',
    visible: (ctx) => ctx.semanticSearchEnabled && !ctx.assetDeleted && ctx.similarSourceSupported,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.findSimilar(id)),
  },
  // ---- 组织 ----
  {
    id: 'asset.remove-from-current-collection',
    title: (ctx) => t(ctx, 'command.asset.removeFromCollection'),
    group: 'organize',
    visible: (ctx) => !ctx.assetDeleted && ctx.activeCollectionId !== null,
    run: (ctx) =>
      withPrimaryAsset(ctx, (id) =>
        ctx.actions.removeFromCurrentCollection(id),
      ),
  },
  {
    id: 'asset.relink',
    title: (ctx) => t(ctx, 'command.asset.relink'),
    group: 'organize',
    visible: (ctx) =>
      !ctx.assetDeleted && !ctx.assetAvailable,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.relink(id)),
  },
  {
    id: 'asset.move-to-folder',
    title: (ctx) => t(ctx, 'command.asset.moveToFolder'),
    group: 'organize',
    visible: (ctx) =>
      !ctx.assetDeleted &&
      ctx.locationKind === 'managed' &&
      ctx.assetAvailable,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.moveToFolder([id])),
  },
  {
    id: 'asset.cut',
    title: (ctx) => t(ctx, 'command.asset.cut'),
    group: 'organize',
    shortcut: {
      mac: { label: '⌘X', key: 'x', metaKey: true },
      windows: { label: 'Ctrl+X', key: 'x', ctrlKey: true },
    },
    visible: (ctx) => !ctx.assetDeleted && ctx.actions.cutFiles !== undefined,
    disabledReason: unavailableReason,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.cutFiles?.([id])),
  },
  {
    id: 'asset.copy',
    title: (ctx) => t(ctx, 'command.asset.copy'),
    group: 'organize',
    shortcut: {
      mac: { label: '⌘C', key: 'c', metaKey: true },
      windows: { label: 'Ctrl+C', key: 'c', ctrlKey: true },
    },
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: unavailableReason,
    run: (ctx) =>
      withPrimaryAsset(ctx, (id) => ctx.actions.copyFiles([id])),
  },
  {
    id: 'asset.paste',
    title: (ctx) => t(ctx, 'command.asset.paste'),
    group: 'organize',
    shortcut: {
      mac: { label: '⌘V', key: 'v', metaKey: true },
      windows: { label: 'Ctrl+V', key: 'v', ctrlKey: true },
    },
    visible: (ctx) =>
      !ctx.assetDeleted && ctx.pasteTargetFolderId !== undefined,
    run: (ctx) => {
      if (ctx.pasteTargetFolderId !== undefined) {
        ctx.actions.pasteIntoFolder(ctx.pasteTargetFolderId);
      }
    },
  },
  {
    id: 'asset.copy-file-path',
    title: (ctx) => t(ctx, 'command.asset.copyFilePath'),
    group: 'organize',
    shortcut: {
      mac: { label: '⌥⌘C', key: 'c', metaKey: true, altKey: true },
      windows: { label: 'Ctrl+Shift+C', key: 'c', ctrlKey: true, shiftKey: true },
    },
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: unavailableReason,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.copyFilePath(id)),
  },
  {
    id: 'asset.rename',
    title: (ctx) => t(ctx, 'command.asset.rename'),
    group: 'organize',
    shortcut: {
      mac: { label: 'F2', key: 'F2' },
      windows: { label: 'F2', key: 'F2' },
    },
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: unavailableReason,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.rename(id)),
  },
  // ---- 元数据 ----
  {
    id: 'asset.ai-analyze',
    title: (ctx) => t(ctx, 'command.asset.aiAnalyze'),
    group: 'metadata',
    visible: (ctx) => !ctx.assetDeleted,
    // Only hard-disable for unavailable assets. Missing AI config still runs
    // so the handler can surface a toast (silent disabled clicks feel broken).
    disabledReason: (ctx) =>
      !ctx.assetAvailable ? t(ctx, 'command.reason.unavailable') : null,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.aiAnalyze(id)),
  },
  {
    id: 'asset.clear-ai-content',
    title: (ctx) => t(ctx, 'command.asset.clearAiContent'),
    group: 'metadata',
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: unavailableReason,
    run: (ctx) =>
      withPrimaryAsset(ctx, (id) => ctx.actions.clearAiContent?.([id])),
  },
  // ---- 删除 ----
  {
    id: 'asset.move-to-trash',
    title: (ctx) => t(ctx, 'command.asset.moveToTrash'),
    group: 'delete',
    shortcut: {
      mac: { label: '⌘⌫', key: 'Backspace', metaKey: true },
      windows: { label: 'Delete', key: 'Delete' },
    },
    // 2026-09-15 用户决定：链接资产不再有「移入回收站」（它会逐个文件送进系统
    // 回收站）。链接资产只保留「强制从硬盘删除」。
    visible: (ctx) => !ctx.assetDeleted && ctx.locationKind === 'managed',
    disabledReason: (ctx) =>
      ctx.assetDeleted
        ? t(ctx, 'command.reason.unavailable')
        : null,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.moveToTrash([id])),
  },
  {
    id: 'asset.delete-from-disk',
    title: (ctx) => t(
      ctx,
      ctx.locationKind === 'linked'
        ? 'command.asset.forceDeleteFromDisk'
        : 'command.asset.deleteFromDisk',
    ),
    group: 'delete',
    shortcut: DELETE_FROM_DISK_SHORTCUT,
    visible: (ctx) =>
      !ctx.assetDeleted
      && (ctx.locationKind === 'managed' || ctx.locationKind === 'linked'),
    disabledReason: (ctx) => {
      if (ctx.assetDeleted) return t(ctx, 'command.reason.unavailable');
      // 链接资产的源文件缺失/离线时仍然允许删除：这只删库内记录，不依赖源文件存在。
      if (ctx.locationKind === 'linked') return null;
      return ctx.assetAvailable
        ? null
        : t(ctx, 'command.reason.managedUnavailableTrash');
    },
    run: (ctx) =>
      withPrimaryAsset(ctx, (id) => ctx.actions.deleteFromDisk([id])),
  },
];
