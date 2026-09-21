import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export type MediaGenerationHooks = {
  writePluginMediaArtifact: (input: {
    libraryId: string;
    assetId: string;
    kind: 'preview' | 'thumbnail';
  }) => Promise<{ artifactId: string } | null>;
  scheduleThumbnails: (
    libraryId: string,
    scene: 'mutation',
    assetIds: string[],
  ) => void;
  publishThumbnailReady: (event: {
    type: 'asset.thumbnail.ready';
    libraryId: string;
    assetId: string;
    artifactId: string;
  }) => void;
  scheduleSecondaryMediaQueue: (
    libraryId: string,
    options: { assetId: string; urgent: boolean },
  ) => void;
};

export async function executeMediaGenerationWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: MediaGenerationHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'media.generate-thumbnail': {
      const pluginArtifact = await hooks.writePluginMediaArtifact({
        libraryId: request.command.libraryId,
        assetId: request.command.assetId,
        kind: 'thumbnail',
      });
      const generated = pluginArtifact
        ?? await libraryService.generateThumbnail(request.command);
      if (!generated && libraryService.isModelAsset(
        request.command.libraryId,
        request.command.assetId,
      )) {
        // Model thumbnails render offscreen in Main (slice E): the explicit
        // request enqueues through the queue, and the thumbnail.ready event
        // arrives asynchronously once the offscreen frame lands.
        hooks.scheduleThumbnails(
          request.command.libraryId,
          'mutation',
          [request.command.assetId],
        );
      }
      if (generated) {
        hooks.publishThumbnailReady({
          type: 'asset.thumbnail.ready',
          libraryId: request.command.libraryId,
          assetId: request.command.assetId,
          artifactId: generated.artifactId,
        });
      }
      return {
        ok: true,
        type: 'media.thumbnail.generated',
        assetId: request.command.assetId,
        ...(generated ? { artifactId: generated.artifactId } : {}),
      };
    }
    case 'media.retry-artifact': {
      const { libraryId, assetId, kind } = request.command;
      libraryService.enqueueArtifactRetry({ libraryId, assetId, kind });
      // The idempotent queue scheduler owns all FFmpeg work; normal IPC returns
      // before poster/proxy generation and never starts a second drain.
      if (kind === 'webm_proxy' || kind === 'audio_proxy') {
        // Explicit source-playback fallback must not wait for the normal
        // secondary idle window. A primary poster/import wave may remain
        // active, but the proxy gets its own bounded FFmpeg lane immediately.
        hooks.scheduleSecondaryMediaQueue(libraryId, { assetId, urgent: true });
      } else {
        hooks.scheduleThumbnails(libraryId, 'mutation', [assetId]);
      }
      return {
        ok: true,
        type: 'media.retry-artifact.queued',
        assetId,
        kind,
      };
    }
    default:
      return undefined;
  }
}
