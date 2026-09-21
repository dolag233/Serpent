import { expect, test, vi } from 'vitest';

import { executeLibraryIdentityWorkerCommand } from '../../src/worker/handlers/library-identity';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function identityRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('library.list returns the service catalog', async () => {
  const libraries = [{ libraryId: 'lib-1', displayName: 'Studio' }];
  const libraryService = {
    listLibraries: vi.fn(() => libraries),
  } as unknown as LibraryService;

  await expect(executeLibraryIdentityWorkerCommand(
    libraryService,
    identityRequest({ type: 'library.list' }),
  )).resolves.toEqual({
    ok: true,
    type: 'library.list',
    libraries,
  });
});

test('library.create returns the opened library identity', async () => {
  const library = { libraryId: 'lib-1', displayName: 'Studio' };
  const libraryService = {
    createLibrary: vi.fn(() => library),
  } as unknown as LibraryService;

  await expect(executeLibraryIdentityWorkerCommand(
    libraryService,
    identityRequest({
      type: 'library.create',
      displayName: 'Studio',
      selectedParentPath: 'C:\\libraries',
    }),
  )).resolves.toEqual({
    ok: true,
    type: 'library.opened',
    library,
  });
  expect(libraryService.createLibrary).toHaveBeenCalledWith({
    type: 'library.create',
    displayName: 'Studio',
    selectedParentPath: 'C:\\libraries',
  });
});

test('history.group.begin stays on the write-lease path', async () => {
  await expect(executeLibraryIdentityWorkerCommand(
    {} as LibraryService,
    identityRequest({
      type: 'history.group.begin',
      libraryId: 'lib-1',
    }),
  )).rejects.toThrow('History group control was not dispatched through its write lease.');
});

test('library.inspect-eagle returns the inspected display name', async () => {
  const libraryService = {
    inspectEagleLibrary: vi.fn(() => ({ displayName: 'Eagle Studio' })),
  } as unknown as LibraryService;

  await expect(executeLibraryIdentityWorkerCommand(
    libraryService,
    identityRequest({
      type: 'library.inspect-eagle',
      sourceRootPath: 'C:\\libraries\\eagle-studio',
    }),
  )).resolves.toEqual({
    ok: true,
    type: 'library.eagle-inspected',
    displayName: 'Eagle Studio',
  });
});

test('library.open is left to the lifecycle dispatcher', async () => {
  await expect(executeLibraryIdentityWorkerCommand(
    {} as LibraryService,
    identityRequest({
      type: 'library.open',
      selectedLibraryPath: 'C:\\libraries\\studio',
    }),
  )).resolves.toBeUndefined();
});
