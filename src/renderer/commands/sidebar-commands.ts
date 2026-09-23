// ---------------------------------------------------------------------------
// 侧边栏右键菜单命令定义（REQ-COMMAND-001，切片 0015-D）
// ---------------------------------------------------------------------------

import type { LinkedFolderSummary } from '../../shared/asset-types';
import {
  linkedRevealFolderId,
  parseLinkedVirtualFolderId,
} from '../../shared/linked-folder-tree';
import { translateForLocale } from '../i18n';
import type { CommandContext, CommandDefinition } from './command-types';

function revealFolderId(ctx: SidebarCommandContext): string {
  if (ctx.locationKind === 'linked') {
    // Context-menu callers use the virtual id as subjectId for child rows so
    // mutations target that directory.  Do not encode the child path twice
    // when an open/copy-path action asks for its resolved folder id.
    if (parseLinkedVirtualFolderId(ctx.subjectId)) return ctx.subjectId;
    return linkedRevealFolderId(ctx.subjectId, ctx.linkedRelativePath);
  }
  return ctx.subjectId;
}

export interface SidebarCommandActions {
  readonly openFolderInFileManager: (folderId: string) => void;
  readonly createSubfolder: (folderId: string) => void;
  /**
   * Serpent-316493: link a disk directory as a child of this managed folder
   * (folder context menu → 导入链接文件夹).
   */
  readonly importLinkedFolderInto: (folderId: string) => void;
  readonly renameFolder: (folderId: string, currentName: string) => void;
  readonly openLinkedRules: (folder: LinkedFolderSummary) => void;
  readonly copyFolderPath: (folderId: string) => void;
  /** OS file clipboard copy (clarification #5). */
  readonly copyFolder: (folderId: string) => void;
  /** Paste OS clipboard files into this folder (managed or linked). */
  readonly pasteIntoFolder: (folderId: string) => void;
  /** Duplicate a managed folder as sibling. */
  readonly cloneFolder: (folderId: string) => void;
  readonly expandFolderTree: (folderId: string) => void;
  readonly collapseFolderTree: (folderId: string) => void;
  /** Open move-target dialog for managed folder(s). */
  readonly moveFolder: (folderIds: string[]) => void;
  /** 托管文件夹 → Serpent 回收站。 */
  readonly trashManagedFolder: (folderId: string, name: string) => void;
  /** 托管或链接文件夹 → 不可逆的硬盘删除。 */
  readonly deleteFolderFromDisk: (folderId: string, name: string) => void;
  /** 仅链接根：删除链接记录；从不删除外部源文件。 */
  readonly removeLinkedFolder: (folderId: string, name: string) => void;
  readonly renameOrganization: (id: string, name: string) => void;
  readonly createSubcollection: (collectionId: string) => void;
  readonly editCollectionDetails: (collectionId: string) => void;
  readonly deleteOrganization: (id: string, name: string) => void;
  readonly renameSmartCollection: (id: string, name: string) => void;
  readonly updateSmartCollection: (id: string) => void;
  readonly deleteSmartCollection: (id: string, name: string) => void;
}

export interface SidebarCommandContext extends CommandContext {
  readonly menuKind: 'folder' | 'organization' | 'smart-collection';
  readonly subjectId: string;
  readonly subjectName: string;
  readonly locationKind?: 'managed' | 'linked';
  readonly status?: 'available' | 'offline';
  readonly linkedFolderResolved: boolean;
  readonly linkedFolder?: LinkedFolderSummary;
  /**
   * 2026-09-15 用户决定：链接文件夹没有「移入回收站」。链接根提供「移除链接文件夹」
   * （只删链接记录）与「强制从硬盘删除」；链接子文件夹只提供后者。
   */
  readonly isLinkedRoot?: boolean;
  /** Present when the subject is a linked child directory path. */
  readonly linkedRelativePath?: string;
  /**
   * Serpent-316493: the subject is the library root itself (the folder panel's
   * blank area). Only actions that make sense without a managed_folders row are
   * offered: open in file manager, create, import a linked folder, paste and
   * copy path. Rename / clone / move / trash / disk-delete / remove are hidden.
   */
  readonly isLibraryRoot?: boolean;
  readonly actions: SidebarCommandActions;
}

export type SidebarCommandDefinition =
  CommandDefinition<SidebarCommandContext>;

function isOfflineLinked(ctx: SidebarCommandContext): boolean {
  return ctx.locationKind === 'linked' && ctx.status === 'offline';
}

function offlineReason(ctx: SidebarCommandContext): string | null {
  return isOfflineLinked(ctx)
    ? translateForLocale(ctx.locale, 'command.reason.linkedOffline')
    : null;
}

