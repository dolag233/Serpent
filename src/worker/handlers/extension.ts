import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

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
      const { asset } = await libraryService.saveAssetFromUrl(request.command);
      hooks.scheduleMutationThumbnails(request.command.libraryId, [asset.assetId]);
      return { ok: true, type: 'extension.asset-saved', asset };
    }
    case 'extension.save-from-file': {
      const { asset } = await libraryService.saveAssetFromFile(request.command);
      hooks.scheduleMutationThumbnails(request.command.libraryId, [asset.assetId]);
      return { ok: true, type: 'extension.asset-saved', asset };
    }
    default:
      return undefined;
  }
}
