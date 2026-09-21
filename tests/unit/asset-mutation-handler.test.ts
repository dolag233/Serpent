import { expect, test, vi } from 'vitest';

import { executeAssetMutationWorkerCommand } from '../../src/worker/handlers/asset-mutations';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function mutationRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function hooks() {
  return {
    scheduleThumbnails: vi.fn(),
    recordPermanentDeleteBarrier: vi.fn(),
  };
}

test('asset.trash records desktop history when an operation id is returned', async () => {
  const libraryService = {
    trashAssets: vi.fn(() => ({ trashedCount: 2, operationId: 'op-1' })),
    recordOperationHistory: vi.fn(() => ({ historyEntryId: 'hist-1' })),
  } as unknown as LibraryService;
  const mutationHooks = hooks();

  await expect(executeAssetMutationWorkerCommand(
    libraryService,
    mutationRequest({
      type: 'asset.trash',
      libraryId: 'lib-1',
      assetIds: ['asset-1', 'asset-2'],
    }),
    mutationHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'asset.trashed',
    trashedCount: 2,
    operationId: 'op-1',
    historyEntryId: 'hist-1',
  });
  expect(mutationHooks.scheduleThumbnails).not.toHaveBeenCalled();
});

test('asset.delete-permanent records a history barrier', async () => {
  const libraryService = {
    deleteAssetsPermanent: vi.fn(() => ({
      deletedCount: 3,
      skippedCount: 0,
      skippedReasons: [],
    })),
  } as unknown as LibraryService;
  const mutationHooks = hooks();

  await expect(executeAssetMutationWorkerCommand(
    libraryService,
    mutationRequest({
      type: 'asset.delete-permanent',
      libraryId: 'lib-1',
      assetIds: ['asset-1', 'asset-2', 'asset-3'],
    }),
    mutationHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'asset.deleted-permanent',
    deletedCount: 3,
    skippedCount: 0,
    skippedReasons: [],
  });
  expect(mutationHooks.recordPermanentDeleteBarrier).toHaveBeenCalledWith({
    libraryId: 'lib-1',
    commandId: 'asset.delete-permanent',
    labelKey: 'history.asset.delete-permanent',
    reason: 'trash-asset-permanent-delete',
    affectedCount: 3,
    affectedEntities: ['asset-1', 'asset-2', 'asset-3'],
    historyContext: undefined,
  });
});

test('asset.delete-cancel maps the operation id onto library.closed', async () => {
  const libraryService = {
    cancelDiskDelete: vi.fn(),
  } as unknown as LibraryService;

  await expect(executeAssetMutationWorkerCommand(
    libraryService,
    mutationRequest({
      type: 'asset.delete-cancel',
      operationId: 'op-9',
    }),
    hooks(),
  )).resolves.toEqual({
    ok: true,
    type: 'library.closed',
    libraryId: 'op-9',
  });
  expect(libraryService.cancelDiskDelete).toHaveBeenCalledWith('op-9');
});
