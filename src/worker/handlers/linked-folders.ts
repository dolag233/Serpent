import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export type LinkedFolderCommandHooks = {
  scheduleThumbnails: (
    libraryId: string,
    scene: 'linked' | 'mutation',
    assetIds?: string[],
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

export async function executeLinkedFolderWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: LinkedFolderCommandHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'linked-folder.remove': {
      const result = await libraryService.removeLinkedFolder(request.command);
      hooks.recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.linked-folder.remove',
        reason: 'linked-folder-index-remove',
        affectedCount: Math.max(1, result.removedAssetCount),
        affectedEntities: [request.command.folderId],
        historyContext: request.historyContext,
      });
      return {
        ok: true,
        type: 'linked-folder.removed',
        folderId: request.command.folderId,
        ...result,
      };
    }
    case 'linked-folder.delete-subtree': {
      const result = await libraryService.deleteLinkedFolderSubtree(request.command);
      hooks.recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.linked-folder.delete-subtree',
        reason: request.command.deleteFromDisk
          ? 'linked-folder-source-permanent-delete'
          : 'linked-folder-source-os-trash-and-index-remove',
        affectedCount: Math.max(1, result.deletedAssetCount),
        affectedEntities: [request.command.linkedFolderId],
        historyContext: request.historyContext,
      });
      return {
        ok: true,
        type: 'linked-folder.subtree-deleted',
        linkedFolderId: request.command.linkedFolderId,
        relativePath: request.command.relativePath,
        ...result,
      };
    }
    case 'linked-folder.create-directory': {
      const lease = await libraryService.acquireWriteLease(request.command.libraryId);
      try {
        const folder = libraryService.createLinkedFolderDirectory(request.command);
        return { ok: true, type: 'linked-folder.directory-created', folder };
      } finally {
        lease.release();
      }
    }
    case 'linked-folder.rename-directory': {
      const lease = await libraryService.acquireWriteLease(request.command.libraryId);
      try {
        const folder = libraryService.renameLinkedFolderDirectory(request.command);
        return { ok: true, type: 'linked-folder.directory-renamed', folder };
      } finally {
        lease.release();
      }
    }
    case 'linked-folder.list':
      return {
        ok: true,
        type: 'linked-folder.list',
        folders: libraryService.listLinkedFolders(request.command.libraryId),
      };
    case 'linked-folder.relink': {
      const linkedFolder = libraryService.relinkMissingFolder(request.command);
      hooks.scheduleThumbnails(request.command.libraryId, 'linked');
      return { ok: true, type: 'linked-folder.relinked', linkedFolder };
    }
    case 'linked-folder.rules.get':
      return { ok: true, type: 'linked-folder.rules', rules: libraryService.getLinkedFolderRules(request.command) };
    case 'linked-folder.rules.set': {
      const result = libraryService.setLinkedFolderRules(request.command);
      hooks.scheduleThumbnails(request.command.libraryId, 'linked');
      return { ok: true, type: 'linked-folder.rules.updated', ...result };
    }
    case 'linked-folder.assets.copy': {
      const result = libraryService.copyAssetsToLinkedFolder(request.command);
      hooks.scheduleThumbnails(
        request.command.libraryId,
        'linked',
        result.assets.map((asset) => asset.assetId),
      );
      // copiedSourceAssetIds 是内部实现细节（供 moveAssets 移动后清理源），
      // 不进公共响应 schema（strict）。
      const { copiedCount, skippedCount, assets } = result;
      return { ok: true, type: 'linked-folder.assets.copied', copiedCount, skippedCount, assets };
    }
    case 'linked-folder.convert': {
      const result = libraryService.convertLinkedFolderToManaged(request.command);
      hooks.scheduleThumbnails(
        request.command.libraryId,
        'mutation',
        result.assets.map((asset) => asset.assetId),
      );
      return { ok: true, type: 'linked-folder.converted', ...result };
    }
    default:
      return undefined;
  }
}
