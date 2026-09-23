import { expect, test, vi } from 'vitest';

import { executeLibraryLifecycleWorkerCommand } from '../../src/worker/handlers/library-lifecycle';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function lifecycleRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function hooks() {
  return {
    prepareForOpen: vi.fn(),
    stopAutomaticWork: vi.fn(),
  };
}

test('library.open stops outgoing work then opens the selected library', async () => {
  const library = { libraryId: 'lib-2', displayName: 'Incoming' };
  const libraryService = {
    openLibrary: vi.fn(() => library),
  } as unknown as LibraryService;
  const lifecycleHooks = hooks();

  await expect(executeLibraryLifecycleWorkerCommand(
    libraryService,
    lifecycleRequest({
      type: 'library.open',
      selectedLibraryPath: 'C:\\libraries\\incoming',
      replaceExisting: true,
    }),
    lifecycleHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'library.opened',
    library,
  });
  expect(lifecycleHooks.prepareForOpen).toHaveBeenCalledOnce();
  expect(libraryService.openLibrary).toHaveBeenCalledWith('C:\\libraries\\incoming', {
    replaceExisting: true,
  });
});

test('library.close stops automatic work before awaiting close', async () => {
  const libraryService = {
    closeLibraryAsync: vi.fn(async () => undefined),
  } as unknown as LibraryService;
  const lifecycleHooks = hooks();

  await expect(executeLibraryLifecycleWorkerCommand(
    libraryService,
    lifecycleRequest({ type: 'library.close', libraryId: 'lib-1' }),
    lifecycleHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'library.closed',
    libraryId: 'lib-1',
  });
  expect(lifecycleHooks.stopAutomaticWork).toHaveBeenCalledWith('lib-1');
  expect(libraryService.closeLibraryAsync).toHaveBeenCalledWith('lib-1');
});

test('library.delete-from-disk drains, backups, then deletes after stop', async () => {
  const libraryService = {
    drainLibraryMedia: vi.fn(async () => undefined),
    createDatabaseBackup: vi.fn(async () => undefined),
    deleteLibraryFromDisk: vi.fn(() => ({
      libraryId: 'lib-1',
      displayName: 'Studio',
      libraryPath: 'C:\\libraries\\studio',
      pendingAsidePath: 'C:\\libraries\\studio.del-1',
    })),
  } as unknown as LibraryService;
  const lifecycleHooks = hooks();

  await expect(executeLibraryLifecycleWorkerCommand(
    libraryService,
    lifecycleRequest({ type: 'library.delete-from-disk', libraryId: 'lib-1' }),
    lifecycleHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'library.deleted',
    libraryId: 'lib-1',
    displayName: 'Studio',
    libraryPath: 'C:\\libraries\\studio',
    pendingAsidePath: 'C:\\libraries\\studio.del-1',
  });
  expect(lifecycleHooks.stopAutomaticWork).toHaveBeenCalledWith('lib-1');
  expect(libraryService.drainLibraryMedia).toHaveBeenCalledWith('lib-1');
  expect(libraryService.createDatabaseBackup).toHaveBeenCalledWith('lib-1');
});

test('library.rename does not stop automatic work', async () => {
  const library = { libraryId: 'lib-1', displayName: 'Renamed' };
  const libraryService = {
    renameLibrary: vi.fn(() => library),
  } as unknown as LibraryService;
  const lifecycleHooks = hooks();

  await expect(executeLibraryLifecycleWorkerCommand(
    libraryService,
    lifecycleRequest({
      type: 'library.rename',
      libraryId: 'lib-1',
      displayName: 'Renamed',
    }),
    lifecycleHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'library.renamed',
    library,
  });
  expect(lifecycleHooks.prepareForOpen).not.toHaveBeenCalled();
  expect(lifecycleHooks.stopAutomaticWork).not.toHaveBeenCalled();
});
