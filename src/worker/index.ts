import { createPublicError, toPublicError } from '../shared/protocol/errors';
import { parseWorkerRequest, type WorkerRequest } from '../shared/protocol/requests';
import {
  parseWorkerControlMessage,
  type WorkerResponse,
  type WorkerResult,
} from '../shared/protocol/responses';
import type { ParentPort } from 'electron';
import { LibraryService, LibraryServiceError } from './library-service';
import { OpenAIVendorAdapter } from './ai/openai-adapter';
import { GeminiVendorAdapter } from './ai/gemini-adapter';
import { AnthropicVendorAdapter } from './ai/anthropic-adapter';
import { VendorAdapterError } from './ai/vendor-adapter';
import type { VendorAdapter } from './ai/vendor-adapter';
import type { AiAnalysisRequest } from './ai/protocol';
import { findVendorError, safeAiDiagnostic, vendorFailure } from './ai/error-mapping';
import { AiJobAbortRegistry } from './ai/job-abort-registry';
import { readFileSync } from 'node:fs';

const parentPort: ParentPort | undefined = process.parentPort;
const aiJobAbortRegistry = new AiJobAbortRegistry();
const analysisControls = new Map<string, { jobId: string; signal: AbortSignal; canWrite: () => boolean }>();

if (!parentPort) {
  throw new Error('Library Worker must be started by the Electron main process.');
}

const libraryService = new LibraryService({
  onAssetsChanged: (event) => parentPort.postMessage(event),
  onProgress: (event) => parentPort.postMessage(event),
  onDiagnostic: ({ scope, error, context }) => {
    try {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        scope: `worker.${scope}`,
        context,
        error: errorForLog(error),
      }));
    } catch {
      // A serialization or stderr failure must not change the background operation.
    }
  },
});

// Electron's ParentPort delivers IPC messages but does not provide a documented
// event-loop ref. Development builds happen to have other active handles; a
// packaged utility process can otherwise exit cleanly immediately after ready.
const processLifetime = setInterval(() => {}, 60 * 60_000);

function errorForLog(error: unknown, depth = 0): unknown {
  if (depth > 5) return { truncated: true };
  if (!(error instanceof Error)) return { value: String(error) };
  return {
    name: error.name,
    message: error.message,
    code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    reason: 'reason' in error && typeof error.reason === 'string' ? error.reason : undefined,
    stack: error.stack,
    cause: error.cause === undefined ? undefined : errorForLog(error.cause, depth + 1),
  };
}

