import path from 'node:path';

import type { WorkerCommand, WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import { LibraryServiceError, type LibraryService } from '../library-service';

export type AssetMutationHooks = {
  scheduleThumbnails: (
    libraryId: string,
    scene: 'mutation' | 'restore' | 'visible',
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

function recordDesktopAssetHistory(
  libraryService: LibraryService,
  command: Extract<WorkerCommand,
    { type: 'asset.move' | 'asset.copy' | 'asset.trash' }>,
  result: {
    count: number;
    operationId: string | null;
    outputAssetIdsBySource?: ReadonlyArray<{ sourceAssetId: string; newAssetId: string }>;
  },
  historyContext?: WorkerRequest['historyContext'],
): string | undefined {
  if (result.count <= 0 || !result.operationId) return undefined;
  let kind: string;
  let inverseKind: string;
  let forwardPayload: Record<string, unknown>;
  switch (command.type) {
    case 'asset.move':
      kind = 'managed-asset-move';
      inverseKind = 'managed-asset-move-undo';
      forwardPayload = {
        assetIds: command.assetIds,
        targetFolderId: command.targetFolderId,
        conflictStrategy: command.conflictStrategy,
      };
      break;
    case 'asset.copy':
      kind = 'managed-asset-copy';
      inverseKind = 'managed-asset-copy-undo';
      forwardPayload = {
        assetIds: command.assetIds,
        targetFolderId: command.targetFolderId,
        conflictStrategy: command.conflictStrategy,
        ...(result.outputAssetIdsBySource && result.outputAssetIdsBySource.length > 0
          ? { outputAssetIds: result.outputAssetIdsBySource }
          : {}),
      };
      break;
    case 'asset.trash':
      kind = 'asset-trash';
      inverseKind = 'asset-trash-undo';
      forwardPayload = { assetIds: command.assetIds };
      break;
  }
  return libraryService.recordOperationHistory({
    libraryId: command.libraryId,
    source: historyContext?.source ?? 'desktop',
    sourceReference: historyContext?.sourceReference ?? null,
    commandId: command.type,
    labelKey: `history.${command.type}`,
    labelArgs: { count: result.count },
    affectedCount: result.count,
    affectedEntities: command.assetIds,
    forwardRecipe: { kind, version: 1, payload: forwardPayload },
    inverseRecipe: {
      kind: inverseKind,
      version: 1,
      payload: { operationId: result.operationId },
    },
  }).historyEntryId;
}

function recordDesktopAssetRenameHistory(
  libraryService: LibraryService,
  command: Extract<WorkerCommand, { type: 'asset.rename-file' }>,
  beforeFileName: string,
  historyContext?: WorkerRequest['historyContext'],
): string {
  const usesCompleteFileName = command.newFileName !== undefined;
  const beforeExtension = path.extname(beforeFileName);
  const beforeBaseName = beforeExtension.length > 0
    ? beforeFileName.slice(0, -beforeExtension.length)
    : beforeFileName;
  const forwardPayload = usesCompleteFileName
    ? {
      assetId: command.assetId,
      expectedFileName: beforeFileName,
      newFileName: command.newFileName!,
    }
    : {
      assetId: command.assetId,
      expectedBaseName: beforeBaseName,
      newBaseName: command.newBaseName!,
    };
  const inversePayload = usesCompleteFileName
    ? {
      assetId: command.assetId,
      expectedFileName: command.newFileName!,
      newFileName: beforeFileName,
    }
    : {
      assetId: command.assetId,
      expectedBaseName: command.newBaseName!,
      newBaseName: beforeBaseName,
    };
  return libraryService.recordOperationHistory({
    libraryId: command.libraryId,
    source: historyContext?.source ?? 'desktop',
    sourceReference: historyContext?.sourceReference ?? null,
    commandId: command.type,
    labelKey: 'history.asset.rename',
    labelArgs: { count: 1 },
    affectedCount: 1,
    affectedEntities: [command.assetId],
    forwardRecipe: {
      kind: 'asset-rename',
      version: 1,
      payload: forwardPayload,
    },
    inverseRecipe: {
      kind: 'asset-rename',
      version: 1,
      payload: inversePayload,
    },
  }).historyEntryId;
}

export async function executeAssetMutationWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: AssetMutationHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'asset.trash': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'trash',
          assetIds: request.command.assetIds,
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const { trashedCount, operationId } = libraryService.trashAssets(request.command);
      const historyEntryId = recordDesktopAssetHistory(libraryService, request.command, {
        count: trashedCount,
        operationId,
      }, request.historyContext);
      return {
        ok: true,
        type: 'asset.trashed',
        trashedCount,
        operationId,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
    }
    case 'asset.content.replace': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'replace-content',
          assetIds: [request.command.assetId],
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const result = libraryService.replaceManagedAssetContent(request.command);
      hooks.scheduleThumbnails(request.command.libraryId, 'mutation', [result.assetId]);
      return { ok: true, type: 'asset.content.replaced', ...result };
    }
    case 'asset.content.stage': {
      const result = libraryService.stageManagedAssetContent(request.command);
      return { ok: true, type: 'asset.content.staged', ...result };
    }
    case 'asset.content.replace-batch': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'replace-content',
          assetIds: request.command.items.map((item) => item.assetId),
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const result = libraryService.replaceManagedAssetContentBatch(request.command);
      hooks.scheduleThumbnails(
        request.command.libraryId,
        'mutation',
        result.items.map((item) => item.assetId),
      );
      return { ok: true, type: 'asset.content.batch-replaced', ...result };
    }
    case 'asset.content.read': {
      const result = libraryService.readManagedAssetContent(request.command);
      return { ok: true, type: 'asset.content.read', ...result };
    }
    case 'asset.restore': {
      const { restoredCount, assets } = libraryService.restoreAssets(request.command);
      const historyEntryId = restoredCount > 0 ? libraryService.recordOperationHistory({
        libraryId: request.command.libraryId,
        source: request.historyContext?.source ?? 'desktop',
        sourceReference: request.historyContext?.sourceReference ?? null,
        commandId: request.command.type,
        labelKey: 'history.asset.restore',
        labelArgs: { count: restoredCount },
        affectedCount: restoredCount,
        affectedEntities: assets.map((asset) => asset.assetId),
        forwardRecipe: {
          kind: 'asset-restore',
          version: 1,
          payload: {
            assetIds: assets.map((asset) => asset.assetId),
            targetFolderId: request.command.targetFolderId ?? undefined,
            conflictStrategy: request.command.conflictStrategy,
          },
        },
        inverseRecipe: {
          kind: 'asset-trash',
          version: 1,
          payload: { assetIds: assets.map((asset) => asset.assetId) },
        },
      }).historyEntryId : undefined;
      hooks.scheduleThumbnails(request.command.libraryId, 'restore', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.restored', restoredCount, assets, ...(historyEntryId ? { historyEntryId } : {}) };
    }
    case 'asset.restore-preview': {
      const preview = libraryService.previewRestoreAssets(request.command);
      return { ok: true, type: 'asset.restore-previewed', ...preview };
    }
    case 'asset.move': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'move',
          assetIds: request.command.assetIds,
          targetFolderId: request.command.targetFolderId,
          ...(request.command.conflictStrategy === undefined
            ? {}
            : { conflictStrategy: request.command.conflictStrategy }),
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const { movedCount, skippedCount, operationId, assets } = libraryService.moveAssets(request.command);
      const historyEntryId = recordDesktopAssetHistory(libraryService, request.command, {
        count: movedCount,
        operationId,
      }, request.historyContext);
      hooks.scheduleThumbnails(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return {
        ok: true,
        type: 'asset.moved',
        movedCount,
        skippedCount,
        operationId,
        assets,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
    }
    case 'asset.move-undo': {
      const { undoneCount, skippedCount, assets } = libraryService.undoMoveAssets(request.command);
      hooks.scheduleThumbnails(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.move-undone', undoneCount, skippedCount, assets };
    }
    case 'asset.trash-undo': {
      const { restoredCount, skippedCount, assets } = libraryService.undoTrashAssets(request.command);
      hooks.scheduleThumbnails(request.command.libraryId, 'restore', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.trash-undone', restoredCount, skippedCount, assets };
    }
    case 'asset.copy': {
      const { copiedCount, skippedCount, operationId, assets, outputAssetIdsBySource } = libraryService.copyAssets(request.command);
      const historyEntryId = recordDesktopAssetHistory(libraryService, request.command, {
        count: copiedCount,
        operationId,
        outputAssetIdsBySource,
      }, request.historyContext);
      hooks.scheduleThumbnails(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return {
        ok: true,
        type: 'asset.copied',
        copiedCount,
        skippedCount,
        operationId,
        assets,
        ...(historyEntryId ? { historyEntryId } : {}),
      };
    }
    case 'asset.copy-undo': {
      const { undoneCount, skippedCount, assets } = libraryService.undoCopyAssets(request.command);
      hooks.scheduleThumbnails(request.command.libraryId, 'visible', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.copy-undone', undoneCount, skippedCount, assets };
    }
    case 'asset.rename-file': {
      if (request.command.automationPlan) {
        if (request.command.newBaseName === undefined && request.command.newFileName === undefined) {
          throw new LibraryServiceError('AUTOMATION_FILE_PLAN_INVALID');
        }
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'rename-file',
          assetIds: [request.command.assetId],
          ...(request.command.newBaseName === undefined ? {} : { newBaseName: request.command.newBaseName }),
          ...(request.command.newFileName === undefined ? {} : { newFileName: request.command.newFileName }),
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const beforeFileName = libraryService.getAssetFileName(request.command);
      const { asset } = libraryService.renameAssetFile(request.command);
      const requestedFileName = request.command.newFileName
        ?? `${request.command.newBaseName}${path.extname(beforeFileName)}`;
      const historyEntryId = beforeFileName === requestedFileName
        ? undefined
        : recordDesktopAssetRenameHistory(libraryService, request.command, beforeFileName, request.historyContext);
      if (request.command.newFileName !== undefined
        && path.extname(beforeFileName).toLowerCase() !== path.extname(request.command.newFileName).toLowerCase()) {
        hooks.scheduleThumbnails(request.command.libraryId, 'mutation', [request.command.assetId]);
      }
      return { ok: true, type: 'asset.file-renamed', asset, ...(historyEntryId ? { historyEntryId } : {}) };
    }
    case 'asset.rename-files': {
      const command = request.command;
      if (command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: command.libraryId,
          operation: 'rename-files',
          assetIds: command.items.map((item) => item.assetId),
          renameItems: command.items,
          planHash: command.automationPlan.planHash,
          expectedChangeSequence: command.automationPlan.expectedChangeSequence,
          assetStates: command.automationPlan.assetStates,
        });
      }
      const before = new Map(command.items.map((item) => [item.assetId, libraryService.getAssetFileBaseName({ libraryId: command.libraryId, assetId: item.assetId })]));
      const result = libraryService.renameAssetFiles(command);
      const successful = command.items.filter((item) => result.assets.some((asset) => asset.assetId === item.assetId));
      let historyEntryId: string | undefined;
      if (successful.length > 0) {
        historyEntryId = libraryService.recordOperationHistory({
          libraryId: command.libraryId,
          source: request.historyContext?.source ?? 'desktop',
          sourceReference: request.historyContext?.sourceReference ?? null,
          commandId: command.type,
          labelKey: 'history.asset.rename-many',
          labelArgs: { count: successful.length },
          affectedCount: successful.length,
          affectedEntities: successful.map((item) => item.assetId),
          forwardRecipe: {
            kind: 'asset-rename',
            version: 1,
            payload: {
              items: successful.map((item) => ({
                assetId: item.assetId,
                expectedBaseName: before.get(item.assetId),
                newBaseName: item.newBaseName,
              })),
            },
          },
          inverseRecipe: {
            kind: 'asset-rename',
            version: 1,
            payload: {
              items: successful.map((item) => ({
                assetId: item.assetId,
                expectedBaseName: item.newBaseName,
                newBaseName: before.get(item.assetId),
              })),
            },
          },
        }).historyEntryId;
      }
      return { ok: true, type: 'asset.files-renamed', ...result, ...(historyEntryId ? { historyEntryId } : {}) };
    }
    case 'asset.restore-if-original-vacant': {
      if (request.command.automationPlan) {
        libraryService.validateAutomationFileOperationPlan({
          libraryId: request.command.libraryId,
          operation: 'restore-if-original-vacant',
          assetIds: request.command.assetIds,
          planHash: request.command.automationPlan.planHash,
          expectedChangeSequence: request.command.automationPlan.expectedChangeSequence,
          assetStates: request.command.automationPlan.assetStates,
        });
      }
      const result = libraryService.restoreAssetsIfOriginalVacant(request.command);
      hooks.scheduleThumbnails(request.command.libraryId, 'restore', result.assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.restored-if-original-vacant', ...result };
    }
    case 'asset.palette.aggregate-recent': {
      const result = libraryService.aggregateRecentAssetPalette(request.command);
      return { ok: true, type: 'asset.palette.aggregated-recent', ...result };
    }
    case 'asset.text.read': {
      const result = libraryService.readTextAsset(request.command);
      return { ok: true, type: 'asset.text.read', ...result };
    }
    case 'asset.text.save': {
      const result = libraryService.saveTextAsset(request.command);
      return { ok: true, type: 'asset.text.saved', ...result };
    }
    case 'asset.delete-permanent': {
      const { deletedCount, skippedCount, skippedReasons } = libraryService.deleteAssetsPermanent(request.command);
      hooks.recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.asset.delete-permanent',
        reason: 'trash-asset-permanent-delete',
        affectedCount: deletedCount,
        affectedEntities: request.command.assetIds,
        historyContext: request.historyContext,
      });
      return { ok: true, type: 'asset.deleted-permanent', deletedCount, skippedCount, skippedReasons };
    }
    case 'asset.delete-from-disk': {
      const { deletedCount } = await libraryService.deleteAssetsFromDiskAsync(request.command);
      hooks.recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.asset.delete-from-disk',
        reason: 'managed-asset-permanent-delete',
        affectedCount: deletedCount,
        affectedEntities: request.command.assetIds,
        historyContext: request.historyContext,
      });
      return { ok: true, type: 'asset.deleted-from-disk', deletedCount };
    }
    case 'asset.delete-linked': {
      const { deletedCount, failedCount, failures } = await libraryService.deleteLinkedAssets(request.command);
      hooks.recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.asset.delete-linked',
        reason: request.command.deleteSourceFile
          ? 'linked-asset-source-os-trash-and-index-remove'
          : 'linked-asset-index-remove',
        affectedCount: deletedCount,
        affectedEntities: request.command.assetIds,
        historyContext: request.historyContext,
      });
      return { ok: true, type: 'asset.deleted-linked', deletedCount, failedCount, failures };
    }
    case 'asset.list-trash': {
      const assets = libraryService.listTrash(request.command.libraryId);
      return { ok: true, type: 'asset.list-trash', assets };
    }
    case 'asset.purge-trash': {
      const { purgedCount, skippedCount, failures } = libraryService.emptyTrash(request.command.libraryId);
      hooks.recordPermanentDeleteBarrier({
        libraryId: request.command.libraryId,
        commandId: request.command.type,
        labelKey: 'history.asset.purge-trash',
        reason: 'trash-purge',
        affectedCount: purgedCount,
        historyContext: request.historyContext,
      });
      return { ok: true, type: 'asset.purge-trash', purgedCount, skippedCount, failures };
    }
    case 'asset.relink': {
      const { asset, batchFollowUpRoot } = libraryService.relinkAsset(request.command);
      hooks.scheduleThumbnails(request.command.libraryId, 'mutation', [asset.assetId]);
      return { ok: true, type: 'asset.relinked', asset, batchFollowUpRoot };
    }
    case 'asset.recovery-probe':
      return {
        ok: true,
        type: 'asset.recovery-probe',
        assetId: request.command.assetId,
        probe: libraryService.probeMissingAssetRecovery(request.command),
      };
    case 'asset.relink-batch.preview': {
      const preview = libraryService.relinkBatchPreview(request.command);
      return { ok: true, type: 'asset.relink-batch.preview', ...preview };
    }
    case 'asset.relink-batch.apply': {
      const { restoredCount, unchangedMissingCount, assets } = libraryService.relinkBatchApply(request.command);
      hooks.scheduleThumbnails(request.command.libraryId, 'mutation', assets.map((asset) => asset.assetId));
      return { ok: true, type: 'asset.relink-batch.applied', restoredCount, unchangedMissingCount, assets };
    }
    case 'asset.delete-cancel':
      libraryService.cancelDiskDelete(request.command.operationId);
      return { ok: true, type: 'library.closed', libraryId: request.command.operationId };
    default:
      return undefined;
  }
}
