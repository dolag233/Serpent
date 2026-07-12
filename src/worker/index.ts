import { createPublicError, toPublicError } from '../shared/protocol/errors';
import { parseWorkerRequest, type WorkerRequest } from '../shared/protocol/requests';
import {
  parseWorkerControlMessage,
  type WorkerResponse,
  type WorkerResult,
} from '../shared/protocol/responses';
import type { ParentPort } from 'electron';
import { LibraryService, LibraryServiceError } from './library-service';

const parentPort: ParentPort | undefined = process.parentPort;

if (!parentPort) {
  throw new Error('Library Worker must be started by the Electron main process.');
}

const libraryService = new LibraryService({
  onAssetsChanged: (event) => parentPort.postMessage(event),
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

function handleRequest(request: WorkerRequest): WorkerResult {
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
    case 'smart-collection.list':
      return {
        ok: true,
        type: 'smart-collection.list',
        smartCollections: libraryService.listSmartCollections(request.command.libraryId),
      };
    case 'smart-collection.create': {
      const sc = libraryService.createSmartCollection(request.command);
      return { ok: true, type: 'smart-collection.created', smartCollection: sc };
    }
    case 'smart-collection.update': {
      const sc = libraryService.updateSmartCollection(request.command);
      return { ok: true, type: 'smart-collection.updated', smartCollection: sc };
    }
    case 'smart-collection.delete':
      return {
        ok: true,
        type: 'smart-collection.deleted',
        smartCollectionId: libraryService.deleteSmartCollection(request.command),
      };
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

parentPort.on('message', (event) => {
  const input: unknown = event.data;

  try {
    const control = parseWorkerControlMessage(input);
    if (control.type === 'worker.shutdown') {
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
    response = { requestId: request.requestId, result: handleRequest(request) };
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
