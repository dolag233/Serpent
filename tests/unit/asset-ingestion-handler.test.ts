import { expect, test, vi } from 'vitest';

import { executeAssetIngestionWorkerCommand } from '../../src/worker/handlers/asset-ingestion';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function ingestionRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function hooks() {
  return {
    scheduleThumbnails: vi.fn(),
    withMediaSchedulingSuspended: vi.fn(async (_libraryId, operation) => operation()),
  };
}

test('asset.list returns assets without scheduling a thumbnail scene', async () => {
  const assets = [{ assetId: 'asset-1' }];
  const libraryService = {
    listAssets: vi.fn(() => assets),
  } as unknown as LibraryService;
  const ingestionHooks = hooks();

  await expect(executeAssetIngestionWorkerCommand(
    libraryService,
    ingestionRequest({
      type: 'asset.list',
      libraryId: 'lib-1',
      recursive: false,
    }),
    ingestionHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'asset.list',
    assets,
  });
  expect(ingestionHooks.scheduleThumbnails).not.toHaveBeenCalled();
});

test('asset.sequence.create schedules mutation thumbnails for frames', async () => {
  const asset = {
    assetId: 'seq-1',
    sequence: { frames: [{ assetId: 'frame-1' }, { assetId: 'frame-2' }] },
  };
  const libraryService = {
    createImageSequence: vi.fn(() => asset),
  } as unknown as LibraryService;
  const ingestionHooks = hooks();

  await expect(executeAssetIngestionWorkerCommand(
    libraryService,
    ingestionRequest({
      type: 'asset.sequence.create',
      libraryId: 'lib-1',
      assetIds: ['frame-1', 'frame-2', 'frame-3'],
      fps: 24,
    }),
    ingestionHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'asset.sequence.created',
    asset,
  });
  expect(ingestionHooks.scheduleThumbnails).toHaveBeenCalledWith(
    'lib-1',
    'mutation',
    ['frame-1', 'frame-2'],
  );
});

test('asset.import.prepare schedules mutation thumbnails on completion', async () => {
  const completion = {
    importedCount: 1,
    assets: [{ assetId: 'asset-1' }],
  };
  const libraryService = {
    prepareOrExecuteImportCancellable: vi.fn(async () => completion),
  } as unknown as LibraryService;
  const ingestionHooks = hooks();

  await expect(executeAssetIngestionWorkerCommand(
    libraryService,
    ingestionRequest({
      type: 'asset.import.prepare',
      libraryId: 'lib-1',
      sourceKind: 'files',
      sourcePaths: ['C:\\imports\\a.png'],
    }),
    ingestionHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'asset.import.completed',
    completion,
  });
  expect(ingestionHooks.withMediaSchedulingSuspended).toHaveBeenCalledWith(
    'lib-1',
    expect.any(Function),
  );
  expect(ingestionHooks.scheduleThumbnails).toHaveBeenCalledWith('lib-1', 'mutation', ['asset-1']);
});

test('asset.import.probe-sequences returns an empty offer when none is found', async () => {
  const libraryService = {
    probeImageSequenceImportOffer: vi.fn(async () => null),
  } as unknown as LibraryService;

  await expect(executeAssetIngestionWorkerCommand(
    libraryService,
    ingestionRequest({
      type: 'asset.import.probe-sequences',
      libraryId: 'lib-1',
      sourcePaths: ['C:\\imports\\frame_001.png'],
    }),
    hooks(),
  )).resolves.toEqual({
    ok: true,
    type: 'asset.import.sequence-offer',
    offer: {
      defaultFps: 30,
      libraryId: 'lib-1',
      selectedPaths: ['C:\\imports\\frame_001.png'],
      sequences: [],
    },
  });
});

test('asset.import-linked defers watcher reconcile after scheduling linked thumbnails', async () => {
  const linkedFolder = { folderId: 'folder-1' };
  const reconcileLinkedWatchersForLibrary = vi.fn();
  const libraryService = {
    importFolderAsLinked: vi.fn(async () => linkedFolder),
    hasOpenLibrary: vi.fn(() => true),
    reconcileLinkedWatchersForLibrary,
  } as unknown as LibraryService;
  const ingestionHooks = hooks();

  await expect(executeAssetIngestionWorkerCommand(
    libraryService,
    ingestionRequest({
      type: 'asset.import-linked',
      libraryId: 'lib-1',
      sourceRootPath: 'C:\\imports\\linked',
    }),
    ingestionHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'asset.import-linked.completed',
    linkedFolder,
  });
  expect(ingestionHooks.withMediaSchedulingSuspended).toHaveBeenCalledWith(
    'lib-1',
    expect.any(Function),
    { resumeScheduling: false },
  );
  expect(ingestionHooks.scheduleThumbnails).toHaveBeenCalledWith('lib-1', 'linked');
  expect(reconcileLinkedWatchersForLibrary).not.toHaveBeenCalled();
  await vi.waitFor(() => {
    expect(reconcileLinkedWatchersForLibrary).toHaveBeenCalledWith('lib-1');
  });
});
