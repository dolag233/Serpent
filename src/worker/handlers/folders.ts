import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import { LibraryServiceError, type LibraryService } from '../library-service';

export type FolderCommandHooks = {
  scheduleCoverThumbnails: (
    libraryId: string,
    assetIds: string[],
    maxIds: number,
  ) => void;
  recordPermanentDeleteBarrier: (input: {
    affectedCount: number;
    affectedEntities?: readonly string[];
    commandId: string;
    labelKey: string;
    libraryId: string;
    reason: string;
    historyContext?: WorkerRequest['historyContext'];
  }) => void;
};

export async function executeFolderWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: FolderCommandHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'folder.rename': {
      const command = request.command;
      const before = libraryService.getManagedFolderHistorySnapshot({
        libraryId: command.libraryId,
        folderIds: [command.folderId],
      });
      const folder = libraryService.renameManagedFolder(command);
      const after = libraryService.getManagedFolderHistorySnapshot({
        libraryId: command.libraryId,
        folderIds: [command.folderId],
      });
      const beforeRoot = before.find((item) => item.folderId === command.folderId);
      const afterRoot = after.find((item) => item.folderId === command.folderId);
      if (!beforeRoot || !afterRoot) throw new LibraryServiceError('LIBRARY_CORRUPT');
      const historyEntryId = libraryService.recordOperationHistory({
        libraryId: command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: command.type,
        labelKey: 'history.folder.rename',
        labelArgs: { count: 1 },
        affectedCount: 1,
        affectedEntities: [command.folderId],
        forwardRecipe: {
          kind: 'managed-folder-rename',
          version: 1,
          payload: {
            folderId: command.folderId,
            expectedName: beforeRoot.name,
            newName: afterRoot.name,
          },
        },
        inverseRecipe: {
          kind: 'managed-folder-rename',
          version: 1,
          payload: {
            folderId: command.folderId,
            expectedName: afterRoot.name,
            newName: beforeRoot.name,
          },
        },
      }).historyEntryId;
      return { ok: true, type: 'folder.renamed', folder, historyEntryId };
    }
    case 'folder.clone': {
      const result = libraryService.cloneManagedFolder(request.command);
      return {
        ok: true,
        type: 'folder.cloned',
        folder: result.folder,
        clonedFolderCount: result.clonedFolderCount,
        clonedAssetCount: result.clonedAssetCount,
      };
    }
    case 'folder.move': {
      const before = libraryService.getManagedFolderHistorySnapshot({
        libraryId: request.command.libraryId,
        folderIds: request.command.folderIds,
      });
      const result = libraryService.moveManagedFolders(request.command);
      const after = result.folders.length === 0
        ? []
        : libraryService.getManagedFolderHistorySnapshot({
          libraryId: request.command.libraryId,
          folderIds: result.folders.map((folder) => folder.folderId),
        });
      const beforeById = new Map(before.map((item) => [item.folderId, item]));
      const afterById = new Map(after.map((item) => [item.folderId, item]));
      const movedRoots = result.folders
        .map((folder) => ({ before: beforeById.get(folder.folderId), after: afterById.get(folder.folderId) }))
        .filter((item): item is { before: NonNullable<typeof item.before>; after: NonNullable<typeof item.after> } => item.before !== undefined && item.after !== undefined);
      const historyEntryId = movedRoots.length === 0 ? undefined : libraryService.recordOperationHistory({
        libraryId: request.command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: request.command.type,
        labelKey: 'history.folder.move',
        labelArgs: { count: movedRoots.length },
        affectedCount: movedRoots.length,
        affectedEntities: movedRoots.map((item) => item.after.folderId),
        forwardRecipe: {
          kind: 'managed-folder-move',
          version: 1,
          payload: {
            moves: movedRoots.map((item) => ({
              folderId: item.after.folderId,
              expectedName: item.before.name,
              expectedParentFolderId: item.before.parentFolderId,
              targetParentFolderId: item.after.parentFolderId,
              targetName: item.after.name,
            })),
          },
        },
        inverseRecipe: {
          kind: 'managed-folder-move',
          version: 1,
          payload: {
            moves: movedRoots.map((item) => ({
              folderId: item.before.folderId,
              expectedName: item.after.name,
              expectedParentFolderId: item.after.parentFolderId,
              targetParentFolderId: item.before.parentFolderId,
              targetName: item.before.name,
            })),
          },
        },
      }).historyEntryId;
      return {
        ok: true,
        type: 'folder.moved',
        movedCount: result.movedCount,
        skippedCount: result.skippedCount,
        folders: result.folders,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
    }
    case 'folder.get-path': {
      // Main-only consumer (shell/clipboard); the path never reaches the Renderer.
      const absolutePath = libraryService.resolveFolderPath(
        request.command.libraryId,
        request.command.folderId,
      );
      return { ok: true, type: 'folder.path', folderId: request.command.folderId, absolutePath };
    }
    case 'folder.list':
      return {
        ok: true,
        type: 'folder.list',
        folders: libraryService.listManagedFolders(request.command.libraryId, request.command.showIgnored === true),
      };
    case 'folder.browse-entries': {
      const entries = libraryService.listFolderBrowseEntries({
        libraryId: request.command.libraryId,
        parentFolderId: request.command.parentFolderId,
        showIgnored: request.command.showIgnored === true,
      });
      // Serpent-d0nv: folder covers are direct assets of child folders —
      // outside the current view's visible wave (asset.list only schedules
      // the current folder's assets). Schedule the cover candidates at the
      // cover tier (400 > visible 350) so folder cards get covers before the
      // rest of the library's p50 path-alphabetical backfill. maxIds = up to
      // 4 candidates per child folder (Serpent-9021d1).
      const coverAssetIds = entries.flatMap((entry) => entry.coverAssetIds);
      if (coverAssetIds.length > 0) {
        hooks.scheduleCoverThumbnails(
          request.command.libraryId,
          coverAssetIds,
          entries.length * 4,
        );
      }
      return {
        ok: true,
        type: 'folder.browse-entries',
        entries,
      };
    }
    case 'folder.indexed-bytes':
      return {
        ok: true,
        type: 'folder.indexed-bytes',
        sizes: libraryService.folderIndexedByteSizes({
          libraryId: request.command.libraryId,
          refs: request.command.refs,
        }),
      };
    case 'folder.entries': {
      const entries = libraryService.folderEntriesByRefs({
        libraryId: request.command.libraryId,
        refs: request.command.refs,
      });
      // Mirror the browse-entries behavior: schedule cover candidates so
      // search-result folder cards get their previews too (Serpent-f74e48).
      const coverAssetIds = entries.flatMap((entry) => entry.coverAssetIds);
      if (coverAssetIds.length > 0) {
        hooks.scheduleCoverThumbnails(
          request.command.libraryId,
          coverAssetIds,
          entries.length * 4,
        );
      }
      return {
        ok: true,
        type: 'folder.entries',
        entries,
      };
    }
    case 'folder.list-trashed': {
      const folders = libraryService.listTrashedFolders(request.command.libraryId);
      return { ok: true, type: 'folder.list-trashed', folders };
    }
    case 'folder.restore-trashed': {
      const result = libraryService.restoreTrashedManagedFolder(request.command);
      const restoredRoot = result.folders[0];
      const historyEntryId = restoredRoot ? libraryService.recordOperationHistory({
        libraryId: request.command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: request.command.type,
        labelKey: 'history.folder.restore',
        labelArgs: { count: result.restoredFolderCount },
        affectedCount: result.restoredFolderCount,
        affectedEntities: result.folders.map((folder) => folder.folderId),
        forwardRecipe: {
          kind: 'managed-folder-restore',
          version: 1,
          payload: { tombstoneId: request.command.tombstoneId },
        },
        inverseRecipe: {
          kind: 'managed-folder-trash',
          version: 1,
          payload: { folderId: restoredRoot.folderId },
        },
      }).historyEntryId : undefined;
      return { ok: true, type: 'folder.restored-trashed', ...result, ...(historyEntryId ? { historyEntryId } : {}) };
    }
    case 'folder.trash': {
      const result = await libraryService.trashManagedFolderAsync(request.command);
      const historyEntryId = result.rootTombstoneId ? libraryService.recordOperationHistory({
        libraryId: request.command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: request.command.type,
        labelKey: 'history.folder.trash',
        labelArgs: { count: result.removedFolderCount },
        affectedCount: result.removedFolderCount,
        affectedEntities: [request.command.folderId],
        forwardRecipe: {
          kind: 'managed-folder-trash',
          version: 1,
          payload: { folderId: request.command.folderId },
        },
        inverseRecipe: {
          kind: 'managed-folder-restore',
          version: 1,
          payload: { tombstoneId: result.rootTombstoneId },
        },
      }).historyEntryId : undefined;
      const { rootTombstoneId: internalRootTombstoneId, ...publicResult } = result;
      void internalRootTombstoneId;
      return {
        ok: true,
        type: 'folder.trashed',
        folderId: request.command.folderId,
        ...publicResult,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
    }
    case 'folder.delete-from-disk': {
      const result = await libraryService.deleteManagedFolderFromDiskAsync(request.command);
      hooks.recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.folder.delete-from-disk',
        reason: 'managed-folder-permanent-delete',
        affectedCount: result.deletedAssetCount + result.removedFolderCount,
        affectedEntities: [request.command.folderId],
        historyContext: request.historyContext,
      });
      return {
        ok: true,
        type: 'folder.deleted-from-disk',
        folderId: request.command.folderId,
        ...result,
      };
    }
    case 'folder.delete-empty': {
      const before = libraryService.getManagedFolderHistorySnapshot({
        libraryId: request.command.libraryId,
        folderIds: request.command.folderIds,
      });
      const result = libraryService.deleteEmptyManagedFolders(request.command);
      const deletedIds = new Set(result.deletedFolderIds);
      const deletedBefore = before.filter((folder) => deletedIds.has(folder.folderId));
      const historyEntryId = deletedBefore.length === 0
        ? undefined
        : libraryService.recordManagedFolderSnapshotHistory({
          libraryId: request.command.libraryId,
          before: deletedBefore,
          after: [],
          commandId: request.command.type,
          labelKey: 'history.folder.delete-empty',
          affectedCount: deletedBefore.length,
          source: request.historyContext?.source ?? 'desktop',
          sourceReference: request.historyContext?.sourceReference ?? null,
        }).historyEntryId;
      return {
        ok: true,
        type: 'folder.empty-deleted',
        ...result,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
    }
    default:
      return undefined;
  }
}
