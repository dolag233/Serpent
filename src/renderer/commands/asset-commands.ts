// ---------------------------------------------------------------------------
// 单资产右键菜单命令定义（REQ-COMMAND-001，切片 0015-B）
//
// AssetContextMenu 单资产分支的静态项逐条对接到这里的定义：可见性、禁用
// 原因、标题、快捷键与 0015-B 之前的内联 JSX 条件一一对应（布局保持）。
// run 通过 AssetCommandContext.actions 回调包委托给 App 层处理器，本模块
// 不 import App.tsx / AssetContextMenu.tsx，避免循环依赖；node 环境可测。
// ---------------------------------------------------------------------------

import type { CommandContext, CommandDefinition } from './command-types';

/**
 * App 层注入的动作回调包。签名与 AssetContextMenu 的相关 props 一一对应，
 * 注册表的 run 只负责按 primaryAssetId 转调，不内联任何 App 处理器。
 */
export interface AssetCommandActions {
  readonly openExternal: (assetId: string) => void;
  readonly revealInFolder: (assetId: string) => void;
  readonly copyFilePath: (assetId: string) => void;
  readonly rename: (assetId: string) => void;
  readonly aiAnalyze: (assetId: string) => void;
  readonly moveToTrash: (assetIds: string[]) => void;
  readonly moveToFolder: (assetIds: string[]) => void;
  readonly relink: (assetId: string) => void;
  readonly restore: (assetIds: string[]) => void;
  readonly deletePermanent: (assetIds: string[]) => void;
  readonly deleteLinked: (
    assetId: string,
    displayName: string,
    canDeleteSourceFile: boolean,
  ) => void;
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
  /** 删除链接资产的确认流程需要展示名（对应 descriptor.displayName）。 */
  readonly assetDisplayName: string;
  readonly actions: AssetCommandActions;
}

export type AssetCommandDefinition = CommandDefinition<AssetCommandContext>;

const UNAVAILABLE_REASON = '资产当前不可用';

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
    title: '恢复',
    group: 'delete',
    visible: (ctx) => ctx.assetDeleted,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.restore([id])),
  },
  {
    id: 'asset.delete-permanent',
    title: '永久删除',
    group: 'delete',
    visible: (ctx) => ctx.assetDeleted,
    run: (ctx) =>
      withPrimaryAsset(ctx, (id) => ctx.actions.deletePermanent([id])),
  },
  // ---- 打开 ----
  {
    id: 'asset.open-external',
    title: '使用外部应用打开',
    group: 'open',
    shortcut: { mac: '⌘O', windows: 'Ctrl+O' },
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: (ctx) => (ctx.assetAvailable ? null : UNAVAILABLE_REASON),
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.openExternal(id)),
  },
  {
    id: 'asset.reveal-in-folder',
    title: (ctx) =>
      ctx.platform === 'mac' ? '在 Finder 中显示' : '在文件资源管理器中显示',
    group: 'open',
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: (ctx) => (ctx.assetAvailable ? null : UNAVAILABLE_REASON),
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.revealInFolder(id)),
  },
  // ---- 组织 ----
  {
    id: 'asset.remove-from-current-collection',
    title: '从当前合集移除',
    group: 'organize',
    visible: (ctx) => !ctx.assetDeleted && ctx.activeCollectionId !== null,
    run: (ctx) =>
      withPrimaryAsset(ctx, (id) =>
        ctx.actions.removeFromCurrentCollection(id),
      ),
  },
  {
    id: 'asset.relink',
    title: '找回资产…',
    group: 'organize',
    visible: (ctx) =>
      !ctx.assetDeleted &&
      ctx.locationKind === 'managed' &&
      !ctx.assetAvailable,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.relink(id)),
  },
  {
    id: 'asset.move-to-folder',
    title: '移动到文件夹…',
    group: 'organize',
    visible: (ctx) =>
      !ctx.assetDeleted &&
      ctx.locationKind === 'managed' &&
      ctx.assetAvailable,
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.moveToFolder([id])),
  },
  {
    id: 'asset.copy-file-path',
    title: '复制文件路径',
    group: 'organize',
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: (ctx) => (ctx.assetAvailable ? null : UNAVAILABLE_REASON),
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.copyFilePath(id)),
  },
  {
    id: 'asset.rename',
    title: '重命名…',
    group: 'organize',
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: (ctx) => (ctx.assetAvailable ? null : UNAVAILABLE_REASON),
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.rename(id)),
  },
  // ---- 元数据 ----
  {
    id: 'asset.ai-analyze',
    title: 'AI 分析',
    group: 'metadata',
    visible: (ctx) => !ctx.assetDeleted,
    disabledReason: (ctx) =>
      !ctx.assetAvailable
        ? UNAVAILABLE_REASON
        : ctx.aiCanAnalyze
          ? null
          : '尚未配置 AI API Key',
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.aiAnalyze(id)),
  },
  // ---- 删除 ----
  {
    id: 'asset.move-to-trash',
    title: '移入回收站',
    group: 'delete',
    shortcut: { mac: '⌘⌫', windows: 'Delete' },
    visible: (ctx) => !ctx.assetDeleted && ctx.locationKind === 'managed',
    disabledReason: (ctx) =>
      ctx.assetAvailable ? null : '托管资产当前不可用，无法移入回收站',
    run: (ctx) => withPrimaryAsset(ctx, (id) => ctx.actions.moveToTrash([id])),
  },
  {
    id: 'asset.delete-linked',
    title: '删除链接资产…',
    group: 'delete',
    visible: (ctx) => !ctx.assetDeleted && ctx.locationKind === 'linked',
    run: (ctx) =>
      withPrimaryAsset(ctx, (id) =>
        ctx.actions.deleteLinked(id, ctx.assetDisplayName, ctx.assetAvailable),
      ),
  },
];