export const sidebarCommandDefinitions: readonly SidebarCommandDefinition[] = [
  {
    id: 'folder.open-in-file-manager',
    title: (ctx) =>
      translateForLocale(
        ctx.locale,
        ctx.platform === 'mac'
          ? 'command.folder.revealInFinder'
          : 'command.folder.revealInExplorer',
      ),
    group: 'open',
    shortcut: {
      mac: { label: '⌘⇧S', key: 's', metaKey: true, shiftKey: true },
      windows: { label: 'Ctrl+Shift+S', key: 's', ctrlKey: true, shiftKey: true },
    },
    visible: (ctx) => ctx.menuKind === 'folder',
    disabledReason: offlineReason,
    run: (ctx) => ctx.actions.openFolderInFileManager(revealFolderId(ctx)),
  },
  {
    id: 'folder.create-subfolder',
    title: (ctx) =>
      translateForLocale(
        ctx.locale,
        ctx.isLibraryRoot
          ? 'command.folder.newFolder'
          : 'command.folder.newSubfolder',
      ),
    group: 'organize',
    // Finder/Explorer new-folder chord; Windows Ctrl twin (Serpent-vf8x).
    shortcut: {
      mac: { label: '⌘⇧N', key: 'n', metaKey: true, shiftKey: true },
      windows: { label: 'Ctrl+Shift+N', key: 'n', ctrlKey: true, shiftKey: true },
    },
    visible: (ctx) =>
      ctx.menuKind === 'folder' &&
      (ctx.locationKind === 'managed' || ctx.locationKind === 'linked'),
    run: (ctx) => ctx.actions.createSubfolder(ctx.subjectId),
  },
  {
    id: 'folder.expand-all',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.expandAll'),
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'folder',
    run: (ctx) => ctx.actions.expandFolderTree(ctx.subjectId),
  },
  {
    id: 'folder.collapse-all',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.collapseAll'),
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'folder',
    run: (ctx) => ctx.actions.collapseFolderTree(ctx.subjectId),
  },
  {
    id: 'folder.import-linked',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.folder.importLinked'),
    group: 'organize',
    // Serpent-316493: only a managed folder can own a linked child; linking a
    // folder under an existing linked folder stays unsupported.
    visible: (ctx) =>
      ctx.menuKind === 'folder' && ctx.locationKind === 'managed',
    run: (ctx) => ctx.actions.importLinkedFolderInto(ctx.subjectId),
  },
  {
    id: 'folder.rename',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.rename'),
    group: 'organize',
    shortcut: {
      mac: { label: 'F2', key: 'F2' },
      windows: { label: 'F2', key: 'F2' },
    },
    visible: (ctx) =>
      ctx.menuKind === 'folder' &&
      !ctx.isLibraryRoot &&
      (ctx.locationKind === 'managed' || ctx.locationKind === 'linked'),
    run: (ctx) => ctx.actions.renameFolder(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'folder.linked-rules',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.folder.linkedRules'),
    group: 'organize',
    // Serpent-c6d907: linked ignore is the same .serpentignore file as
    // managed folders. Keep the command for automation; do not offer a
    // separate rules window in the folder menu.
    visible: () => false,
    run: (ctx) => {
      if (ctx.linkedFolder !== undefined) {
        ctx.actions.openLinkedRules(ctx.linkedFolder);
      }
    },
  },
  {
    id: 'folder.copy-path',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.copyPath'),
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'folder',
    disabledReason: offlineReason,
    run: (ctx) => ctx.actions.copyFolderPath(revealFolderId(ctx)),
  },
  {
    id: 'folder.copy',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.copy'),
    group: 'organize',
    shortcut: {
      mac: { label: '⌘C', key: 'c', metaKey: true },
      windows: { label: 'Ctrl+C', key: 'c', ctrlKey: true },
    },
    visible: (ctx) => ctx.menuKind === 'folder' && !ctx.isLibraryRoot,
    disabledReason: offlineReason,
    run: (ctx) => ctx.actions.copyFolder(revealFolderId(ctx)),
  },
  {
    id: 'folder.paste',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.paste'),
    group: 'organize',
    shortcut: {
      mac: { label: '⌘V', key: 'v', metaKey: true },
      windows: { label: 'Ctrl+V', key: 'v', ctrlKey: true },
    },
    visible: (ctx) =>
      ctx.menuKind === 'folder' &&
      (ctx.locationKind === 'managed' || ctx.locationKind === 'linked'),
    run: (ctx) => ctx.actions.pasteIntoFolder(ctx.subjectId),
  },
  {
    id: 'folder.clone',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.clone'),
    group: 'organize',
    visible: (ctx) =>
      ctx.menuKind === 'folder' &&
      !ctx.isLibraryRoot &&
      ctx.locationKind === 'managed',
    run: (ctx) => ctx.actions.cloneFolder(ctx.subjectId),
  },
  {
    id: 'folder.move-to',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.moveTo'),
    group: 'organize',
    visible: () => false,
    run: (ctx) => ctx.actions.moveFolder([ctx.subjectId]),
  },
  {
    id: 'folder.move-to-trash',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.folder.moveToTrash'),
    group: 'delete',
    shortcut: {
      mac: { label: '⌘⌫', key: 'Backspace', metaKey: true },
      windows: { label: 'Delete', key: 'Delete' },
    },
    // 2026-09-15 用户决定：链接文件夹不再有「移入回收站」。链接条目本来就不属于
    // 资源库，之前却逐个文件送进系统回收站（实测 126 ms/文件，1.5 万文件约 31 分钟，
    // 且期间独占调度器）。链接文件夹现在只有「移除链接文件夹」与「强制从硬盘删除」。
    visible: (ctx) =>
      ctx.menuKind === 'folder' &&
      !ctx.isLibraryRoot &&
      ctx.locationKind === 'managed',
    disabledReason: offlineReason,
    run: (ctx) => {
      // 防御：visible 已把链接目标挡住，但直接调用（快捷键/自动化）也必须落空，
      // 否则会误走托管回收站。
      if (ctx.locationKind !== 'managed') return;
      ctx.actions.trashManagedFolder(ctx.subjectId, ctx.subjectName);
    },
  },
  {
    id: 'folder.delete-from-disk',
    title: (ctx) =>
      translateForLocale(
        ctx.locale,
        ctx.locationKind === 'linked'
          ? 'command.folder.forceDeleteFromDisk'
          : 'command.folder.deleteFromDisk',
      ),
    group: 'delete',
    shortcut: {
      mac: {
        label: '⌥⌘Delete',
        key: 'Delete',
        metaKey: true,
        altKey: true,
      },
      windows: { label: 'Shift+Delete', key: 'Delete', shiftKey: true },
    },
    visible: (ctx) =>
      ctx.menuKind === 'folder' &&
      !ctx.isLibraryRoot &&
      (ctx.locationKind === 'managed' || ctx.locationKind === 'linked'),
    disabledReason: offlineReason,
    run: (ctx) =>
      ctx.actions.deleteFolderFromDisk(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'folder.remove-from-library',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.folder.removeLinkedFolder'),
    group: 'delete',
    visible: (ctx) =>
      ctx.menuKind === 'folder' &&
      ctx.locationKind === 'linked' &&
      ctx.isLinkedRoot !== false,
    run: (ctx) =>
      ctx.actions.removeLinkedFolder(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'collection.create-subcollection',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.collection.newSubcollection'),
    group: 'organize',
    shortcut: {
      mac: { label: '⌘⇧N', key: 'n', metaKey: true, shiftKey: true },
      windows: { label: 'Ctrl+Shift+N', key: 'n', ctrlKey: true, shiftKey: true },
    },
    visible: (ctx) => ctx.menuKind === 'organization',
    run: (ctx) => ctx.actions.createSubcollection(ctx.subjectId),
  },
  {
    id: 'collection.rename',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.collection.rename'),
    group: 'organize',
    shortcut: {
      mac: { label: 'F2', key: 'F2' },
      windows: { label: 'F2', key: 'F2' },
    },
    visible: (ctx) => ctx.menuKind === 'organization',
    run: (ctx) =>
      ctx.actions.renameOrganization(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'collection.edit-details',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.collection.editDetails'),
    group: 'metadata',
    visible: (ctx) => ctx.menuKind === 'organization',
    run: (ctx) => ctx.actions.editCollectionDetails(ctx.subjectId),
  },
  {
    id: 'collection.delete',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.collection.delete'),
    group: 'delete',
    shortcut: {
      mac: { label: '⌘⌫', key: 'Backspace', metaKey: true },
      windows: { label: 'Delete', key: 'Delete' },
    },
    visible: (ctx) => ctx.menuKind === 'organization',
    // Confirmation is resolved by the renderer action, which can distinguish
    // empty collections (direct delete) from collections with members/children.
    run: (ctx) => ctx.actions.deleteOrganization(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'smart-collection.rename',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.smartCollection.rename'),
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'smart-collection',
    run: (ctx) =>
      ctx.actions.renameSmartCollection(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'smart-collection.update-query',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.smartCollection.updateQuery'),
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'smart-collection',
    run: (ctx) => ctx.actions.updateSmartCollection(ctx.subjectId),
  },
  {
    id: 'smart-collection.delete',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.smartCollection.delete'),
    group: 'delete',
    visible: (ctx) => ctx.menuKind === 'smart-collection',
    run: (ctx) => {
      if (
        window.confirm(
          translateForLocale(
            ctx.locale,
            'command.smartCollection.deleteConfirm',
            { name: ctx.subjectName },
          ),
        )
      ) {
        ctx.actions.deleteSmartCollection(ctx.subjectId, ctx.subjectName);
      }
    },
  },
];
