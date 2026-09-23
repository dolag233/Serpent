import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import { handleFbxConvertCommand } from '../fbx/convert-command';
import { LibraryServiceError, type LibraryService } from '../library-service';

export type MediaPathHooks = {
  writePluginMediaArtifact: (input: {
    libraryId: string;
    assetId: string;
    kind: 'preview' | 'thumbnail';
  }) => Promise<{ artifactId: string } | null>;
  scheduleThumbnails: (
    libraryId: string,
    scene: 'visible',
    assetIds: string[],
    maxIds: number,
    options: { light: boolean },
  ) => void;
  mutationPendingFor: (libraryId: string) => boolean;
};

export async function executeMediaPathWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: MediaPathHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'model.convert-fbx': {
      // Slice-0030-B: ufbx WASM → GLB cache. Single-flight + typed error codes
      // live in src/worker/fbx/convert-command.ts; slice C routes failures to
      // the FBXLoader fallback.
      const result = await handleFbxConvertCommand(libraryService, request.command);
      return {
        ok: true,
        type: 'model.convert-fbx.done' as const,
        assetId: request.command.assetId,
        ...result,
      };
    }
    case 'media.get-artifact-path': {
      const absolutePath = libraryService.getArtifactAbsolutePath(
        request.command.libraryId,
        request.command.artifactId,
        request.command.usage,
      );
      return { ok: true, type: 'media.artifact-path', artifactId: request.command.artifactId, absolutePath };
    }
    case 'media.get-artifact-paths': {
      const entries = libraryService.getArtifactAbsolutePaths(
        request.command.libraryId,
        request.command.artifactIds,
        request.command.usage,
      );
      return { ok: true, type: 'media.artifact-paths', entries };
    }
    case 'media.get-source-path': {
      const source = libraryService.getCurrentMediaSource(
        request.command.libraryId,
        request.command.assetId,
        request.command.revisionId,
      );
      return {
        ok: true,
        type: 'media.source-path',
        assetId: request.command.assetId,
        revisionId: request.command.revisionId,
        ...source,
      };
    }
    case 'media.get-thumbnail-artifact': {
      const info = libraryService.getThumbnailArtifact(
        request.command.libraryId,
        request.command.assetId,
      );
      if (!info) throw new LibraryServiceError('ASSET_NOT_FOUND');
      return {
        ok: true,
        type: 'media.thumbnail-artifact',
        artifactId: info.artifactId,
        filePath: info.filePath,
        width: info.width,
        height: info.height,
      };
    }
    case 'media.get-preview-artifact': {
      const pluginArtifact = await hooks.writePluginMediaArtifact({
        libraryId: request.command.libraryId,
        assetId: request.command.assetId,
        kind: 'preview',
      });
      const preview = await libraryService.resolvePreviewArtifact(
        request.command.libraryId,
        request.command.assetId,
        request.command.exrPlane,
        request.command.colorSpace,
        request.command.intent,
      );
      // Opening a preview is also an idempotent, high-priority generation hint.
      // Do not enqueue it before resolving the source: enqueueThumbnailJobs is
      // synchronous and can contend with a large-library metadata sweep. The
      // viewer must receive a native image URL (or the current placeholder)
      // first; the light visible wave can start on the next turn without
      // delaying that response. A provided plugin artifact already satisfies
      // the request, so avoid enqueueing a native job that could overwrite it.
      // Serpent-tz35: the viewer wave stays at priority 350 and skips repair
      // scans, but it is deliberately detached from the first-paint request.
      if (!pluginArtifact) {
        const previewLibraryId = request.command.libraryId;
        const previewAssetId = request.command.assetId;
        setTimeout(() => {
          hooks.scheduleThumbnails(
            previewLibraryId,
            'visible',
            [previewAssetId],
            1,
            { light: true },
          );
        }, 0);
      }
      return {
        ok: true,
        type: 'media.preview-artifact',
        assetId: request.command.assetId,
        ...preview,
      };
    }
    case 'media.get-asset-path': {
      const absolutePath = libraryService.resolveAssetPath(
        request.command.libraryId,
        request.command.assetId,
      );
      return { ok: true, type: 'media.asset-path', assetId: request.command.assetId, absolutePath };
    }
    case 'model.resolve-companions': {
      // Slice A pipeline: the renderer 3D loader (slice C) rewrites OBJ+MTL /
      // FBX external texture references using this relative-path → assetId
      // index. Read-only; absolute paths never leave the Worker.
      const companions = libraryService.resolveModelCompanions(request.command);
      return {
        ok: true,
        type: 'model.companions',
        assetId: request.command.assetId,
        companions,
      };
    }
    case 'media.get-asset-paths': {
      // Main-only consumer (OS clipboard); paths never reach the Renderer.
      const { libraryId, assetIds } = request.command;
      const absolutePaths = assetIds.map((assetId) =>
        libraryService.resolveAssetPath(libraryId, assetId),
      );
      return {
        ok: true,
        type: 'media.asset-paths',
        assetIds,
        absolutePaths,
      };
    }
    case 'media.get-asset-drag-infos': {
      // Main-only cache primer for native drag. Resolve visible entries before
      // dragstart: webContents.startDrag cannot wait for this Worker round trip.
      // Serpent-v4jf: batched resolution — the legacy per-asset loop cost 3-4
      // point queries per asset (~150k+ queries for a 50k browse result) and
      // stalled the Worker event loop; resolveAssetDragInfos batches in 500-id
      // chunks with identical per-entry semantics (missing skipped, hard
      // failures throw).
      //
      // CANVAS-038/switch-hang: `resolveAssetDragInfos` is synchronous, so one
      // 500-id request still occupied the single Worker thread for seconds
      // (measured 4793 ms) and every other command's message callback waited
      // that long — lane priority cannot preempt a command that never yields.
      // Sub-batch with an event-loop yield between batches, and abandon the
      // remainder as soon as a mutation (library/folder switch, import) is
      // waiting: this is a cache primer, so a partial result is safe and the
      // next browse re-primes it.
      const { libraryId, assetIds } = request.command;
      const entries: ReturnType<typeof libraryService.resolveAssetDragInfos> = [];
      const subBatchSize = 32;
      for (let offset = 0; offset < assetIds.length; offset += subBatchSize) {
        if (offset > 0) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          if (hooks.mutationPendingFor(libraryId)) break;
        }
        entries.push(...libraryService.resolveAssetDragInfos(
          libraryId,
          assetIds.slice(offset, offset + subBatchSize),
        ));
      }
      return {
        ok: true,
        type: 'media.asset-drag-infos',
        entries,
      };
    }
    case 'media.resolve-asset-paths': {
      const assetIds = libraryService.resolveAssetIdsByAbsolutePaths(
        request.command.libraryId,
        request.command.sourcePaths,
      );
      return { ok: true, type: 'media.asset-ids-resolved', assetIds };
    }
    default:
      return undefined;
  }
}
