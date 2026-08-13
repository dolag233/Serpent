// ---------------------------------------------------------------------------
// 侧边栏右键菜单命令定义（REQ-COMMAND-001，切片 0015-D）
// ---------------------------------------------------------------------------

import type { LinkedFolderSummary } from '../../shared/asset-types';
import { linkedRevealFolderId } from '../../shared/linked-folder-tree';
import { translateForLocale } from '../i18n';
import type { CommandContext, CommandDefinition } from './command-types';

function revealFolderId(ctx: SidebarCommandContext): string {
  if (ctx.locationKind === 'linked') {
    return linkedRevealFolderId(ctx.subjectId, ctx.linkedRelativePath);
  }
  return ctx.subjectId;
}

export interface SidebarCommandActions {
  readonly openFolderInFileManager: (folderId: string) => void;
  readonly createSubfolder: (folderId: string) => void;
  readonly renameFolder: (folderId: string, currentName: string) => void;
  readonly openLinkedRules: (folder: LinkedFolderSummary) => void;
  readonly copyFolderPath: (folderId: string) => void;
  /** OS file clipboard copy (clarification #5). */
  readonly copyFolder: (folderId: string) => void;
  /** Paste OS clipboard files into this managed folder. */
  readonly pasteIntoFolder: (folderId: string) => void;
  /** Duplicate managed folder as sibling. */
  readonly cloneFolder: (folderId: string) => void;
  /** Open move-target dialog for managed folder(s). */
  readonly moveFolder: (folderIds: string[]) => void;
  /** Managed folder → app trash (clarification #7). */
  readonly trashManagedFolder: (folderId: string, name: string) => void;
  /** Managed or linked-child folder → irreversible disk delete. */
  readonly deleteFolderFromDisk: (folderId: string, name: string) => void;
  /** Linked root only: remove index; never deletes source files. */
  readonly removeLinkedFolder: (folderId: string, name: string) => void;
  /** Linked child path → OS trash + drop index rows. */
  readonly trashLinkedFolderSubtree: (
    linkedFolderId: string,
    relativePath: string,
    name: string,
  ) => void;
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
   * Linked roots only expose "remove from library". Linked child folders
   * (relativePath set) use the same trash / disk-delete entries as managed.
   */
  readonly isLinkedRoot?: boolean;
  /** Present when the subject is a linked child directory path. */
  readonly linkedRelativePath?: string;
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
    visible: (ctx) => ctx.menuKind === 'folder',
    disabledReason: offlineReason,
    run: (ctx) => ctx.actions.openFolderInFileManager(revealFolderId(ctx)),
  },
  {
    id: 'folder.create-subfolder',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.folder.newSubfolder'),
    group: 'organize',
    // Finder/Explorer new-folder chord; Windows Ctrl twin (Serpent-vf8x).
    shortcut: {
      mac: { label: '⌘⇧N', key: 'n', metaKey: true, shiftKey: true },
      windows: { label: 'Ctrl+Shift+N', key: 'n', ctrlKey: true, shiftKey: true },
    },
    visible: (ctx) => ctx.menuKind === 'folder' && ctx.locationKind === 'managed',
    run: (ctx) => ctx.actions.createSubfolder(ctx.subjectId),
  },
  {
    id: 'folder.rename',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.rename'),
    group: 'organize',
    shortcut: {
      mac: { label: 'F2', key: 'F2' },
      windows: { label: 'F2', key: 'F2' },
    },
    visible: (ctx) => ctx.menuKind === 'folder' && ctx.locationKind === 'managed',
    run: (ctx) => ctx.actions.renameFolder(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'folder.linked-rules',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.folder.linkedRules'),
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
    visible: (ctx) => ctx.menuKind === 'folder',
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
    visible: (ctx) => ctx.menuKind === 'folder' && ctx.locationKind === 'managed',
    run: (ctx) => ctx.actions.pasteIntoFolder(ctx.subjectId),
  },
  {
    id: 'folder.clone',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.clone'),
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'folder' && ctx.locationKind === 'managed',
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
    visible: (ctx) =>
      ctx.menuKind === 'folder' &&
      (ctx.locationKind === 'managed' ||
        (ctx.locationKind === 'linked' && ctx.isLinkedRoot === false)),
    disabledReason: offlineReason,
    run: (ctx) => {
      if (ctx.locationKind === 'managed') {
        ctx.actions.trashManagedFolder(ctx.subjectId, ctx.subjectName);
        return;
      }
      if (
        ctx.locationKind === 'linked' &&
        ctx.linkedRelativePath !== undefined
      ) {
        ctx.actions.trashLinkedFolderSubtree(
          ctx.subjectId,
          ctx.linkedRelativePath,
          ctx.subjectName,
        );
      }
    },
  },
  {
    id: 'folder.delete-from-disk',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.folder.deleteFromDisk'),
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
      (ctx.locationKind === 'managed' ||
        (ctx.locationKind === 'linked' && ctx.isLinkedRoot === false)),
    disabledReason: offlineReason,
    run: (ctx) =>
      ctx.actions.deleteFolderFromDisk(ctx.subjectId, ctx.subjectName),
  },
  {
    id: 'folder.remove-from-library',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.folder.removeFromLibrary'),
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
