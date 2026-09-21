import { expect, test, vi } from 'vitest';

import { executeIgnoreWorkerCommand } from '../../src/worker/handlers/ignore';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function ignoreRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('ignore.list returns ignored paths', () => {
  const paths = ['tmp'];
  const libraryService = {
    listIgnoredPaths: vi.fn(() => paths),
  } as unknown as LibraryService;

  expect(executeIgnoreWorkerCommand(
    libraryService,
    ignoreRequest({ type: 'ignore.list', libraryId: 'lib-1' }),
    { scheduleRefreshThumbnails: vi.fn() },
  )).toEqual({
    ok: true,
    type: 'ignore.list',
    paths,
  });
});

test('ignore.set schedules a refresh thumbnail scene', () => {
  const libraryService = {
    setIgnore: vi.fn(() => ({ ignored: true, path: 'refs/sketch.png' })),
  } as unknown as LibraryService;
  const scheduleRefreshThumbnails = vi.fn();

  expect(executeIgnoreWorkerCommand(
    libraryService,
    ignoreRequest({
      type: 'ignore.set',
      libraryId: 'lib-1',
      locationKind: 'managed',
      relativePath: 'refs/sketch.png',
      pathKind: 'asset',
      ignored: true,
    }),
    { scheduleRefreshThumbnails },
  )).toEqual({
    ok: true,
    type: 'ignore.updated',
    ignored: true,
    path: 'refs/sketch.png',
  });
  expect(scheduleRefreshThumbnails).toHaveBeenCalledWith('lib-1');
});
