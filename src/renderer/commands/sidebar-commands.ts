// ---------------------------------------------------------------------------
// 侧边栏右键菜单命令定义（REQ-COMMAND-001，切片 0015-D）
// ---------------------------------------------------------------------------

import type { LinkedFolderSummary } from '../../shared/asset-types';
import { translateForLocale } from '../i18n';
import type { CommandContext, CommandDefinition } from './command-types';

export interface SidebarCommandActions {
  readonly openFolderInFileManager: (folderId: string) => void;
  readonly createSubfolder: (folderId: string) => void;
  readonly renameFolder: (folderId: string, currentName: string) => void;
  readonly openLinkedRules: (folder: LinkedFolderSummary) => void;
  readonly copyFolderPath: (folderId: string) => void;
  readonly renameOrganization: (id: string, name: string) => void;
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
    run: (ctx) => ctx.actions.openFolderInFileManager(ctx.subjectId),
  },
  {
    id: 'folder.create-subfolder',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.folder.newSubfolder'),
    group: 'organize',
    visible: (ctx) => ctx.menuKind === 'folder' && ctx.locationKind === 'managed',
    run: (ctx) => ctx.actions.createSubfolder(ctx.subjectId),
  },
  {
    id: 'folder.rename',
    title: (ctx) => translateForLocale(ctx.locale, 'command.folder.rename'),
    group: 'organize',
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
    run: (ctx) => ctx.actions.copyFolderPath(ctx.subjectId),
  },
  {
    id: 'collection.rename',
    title: (ctx) =>
      translateForLocale(ctx.locale, 'command.collection.rename'),
    group: 'organize',
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
    visible: (ctx) => ctx.menuKind === 'organization',
    run: (ctx) => {
      const confirmed = window.confirm(
        translateForLocale(ctx.locale, 'command.collection.deleteConfirm', {
          name: ctx.subjectName,
        }),
      );
      if (confirmed) {
        ctx.actions.deleteOrganization(ctx.subjectId, ctx.subjectName);
      }
    },
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
