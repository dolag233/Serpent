import { expect, test, vi } from 'vitest';

import { executeSyncWorkerCommand } from '../../src/worker/handlers/sync';
import type { LibraryService } from '../../src/worker/library-service';
import { RemoteStorageError } from '../../src/worker/sync/remote-storage';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function syncRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('sync.poll-remote skips the network when the library is not open', async () => {
  const libraryService = {
    isLibraryOpen: vi.fn(() => false),
  } as unknown as LibraryService;

  await expect(executeSyncWorkerCommand(
    libraryService,
    undefined,
    syncRequest({
      type: 'sync.poll-remote',
      libraryId: 'lib-1',
      deviceId: 'device-1',
      baseUrl: 'https://example.invalid',
    }),
  )).resolves.toEqual({
    ok: true,
    type: 'sync.poll-remote.result',
    changed: false,
  });
  expect(libraryService.isLibraryOpen).toHaveBeenCalledWith('lib-1');
});

test('sync.asset-card-status returns no rows when the library is not open', async () => {
  const libraryService = {
    isLibraryOpen: vi.fn(() => false),
    listSyncCardStatuses: vi.fn(),
  } as unknown as LibraryService;

  await expect(executeSyncWorkerCommand(
    libraryService,
    undefined,
    syncRequest({
      type: 'sync.asset-card-status',
      libraryId: 'lib-1',
      assetIds: ['asset-1'],
    }),
  )).resolves.toEqual({
    ok: true,
    type: 'sync.asset-card-status',
    statuses: [],
  });
  expect(libraryService.listSyncCardStatuses).not.toHaveBeenCalled();
});

test('sync.preview rejects an unusable server address before touching the engine', async () => {
  await expect(executeSyncWorkerCommand(
    {} as LibraryService,
    undefined,
    syncRequest({
      type: 'sync.preview',
      libraryId: 'lib-1',
      deviceId: 'device-1',
      baseUrl: 'ftp://example.invalid',
    }),
  )).rejects.toMatchObject({
    name: RemoteStorageError.name,
    code: 'INVALID_URL',
  });
});

test('non-sync commands are left to the remaining dispatcher', async () => {
  await expect(executeSyncWorkerCommand(
    {} as LibraryService,
    undefined,
    syncRequest({ type: 'library.list' }),
  )).resolves.toBeUndefined();
});
