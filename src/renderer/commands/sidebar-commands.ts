// ---------------------------------------------------------------------------
// 侧边栏右键菜单命令定义（REQ-COMMAND-001，切片 0015-D）
//
// AssetContextMenu 的文件夹 / 合集（organization）/ 智能合集三个分支的静态
// 项逐条对接到这里的定义：可见性、禁用原因、平台条件标题与 0015-D 之前的
// 内联 JSX 条件一一对应（布局保持）。run 通过 SidebarCommandContext.actions
// 回调包委托给 App 层处理器；删除两项的 window.confirm 确认保留在各自 run
// 内（与历史内联行为一致），不进入注册表核心。本模块不 import App.tsx /
// AssetContextMenu.tsx，避免循环依赖；node 环境可测。
// ---------------------------------------------------------------------------

import type { LinkedFolderSummary } from '../../shared/asset-types';
import type { CommandContext, CommandDefinition } from './command-types';

/**
 * App 层注入的动作回调包。签名与 AssetContextMenu 三个侧边栏分支实际使用
 * 的 props 一一对应；注册表的 run 只负责按 subjectId/subjectName 转调，
 * 不内联任何 App 处理器。
 */
export interface SidebarCommandActions {
  // ---- 文件夹 ----
  readonly openFolderInFileManager: (folderId: string) => void;
  readonly createSubfolder: (folderId: string) => void;
  readonly renameFolder: (folderId: string, currentName: string) => void;
  readonly openLinkedRules: (folder: LinkedFolderSummary) => void;
  readonly copyFolderPath: (folderId: string) => void;
  // ---- 合集（organization）----
  readonly renameOrganization: (id: string, name: string) => void;
  readonly editCollectionDetails: (collectionId: string) => void;
  readonly deleteOrganization: (id: string, name: string) => void;
  // ---- 智能合集 ----
  readonly renameSmartCollection: (id: string, name: string) => void;
  readonly updateSmartCollection: (id: string) => void;
  readonly deleteSmartCollection: (id: string, name: string) => void;
}

/**
 * 侧边栏菜单在基线 CommandContext 之上追加的判定字段。
 * menuKind 对应 ContextMenuDescriptor 的三个侧边栏分支类型；subjectId /
 * subjectName 即描述符的 id/folderId 与 name。locationKind / status /
 * linkedFolderResolved / linkedFolder 仅文件夹分支填充，其余分支保持缺省。
 */
export interface SidebarCommandContext extends CommandContext {
  readonly menuKind: 'folder' | 'organization' | 'smart-collection';
  readonly subjectId: string;
  readonly subjectName: string;
  /** 仅文件夹分支：托管 / 链接。 */
  readonly locationKind?: 'managed' | 'linked';
  /** 仅链接文件夹：外部根目录是否可达（对应描述符的可选 status）。 */
  readonly status?: 'available' | 'offline';
  /** 仅链接文件夹：linkedFolders 列表中是否已解析出对应摘要。 */
  readonly linkedFolderResolved: boolean;
  /** 仅链接文件夹且已解析：folder.linked-rules 的 run 直接透传给 action。 */
  readonly linkedFolder?: LinkedFolderSummary;
  readonly actions: SidebarCommandActions;
}

export type SidebarCommandDefinition =
  CommandDefinition<SidebarCommandContext>;

const OFFLINE_LINKED_REASON = '链接文件夹当前离线';

/** REQ-MENU-006：链接文件夹离线时禁用路径操作（禁用 + 原因，而不是隐藏）。 */
function isOfflineLinked(ctx: SidebarCommandContext): boolean {
  return ctx.locationKind === 'linked' && ctx.status === 'offline';
}

// 注册顺序即组内展示顺序，与历史 JSX 中的条目顺序一致。danger 不是注册表
// 核心字段，删除项的红色样式仍由 JSX 按历史位置声明（与 0015-B/C 相同）。
export const sidebarCommandDefinitions: readonly SidebarCommandDefinition[] = [
  // ---- 文件夹：打开 ----
  {
    id: 'folder.open-in-file-manager',
    title: (ctx) =>
      ctx.platform === 'mac' ? '在 Finder 中打开' : '在文件资源管理器中打开',
    group: 'open',
    visible: (ctx) => ctx.menuKind === 'folder',
    disabledReason: (ctx) => (isOfflineLinked(ctx) ? OFFLINE_LINKED_REASON : null),
    run: (ctx) => ctx.actions.openFolderInFileManager(ctx.subjectId),
  },
  // ---- 文件夹：组织 ----
  {
    id: 'folder.create-subfolder',
    title: '新建子文件夹',
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'folder' && ctx.locationKind === 'managed',
    run: (ctx) => ctx.actions.createSubfolder(ctx.subjectId),
  },
  {
    id: 'folder.rename',
    title: '重命名…',
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'folder' && ctx.locationKind === 'managed',
    run: (ctx) => ctx.actions.renameFolder(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'folder.linked-rules',
    title: '链接规则…',
    group: 'organize',
    visible: (ctx) =>
      ctx.menuKind === 'folder' &&
      ctx.locationKind === 'linked' &&
      ctx.linkedFolderResolved,
    run: (ctx) => {
      if (ctx.linkedFolder !== undefined) {
        ctx.actions.openLinkedRules(ctx.linkedFolder);
      }
    },
  },
  {
    id: 'folder.copy-path',
    title: '复制文件夹路径',
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'folder',
    disabledReason: (ctx) => (isOfflineLinked(ctx) ? OFFLINE_LINKED_REASON : null),
    run: (ctx) => ctx.actions.copyFolderPath(ctx.subjectId),
  },
  // ---- 合集（organization）：三项恒可见 ----
  {
    id: 'collection.rename',
    title: '重命名合集',
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'organization',
    run: (ctx) => ctx.actions.renameOrganization(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'collection.edit-details',
    title: '编辑合集详情',
    group: 'metadata',
    visible: (ctx) => ctx.menuKind === 'organization',
    run: (ctx) => ctx.actions.editCollectionDetails(ctx.subjectId),
  },
  {
    id: 'collection.delete',
    title: '删除合集',
    group: 'delete',
    visible: (ctx) => ctx.menuKind === 'organization',
    run: (ctx) => {
      const confirmed = window.confirm(
        `删除合集"${ctx.subjectName}"？\n（仅删除合集结构，不删除资产）`,
      );
      if (confirmed) {
        ctx.actions.deleteOrganization(ctx.subjectId, ctx.subjectName);
      }
    },
  },
  // ---- 智能合集：三项恒可见 ----
  {
    id: 'smart-collection.rename',
    title: '重命名智能合集',
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'smart-collection',
    run: (ctx) =>
      ctx.actions.renameSmartCollection(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'smart-collection.update-query',
    title: '用当前条件更新',
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'smart-collection',
    run: (ctx) => ctx.actions.updateSmartCollection(ctx.subjectId),
  },
  {
    id: 'smart-collection.delete',
    title: '删除智能合集',
    group: 'delete',
    visible: (ctx) => ctx.menuKind === 'smart-collection',
    run: (ctx) => {
      if (window.confirm(`删除智能合集"${ctx.subjectName}"？`)) {
        ctx.actions.deleteSmartCollection(ctx.subjectId, ctx.subjectName);
      }
    },
  },
];
