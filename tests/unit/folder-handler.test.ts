import { expect, test, vi } from 'vitest';

import { executeFolderWorkerCommand } from '../../src/worker/handlers/folders';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function folderRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function hooks() {
  return {
    scheduleCoverThumbnails: vi.fn(),
    recordPermanentDeleteBarrier: vi.fn(),
  };
}

test('folder.list returns managed folders', async () => {
  const folders = [{ folderId: 'folder-1', name: 'Refs' }];
  const libraryService = {
    listManagedFolders: vi.fn(() => folders),
  } as unknown as LibraryService;

  await expect(executeFolderWorkerCommand(
    libraryService,
    folderRequest({ type: 'folder.list', libraryId: 'lib-1' }),
    hooks(),
  )).resolves.toEqual({
    ok: true,
    type: 'folder.list',
    folders,
  });
  expect(libraryService.listManagedFolders).toHaveBeenCalledWith('lib-1', false);
});

test('folder.browse-entries schedules cover thumbnails for child folder cards', async () => {
  const entries = [
    { folderId: 'folder-a', coverAssetIds: ['asset-1', 'asset-2'] },
    { folderId: 'folder-b', coverAssetIds: ['asset-3'] },
  ];
  const libraryService = {
    listFolderBrowseEntries: vi.fn(() => entries),
  } as unknown as LibraryService;
  const folderHooks = hooks();

  await expect(executeFolderWorkerCommand(
    libraryService,
    folderRequest({
      type: 'folder.browse-entries',
      libraryId: 'lib-1',
      parentFolderId: null,
    }),
    folderHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'folder.browse-entries',
    entries,
  });
  expect(folderHooks.scheduleCoverThumbnails).toHaveBeenCalledWith(
    'lib-1',
    ['asset-1', 'asset-2', 'asset-3'],
    8,
  );
});

test('folder.delete-from-disk records a permanent-delete history barrier', async () => {
  const libraryService = {
    deleteManagedFolderFromDiskAsync: vi.fn(async () => ({
      deletedAssetCount: 3,
      removedFolderCount: 1,
    })),
  } as unknown as LibraryService;
  const folderHooks = hooks();

  await expect(executeFolderWorkerCommand(
    libraryService,
    folderRequest({
      type: 'folder.delete-from-disk',
      libraryId: 'lib-1',
      folderId: 'folder-1',
    }),
    folderHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'folder.deleted-from-disk',
    folderId: 'folder-1',
    deletedAssetCount: 3,
    removedFolderCount: 1,
  });
  expect(folderHooks.recordPermanentDeleteBarrier).toHaveBeenCalledWith({
    libraryId: 'lib-1',
    commandId: 'folder.delete-from-disk',
    labelKey: 'history.folder.delete-from-disk',
    reason: 'managed-folder-permanent-delete',
    affectedCount: 4,
    affectedEntities: ['folder-1'],
    historyContext: undefined,
  });
});

test('folder.rename records inverse history from before/after snapshots', async () => {
  const folder = { folderId: 'folder-1', name: 'Renamed' };
  let snapshotCalls = 0;
  const recordOperationHistory = vi.fn(() => ({ historyEntryId: 'hist-1' }));
  const libraryService = {
    getManagedFolderHistorySnapshot: vi.fn((input: { folderIds: string[] }) => {
      snapshotCalls += 1;
      const name = snapshotCalls === 1 ? 'Original' : 'Renamed';
      return input.folderIds.map((folderId) => ({ folderId, name }));
    }),
    renameManagedFolder: vi.fn(() => folder),
    recordOperationHistory,
  } as unknown as LibraryService;

  await expect(executeFolderWorkerCommand(
    libraryService,
    folderRequest({
      type: 'folder.rename',
      libraryId: 'lib-1',
      folderId: 'folder-1',
      newName: 'Renamed',
    }),
    hooks(),
  )).resolves.toEqual({
    ok: true,
    type: 'folder.renamed',
    folder,
    historyEntryId: 'hist-1',
  });
  expect(recordOperationHistory).toHaveBeenCalledWith(
    expect.objectContaining({
      commandId: 'folder.rename',
      forwardRecipe: expect.objectContaining({
        payload: expect.objectContaining({
          expectedName: 'Original',
          newName: 'Renamed',
        }),
      }),
      inverseRecipe: expect.objectContaining({
        payload: expect.objectContaining({
          expectedName: 'Renamed',
          newName: 'Original',
        }),
      }),
    }),
  );
});

test('library.open is left to the lifecycle dispatcher', async () => {
  await expect(executeFolderWorkerCommand(
    {} as LibraryService,
    folderRequest({
      type: 'library.open',
      selectedLibraryPath: 'C:\\libraries\\incoming',
    }),
    hooks(),
  )).resolves.toBeUndefined();
});