function aiQueueFailure(error: unknown): { errorCode: string; retryable: boolean } {
  const vendorError = findVendorError(error);
  if (vendorError) {
    const failure = vendorFailure(vendorError);
    return { errorCode: failure.errorCode, retryable: failure.retryable };
  }
  if (error instanceof LibraryServiceError) {
    if (error.code === 'AI_ANALYSIS_FAILED' && error.reason?.startsWith('AI_')) {
      return {
        errorCode: error.reason,
        retryable: error.reason === 'AI_NETWORK'
          || error.reason === 'AI_TIMEOUT'
          || error.reason === 'AI_RATE_LIMIT',
      };
    }
    return { errorCode: error.code, retryable: false };
  }
  return { errorCode: 'AI_INTERNAL_ERROR', retryable: false };
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResult> {
  switch (request.command.type) {
    case 'library.list':
      return { ok: true, type: 'library.list', libraries: libraryService.listLibraries() };
    case 'library.create': {
      const library = libraryService.createLibrary(request.command);
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.open': {
      const library = libraryService.openLibrary(request.command.selectedLibraryPath);
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.close':
      libraryService.closeLibrary(request.command.libraryId);
      return { ok: true, type: 'library.closed', libraryId: request.command.libraryId };
    case 'folder.create': {
      const folder = libraryService.createManagedFolder(request.command);
      return { ok: true, type: 'folder.created', folder };
    }
    case 'folder.list':
      return {
        ok: true,
        type: 'folder.list',
        folders: libraryService.listManagedFolders(request.command.libraryId),
      };
    case 'asset.list':
      return {
        ok: true,
        type: 'asset.list',
        assets: libraryService.listAssets(request.command),
      };
    case 'asset.import.prepare': {
      const prepared = libraryService.prepareOrExecuteImport(request.command);
      return 'importId' in prepared
        ? { ok: true, type: 'asset.import.conflicts', plan: prepared }
        : { ok: true, type: 'asset.import.completed', completion: prepared };
    }
    case 'asset.import.resolve':
      return {
        ok: true,
        type: 'asset.import.completed',
        completion: libraryService.resolveImport(request.command),
      };
    case 'asset.import.abandon':
      return {
        ok: true,
        type: 'asset.import.abandoned',
        importId: libraryService.abandonImport(request.command.importId),
      };
    case 'asset.refresh': {
      const refresh = libraryService.refreshManagedAssets(request.command.libraryId);
      return { ok: true, type: 'asset.refreshed', ...refresh };
    }
    case 'asset.import-linked': {
      const linkedFolder = libraryService.importFolderAsLinked(request.command);
      return { ok: true, type: 'asset.import-linked.completed', linkedFolder };
    }
    case 'linked-folder.list':
      return {
        ok: true,
        type: 'linked-folder.list',
        folders: libraryService.listLinkedFolders(request.command.libraryId),
      };
    case 'linked-folder.relink': {
      const linkedFolder = libraryService.relinkMissingFolder(request.command);
      return { ok: true, type: 'linked-folder.relinked', linkedFolder };
    }
    case 'tag.list':
      return {
        ok: true,
        type: 'tag.list',
        tags: libraryService.listTags(request.command.libraryId),
      };
    case 'tag.create': {
      const tag = libraryService.createTag(request.command);
      return { ok: true, type: 'tag.created', tag };
    }
    case 'tag.rename': {
      const tag = libraryService.renameTag(request.command);
      return { ok: true, type: 'tag.renamed', tag };
    }
    case 'tag.delete':
      return {
        ok: true,
        type: 'tag.deleted',
        tagId: libraryService.deleteTag(request.command),
      };
    case 'tag.assign': {
      const { assignedCount } = libraryService.assignTags(request.command);
      return { ok: true, type: 'tag.assigned', assignedCount };
    }
    case 'tag.remove': {
      const { removedCount } = libraryService.removeTags(request.command);
      return { ok: true, type: 'tag.removed', removedCount };
    }
    case 'collection.list':
      return {
        ok: true,
        type: 'collection.list',
        collections: libraryService.listCollections(request.command.libraryId),
      };
    case 'collection.create': {
      const collection = libraryService.createCollection(request.command);
      return { ok: true, type: 'collection.created', collection };
    }
    case 'collection.update': {
      const collection = libraryService.updateCollection(request.command);
      return { ok: true, type: 'collection.updated', collection };
    }
    case 'collection.delete':
      return {
        ok: true,
        type: 'collection.deleted',
        collectionId: libraryService.deleteCollection(request.command),
      };
    case 'collection.assets.add': {
      const { collectionId } = libraryService.addCollectionAssets(request.command);
      return { ok: true, type: 'collection.assets.added', collectionId };
    }
    case 'collection.assets.remove': {
      const { collectionId } = libraryService.removeCollectionAssets(request.command);
      return { ok: true, type: 'collection.assets.removed', collectionId };
    }
    case 'collection.assets.reorder': {
      const { collectionId } = libraryService.reorderCollectionAssets(request.command);
      return { ok: true, type: 'collection.assets.reordered', collectionId };
    }
    case 'collection.assets.list': {
      const assets = libraryService.listCollectionAssets(request.command);
      return { ok: true, type: 'collection.assets.list', assets };
    }
    case 'asset.metadata.get': {
      const metadata = libraryService.getAssetMetadata(request.command);
      return { ok: true, type: 'asset.metadata.got', metadata };
    }
    case 'asset.metadata.set': {
      const metadata = libraryService.setAssetMetadata(request.command);
      return { ok: true, type: 'asset.metadata.updated', metadata };
    }
    case 'asset.metadata.backfill': {
      const { backfilledCount } = libraryService.backfillAssetMetadata(request.command.libraryId);
      return { ok: true, type: 'asset.metadata.backfilled', backfilledCount };
    }
    case 'asset.search': {
      const result = libraryService.searchAssets({
        libraryId: request.command.libraryId,
        query: request.command.query,
        filters: request.command.filters ?? null,
        scope: request.command.scope ?? null,
        sort: request.command.sort ?? null,
        limit: request.command.limit ?? 50,
        offset: request.command.offset ?? 0,
      });
      return {
        ok: true,
        type: 'asset.search.result',
        items: result.items,
        total: result.total,
        offset: result.offset,
        snippets: result.snippets,
      };
    }
    case 'smart-collection.list':
      return {
        ok: true,
        type: 'smart-collection.list',
        collections: libraryService.listSmartCollections(request.command.libraryId),
      };
    case 'smart-collection.create': {
      const sc = libraryService.createSmartCollection(request.command);
      return { ok: true, type: 'smart-collection.created', collection: sc };
    }
    case 'smart-collection.update': {
      const sc = libraryService.updateSmartCollection(request.command);
      return { ok: true, type: 'smart-collection.updated', collection: sc };
    }
    case 'smart-collection.delete':
      return {
        ok: true,
        type: 'smart-collection.deleted',
        collectionId: libraryService.deleteSmartCollection(request.command),
      };
    case 'smart-collection.execute': {
      const result = libraryService.executeSmartCollection(request.command);
      return {
        ok: true,
        type: 'smart-collection.executed',
        items: result.items,
        total: result.total,
        offset: result.offset,
      };
    }
    case 'asset.trash': {
      const { trashedCount } = libraryService.trashAssets(request.command);
      return { ok: true, type: 'asset.trashed', trashedCount };
    }
    case 'asset.restore': {
      const { restoredCount, assets } = libraryService.restoreAssets(request.command);
      return { ok: true, type: 'asset.restored', restoredCount, assets };
    }
    case 'asset.delete-permanent': {
      const { deletedCount, skippedCount, skippedReasons } = libraryService.deleteAssetsPermanent(request.command);
      return { ok: true, type: 'asset.deleted-permanent', deletedCount, skippedCount, skippedReasons };
    }
    case 'asset.delete-linked': {
      const { deletedCount, failedCount, failures } = await libraryService.deleteLinkedAssets(request.command);
      return { ok: true, type: 'asset.deleted-linked', deletedCount, failedCount, failures };
    }
    case 'asset.list-trash': {
      const assets = libraryService.listTrash(request.command.libraryId);
      return { ok: true, type: 'asset.list-trash', assets };
    }
    case 'asset.purge-trash': {
      const { purgedCount } = libraryService.purgeExpiredTrash(request.command.libraryId);
      return { ok: true, type: 'asset.purge-trash', purgedCount };
    }
    case 'asset.relink': {
      const { asset } = libraryService.relinkAsset(request.command);
      return { ok: true, type: 'asset.relinked', asset };
    }
    case 'asset.relink-batch.preview': {
      const preview = libraryService.relinkBatchPreview(request.command);
      return { ok: true, type: 'asset.relink-batch.preview', ...preview };
    }
    case 'asset.relink-batch.apply': {
      const { restoredCount, unchangedMissingCount, assets } = libraryService.relinkBatchApply(request.command);
      return { ok: true, type: 'asset.relink-batch.applied', restoredCount, unchangedMissingCount, assets };
    }
    case 'extension.save-from-url': {
      const { asset } = await libraryService.saveAssetFromUrl(request.command);
      return { ok: true, type: 'extension.asset-saved', asset };
    }
    case 'library.export': {
      if (request.command.format === 'zip') {
        const exported = await libraryService.exportLibraryToZip({
          libraryId: request.command.libraryId,
          destinationPath: request.command.destinationPath,
          includeLinkedContent: request.command.includeLinkedContent,
        });
        return {
          ok: true,
          type: 'library.exported',
          exportId: exported.exportId,
          libraryId: request.command.libraryId,
          format: 'zip' as const,
          fileCount: exported.fileCount,
          totalBytes: exported.totalBytes,
          excludedPreviewCount: exported.excludedPreviewCount,
          includedLinkedContent: exported.includedLinkedContent,
          durationMs: exported.durationMs,
        };
      }
      const exported = await libraryService.exportLibraryToFolder({
        libraryId: request.command.libraryId,
        destinationPath: request.command.destinationPath,
        includeLinkedContent: request.command.includeLinkedContent,
      });
      return {
        ok: true,
        type: 'library.exported',
        exportId: exported.exportId,
        libraryId: request.command.libraryId,
        format: 'folder' as const,
        fileCount: exported.fileCount,
        totalBytes: exported.totalBytes,
        excludedPreviewCount: exported.excludedPreviewCount,
        includedLinkedContent: exported.includedLinkedContent,
        durationMs: exported.durationMs,
      };
    }
    case 'library.export-cancel':
      libraryService.cancelExport(request.command.exportId);
      return { ok: true, type: 'library.closed', libraryId: request.command.exportId };
    case 'library.import-folder': {
      const imported = await libraryService.importLibraryFromFolder({
        sourceFolderPath: request.command.sourceFolderPath,
        copyToParentPath: request.command.copyToParentPath,
      });
      return {
        ok: true,
        type: 'library.imported',
        importId: imported.importId,
        libraryId: imported.libraryId,
        displayName: imported.displayName,
        libraryPath: imported.libraryPath,
      };
    }
    case 'library.import-zip': {
      const imported = await libraryService.importLibraryFromZip({
        sourceZipPath: request.command.sourceZipPath,
        destinationParentPath: request.command.destinationParentPath,
      });
      return {
        ok: true,
        type: 'library.imported',
        importId: imported.importId,
        libraryId: imported.libraryId,
        displayName: imported.displayName,
        libraryPath: imported.libraryPath,
      };
    }
    case 'library.import-cancel':
      libraryService.cancelImport(request.command.importId);
      return { ok: true, type: 'library.closed', libraryId: request.command.importId };
    case 'library.import-validate': {
      const validated = libraryService.validateImportSource(request.command.sourceFolderPath);
      return {
        ok: true,
        type: 'library.import-validated',
        importId: request.command.importId,
        libraryId: validated.libraryId,
        displayName: validated.displayName,
      };
    }
    case 'asset.analyze': {
      const { libraryId, assetId, provider, model, apiKey, enabledFields, language } =
        request.command;
      const controls = analysisControls.get(request.requestId);

      // Resolve asset file path + mime.
      const { filePath, mime, isVideo } = libraryService.resolveAssetFilePath(
        libraryId,
        assetId,
      );

      let imageBase64: string | undefined;
      let contactSheetBase64: string | undefined;
      let contactSheetDescription: string | undefined;
      let requestMime: string;

      if (isVideo) {
        // Video: require contact_sheet + video_poster artifacts (generated by slice 0006).
        const contactSheet = libraryService.getCurrentArtifact(
          libraryId, assetId, 'contact_sheet',
        );
        if (!contactSheet || contactSheet.status !== 'ready') {
          return {
            ok: true,
            type: 'asset.analyze-unsupported' as const,
            assetId,
            reason: 'CONTACT_SHEET_REQUIRED',
          };
        }

        const poster = libraryService.getCurrentArtifact(
          libraryId, assetId, 'video_poster',
        );
        if (!poster || poster.status !== 'ready') {
          return {
            ok: true,
            type: 'asset.analyze-unsupported' as const,
            assetId,
            reason: 'CONTACT_SHEET_REQUIRED',
          };
        }

        // Read artifact byte content.
        const posterAbsPath = libraryService.getArtifactAbsolutePath(
          libraryId, poster.artifactId,
        );
        const sheetAbsPath = libraryService.getArtifactAbsolutePath(
          libraryId, contactSheet.artifactId,
        );

        let posterBytes: Buffer;
        let sheetBytes: Buffer;
        try {
          posterBytes = readFileSync(posterAbsPath);
          sheetBytes = readFileSync(sheetAbsPath);
        } catch (error) {
          throw new LibraryServiceError('ASSET_NOT_FOUND', { cause: error });
        }

        imageBase64 = posterBytes.toString('base64');
        contactSheetBase64 = sheetBytes.toString('base64');
        // Use the poster artifact's MIME type for the image data URL.
        requestMime = poster.mimeType;

        // Optional: include contextual description from extracted metadata.
        const metadataArtifact = libraryService.getCurrentArtifact(
          libraryId, assetId, 'extracted_metadata',
        );
        if (metadataArtifact && metadataArtifact.status === 'ready') {
          try {
            const metaAbsPath = libraryService.getArtifactAbsolutePath(
              libraryId, metadataArtifact.artifactId,
            );
            const metaJson = JSON.parse(readFileSync(metaAbsPath, 'utf-8'));
            const durationLabel =
              typeof metaJson.durationMs === 'number'
                ? `${(metaJson.durationMs / 1000).toFixed(1)}s`
                : 'unknown';
            contactSheetDescription = [
              `Video dimensions: ${metaJson.width ?? '?'}x${metaJson.height ?? '?'}`,
              `Duration: ${durationLabel}`,
              `Codec: ${metaJson.videoCodec ?? 'unknown'}`,
            ].join('; ');
          } catch {
            // Best-effort; ignore metadata parse failures.
          }
        }
      } else if (mime.startsWith('image/')) {
        // Image: read the source file bytes.
        let fileBytes: Buffer;
        try {
          fileBytes = readFileSync(filePath);
        } catch (error) {
          throw new LibraryServiceError('ASSET_NOT_FOUND', { cause: error });
        }
        imageBase64 = fileBytes.toString('base64');
        requestMime = mime;
      } else {
        // Non-image, non-video assets (e.g., .txt, .pdf).
        return {
          ok: true,
          type: 'asset.analyze-unsupported' as const,
          assetId,
          reason: `unsupported mime type: ${mime}`,
        };
      }

      const filename = filePath.split(/[/\\]/).pop() ?? 'asset';

      // Collect existing tag names for reuse hinting.
      const existingTagNames = libraryService.listTagNames(libraryId);

      // Build the vendor-agnostic request.
      const aiRequest: AiAnalysisRequest = {
        filename,
        mime: requestMime,
        imageBase64,
        contactSheetBase64,
        contactSheetDescription,
        language,
        enabledFields,
        existingTagNames,
      };

      // Create adapter based on provider.
      let adapter: VendorAdapter;
      switch (provider) {
        case 'openai':
          adapter = new OpenAIVendorAdapter(apiKey, model);
          break;
        case 'gemini':
          adapter = new GeminiVendorAdapter(apiKey, model);
          break;
        case 'anthropic':
          adapter = new AnthropicVendorAdapter(apiKey, model);
          break;
        default:
          return {
            ok: true,
            type: 'asset.analyze-unsupported' as const,
            assetId,
            reason: `provider ${provider} not supported`,
          };
      }

      let analysisResult;
      try {
        analysisResult = await adapter.analyze(aiRequest, controls?.signal);
      } catch (error) {
        if (error instanceof VendorAdapterError) {
          const failure = vendorFailure(error);
          throw new LibraryServiceError('AI_ANALYSIS_FAILED', {
            cause: safeAiDiagnostic(failure.errorCode, error),
            reason: failure.reason,
          });
        }
        throw error;
      }

      if (controls && (controls.signal.aborted || !controls.canWrite())) {
        return {
          ok: true,
          type: 'asset.analyze-unsupported' as const,
          assetId,
          reason: 'AI_JOB_INTERRUPTED',
        };
      }

      // Write results atomically.
      const { tagsWritten, fieldsWritten, committed } = libraryService.writeAiAnalysisResult({
        libraryId,
        assetId,
        label: analysisResult.label,
        description: analysisResult.description,
        tags: analysisResult.tags,
        structuredMetadata: analysisResult.structured_metadata as
          | Record<string, unknown>
          | undefined,
        modelId: model,
        modelVersion: analysisResult.modelVersion,
        guardJobId: controls?.jobId,
        enabledFields,
      });

      if (!committed || (controls && (controls.signal.aborted || !controls.canWrite()))) {
        return {
          ok: true,
          type: 'asset.analyze-unsupported' as const,
          assetId,
          reason: 'AI_JOB_INTERRUPTED',
        };
      }

      const generatedFields: Record<string, unknown> = {};
      if (tagsWritten.length > 0) generatedFields.tags = tagsWritten;
      if (fieldsWritten.includes('label')) generatedFields.label = analysisResult.label;
      if (fieldsWritten.includes('description'))
        generatedFields.description = analysisResult.description;
      if (fieldsWritten.includes('structured_metadata'))
        generatedFields.structuredMetadata = analysisResult.structured_metadata;

      return {
        ok: true,
        type: 'asset.analyzed' as const,
        assetId,
        generatedFields: generatedFields as {
          label?: string;
          description?: string;
          tags?: string[];
          structuredMetadata?: Record<string, unknown>;
        },
        modelVersion: analysisResult.modelVersion,
      };
    }
    case 'media.generate-thumbnail': {
      const { artifactId } = await libraryService.generateThumbnail(request.command);
      // Publish the thumbnail-ready event to the renderer
      if (parentPort) {
        parentPort.postMessage({
          type: 'asset.thumbnail.ready',
          libraryId: request.command.libraryId,
          assetId: request.command.assetId,
          artifactId,
        });
      }
      return { ok: true, type: 'media.thumbnail.generated', assetId: request.command.assetId, artifactId };
    }
    case 'media.retry-artifact': {
      const { libraryId, assetId, kind } = request.command;
      libraryService.enqueueArtifactRetry({ libraryId, assetId, kind });
      // Respond first; media generation can take minutes and must not occupy a
      // normal 15-second Main↔Worker request or create a fatal late response.
      setTimeout(() => {
        void libraryService.processThumbnailQueue(libraryId)
          .then(() => {
            const preview = libraryService.getPreviewArtifact(libraryId, assetId);
            if (preview.status === 'ready' && preview.artifactId) {
              parentPort?.postMessage({
                type: 'asset.thumbnail.ready',
                libraryId,
                assetId,
                artifactId: preview.artifactId,
              });
            } else if (preview.status === 'failed') {
              const errorCode = preview.errorCode ?? 'MEDIA_PROCESSING_FAILED';
              parentPort?.postMessage({
                type: 'asset.thumbnail.failed',
                libraryId,
                assetId,
                errorCode,
                reason: errorCode,
              });
            }
          })
          .catch((error: unknown) => {
            libraryService.reportDiagnostic('media.retry.queue', error, {
              libraryId,
              assetId,
              kind,
            });
          });
      }, 0);
      return {
        ok: true,
        type: 'media.retry-artifact.queued',
        assetId,
        kind,
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
      const preview = libraryService.getPreviewArtifact(
        request.command.libraryId,
        request.command.assetId,
      );
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
    case 'media.enqueue-thumbnail-jobs': {
      const enqueued = libraryService.enqueueThumbnailJobs(request.command.libraryId);
      return { ok: true, type: 'media.jobs.enqueued', libraryId: request.command.libraryId, enqueued };
    }
    case 'media.process-thumbnail-queue': {
      const processed = await libraryService.processThumbnailQueue(request.command.libraryId);
      return { ok: true, type: 'media.jobs.processed', libraryId: request.command.libraryId, processed };
    }
    case 'ai.configure': {
      // The Worker caches configuration in-memory; the caller should
      // pass encryptedApiKey in each analyze call. This configure
      // just acknowledges receipt.
      // In a future slice, this could cache the decrypted key in memory.
      return { ok: true, type: 'ai.config.saved' as const };
    }
    case 'ai.test-connection': {
      const { provider, model, encryptedApiKeyBase64 } = request.command;
      // Decrypt: main sent base64-encoded encrypted payload.
      const { safeStorage } = await import('electron');
      let apiKey: string;
      try {
        apiKey = safeStorage.decryptString(
          Buffer.from(encryptedApiKeyBase64, 'base64'),
        );
      } catch {
        return {
          ok: true,
          type: 'ai.test-connection.result' as const,
          success: false,
          errorKind: 'auth',
          reason: 'Could not decrypt API key.',
        };
      }

      // Build a minimal adapter and try a request.
      let testAdapter: VendorAdapter;
      switch (provider) {
        case 'openai':
          testAdapter = new OpenAIVendorAdapter(apiKey, model);
          break;
        case 'gemini':
          testAdapter = new GeminiVendorAdapter(apiKey, model);
          break;
        case 'anthropic':
          testAdapter = new AnthropicVendorAdapter(apiKey, model);
          break;
        default:
          return {
            ok: true,
            type: 'ai.test-connection.result' as const,
            success: false,
            errorKind: 'invalid_response',
            reason: `Unsupported provider: ${provider}`,
          };
      }

      // Use a minimal request to verify connectivity.
      try {
        await testAdapter.analyze(
          {
            filename: 'test.png',
            mime: 'image/png',
            language: 'en',
            enabledFields: { label: false, description: false, tags: true, structuredMetadata: false },
            existingTagNames: [],
            imageBase64:
              // Minimal 1x1 white PNG base64
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk' +
              '+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
          AbortSignal.timeout(15_000),
        );
        return {
          ok: true,
          type: 'ai.test-connection.result' as const,
          success: true,
        };
      } catch (error) {
        if (error instanceof VendorAdapterError) {
          return {
            ok: true,
            type: 'ai.test-connection.result' as const,
            success: false,
            errorKind: error.kind,
            reason: error.message,
          };
        }
        return {
          ok: true,
          type: 'ai.test-connection.result' as const,
          success: false,
          errorKind: 'network',
          reason: String(error),
        };
      }
    }
    case 'ai.enqueue-analysis': {
      const { enqueued } = libraryService.enqueueAiAnalysisJobs(request.command);
      return {
        ok: true,
        type: 'media.jobs.enqueued' as const,
        libraryId: request.command.libraryId,
        enqueued,
      };
    }
    case 'ai.process-queue': {
      const { libraryId, maxJobs, ...analysisConfig } = request.command;
      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      let requeued = 0;
      const attemptedJobIds: string[] = [];

      while (processed < maxJobs) {
        const job = libraryService.claimNextAiJob(libraryId, attemptedJobIds);
        if (!job) break;
        attemptedJobIds.push(job.jobId);
        processed++;
        const controller = aiJobAbortRegistry.register(libraryId, job.jobId);
        const nestedRequestId = `${request.requestId}:${job.jobId}`;
        analysisControls.set(nestedRequestId, {
          jobId: job.jobId,
          signal: controller.signal,
          canWrite: () => libraryService.getAiJobState(libraryId, job.jobId) === 'running',
        });
        try {
          const result = await handleRequest({
            requestId: nestedRequestId,
            command: {
              type: 'asset.analyze',
              libraryId,
              assetId: job.assetId,
              provider: analysisConfig.provider,
              model: analysisConfig.model,
              apiKey: analysisConfig.apiKey,
              enabledFields: analysisConfig.enabledFields,
              language: analysisConfig.language,
            },
          });
          if (controller.signal.aborted || libraryService.getAiJobState(libraryId, job.jobId) !== 'running') {
            continue;
          }
          if (!result.ok || result.type === 'asset.analyze-unsupported') {
            const errorCode = result.ok ? result.reason : result.error.code;
            libraryService.failAiJob(libraryId, job.jobId, {
              errorCode,
              retryable: false,
            });
            failed++;
            continue;
          }
          libraryService.completeAiJob(libraryId, job.jobId);
          succeeded++;
        } catch (error) {
          if (controller.signal.aborted || libraryService.getAiJobState(libraryId, job.jobId) !== 'running') {
            continue;
          }
          const classification = aiQueueFailure(error);
          libraryService.reportDiagnostic(
            'ai.queue.analysis',
            safeAiDiagnostic(classification.errorCode, error),
            { libraryId, jobId: job.jobId, assetId: job.assetId, errorCode: classification.errorCode },
          );
          const failure = libraryService.failAiJob(
            libraryId,
            job.jobId,
            classification,
          );
          if (failure.status === 'queued') requeued++;
          else failed++;
        } finally {
          analysisControls.delete(nestedRequestId);
          aiJobAbortRegistry.unregister(job.jobId);
        }
      }
      return {
        ok: true,
        type: 'ai.jobs.processed' as const,
        libraryId,
        processed,
        succeeded,
        failed,
        requeued,
      };
    }
    case 'ai.clear-content': {
      const { clearedCount } = libraryService.clearAiContent(request.command);
      // Publish ai.content.cleared event
      if (parentPort) {
        parentPort.postMessage({
          type: 'ai.content.cleared',
          libraryId: request.command.libraryId,
          affectedAssetCount: clearedCount,
        });
      }
      return {
        ok: true,
        type: 'ai.content.cleared' as const,
        libraryId: request.command.libraryId,
        clearedCount,
      };
    }
    case 'ai.pause-jobs': {
      const { pausedCount } = libraryService.pauseJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      aiJobAbortRegistry.abort(request.command.libraryId, request.command.jobIds);
      return {
        ok: true,
        type: 'ai.jobs.paused' as const,
        libraryId: request.command.libraryId,
        pausedCount,
      };
    }
    case 'ai.resume-jobs': {
      const { resumedCount } = libraryService.resumeJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      return {
        ok: true,
        type: 'ai.jobs.resumed' as const,
        libraryId: request.command.libraryId,
        resumedCount,
      };
    }
    case 'ai.cancel-jobs': {
      const { cancelledCount } = libraryService.cancelJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      aiJobAbortRegistry.abort(request.command.libraryId, request.command.jobIds);
      return {
        ok: true,
        type: 'ai.jobs.cancelled' as const,
        libraryId: request.command.libraryId,
        cancelledCount,
      };
    }
    case 'ai.retry-jobs': {
      const { retriedCount } = libraryService.retryJobs(
        request.command.libraryId,
        request.command.jobIds,
      );
      return {
        ok: true,
        type: 'ai.jobs.retried' as const,
        libraryId: request.command.libraryId,
        retriedCount,
      };
    }
    default:
      return assertNever(request.command);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Worker command: ${String(value)}`);
}

function requestIdFrom(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('requestId' in input)) return undefined;
  const requestId = input.requestId;
  return typeof requestId === 'string' && requestId.trim() !== '' && requestId.length <= 255
    ? requestId
    : undefined;
}

parentPort.on('message', async (event) => {
  const input: unknown = event.data;

  try {
    const control = parseWorkerControlMessage(input);
    if (control.type === 'worker.shutdown') {
      aiJobAbortRegistry.abortAll();
      libraryService.closeAll();
      parentPort.postMessage({ type: 'worker.shutdown.ack' });
      clearInterval(processLifetime);
      return;
    }
  } catch {
    // A normal request is not a control message; validate it below.
  }

  const requestId = requestIdFrom(input);
  if (!requestId) return;

  let response: WorkerResponse;
  try {
    const request = parseWorkerRequest(input);
    response = { requestId: request.requestId, result: await handleRequest(request) };
  } catch (error) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: 'worker.request',
      requestId,
      commandType:
        typeof input === 'object' && input !== null && 'command' in input &&
        typeof input.command === 'object' && input.command !== null && 'type' in input.command
          ? String(input.command.type)
          : 'malformed',
      error: errorForLog(error),
    }));
    response = {
      requestId,
      result: {
        ok: false,
        error:
          error instanceof LibraryServiceError
            ? createPublicError(error.code, error.reason)
            : toPublicError(error),
      },
    };
  }

  parentPort.postMessage(response);
});

parentPort.postMessage({ type: 'worker.ready' });
