import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';
import {
  beginSegmentedVideoTransfer,
  cancelSegmentedVideoTransfer,
  finishSegmentedVideoTransfer,
  mergeAndVerifySegmentedVideo,
  throwIfSegmentedVideoTransferCancelled,
  validateDirectVideoSource,
} from '../segmented-media';

export type ExtensionCommandHooks = {
  scheduleMutationThumbnails: (libraryId: string, assetIds: string[]) => void;
};

export async function executeExtensionWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: ExtensionCommandHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'extension.save-from-url': {
      const result = await libraryService.saveAssetFromUrl(request.command);
      if (!result.duplicate) {
        hooks.scheduleMutationThumbnails(request.command.libraryId, [result.asset.assetId]);
      }
      return {
        ok: true,
        type: 'extension.asset-saved',
        asset: result.asset,
        ...(result.duplicate ? { duplicate: true } : {}),
      };
    }
    case 'extension.save-from-file': {
      if (request.command.kind === 'video') {
        await validateDirectVideoSource(request.command.stagedFilePath, request.command.contentType);
      }
      const result = await libraryService.saveAssetFromFile(request.command);
      if (!result.duplicate) {
        hooks.scheduleMutationThumbnails(request.command.libraryId, [result.asset.assetId]);
      }
      return {
        ok: true,
        type: 'extension.asset-saved',
        asset: result.asset,
        ...(result.duplicate ? { duplicate: true } : {}),
      };
    }
    case 'extension.save-segmented-video': {
      beginSegmentedVideoTransfer(request.command.transferId);
      try {
        const merged = await mergeAndVerifySegmentedVideo({
          ...request.command,
          sessionId: request.command.transferId,
        });
        throwIfSegmentedVideoTransferCancelled(request.command.transferId);
        const result = await libraryService.saveAssetFromFile({
          libraryId: request.command.libraryId,
          ...(request.command.targetFolderId === undefined
            ? {}
            : { targetFolderId: request.command.targetFolderId }),
          ...(request.command.sourcePageUrl === undefined
            ? {}
            : { sourcePageUrl: request.command.sourcePageUrl }),
          ...(request.command.mediaUrl === undefined
            ? {}
            : { mediaUrl: request.command.mediaUrl }),
          stagedFilePath: merged.path,
          contentType: request.command.contentType,
          filename: request.command.filename,
        });
        if (!result.duplicate) {
          hooks.scheduleMutationThumbnails(request.command.libraryId, [result.asset.assetId]);
        }
        return {
          ok: true,
          type: 'extension.asset-saved',
          asset: result.asset,
          ...(result.duplicate ? { duplicate: true } : {}),
        };
      } finally {
        finishSegmentedVideoTransfer(request.command.transferId);
      }
    }
    case 'extension.cancel-segmented-video': {
      const active = cancelSegmentedVideoTransfer(request.command.transferId);
      return {
        ok: true,
        type: 'extension.segmented-video.cancelled',
        transferId: request.command.transferId,
        active,
      };
    }
    default:
      return undefined;
  }
}
