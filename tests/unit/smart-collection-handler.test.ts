import { expect, test, vi } from 'vitest';

import { executeSmartCollectionWorkerCommand } from '../../src/worker/handlers/smart-collections';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function smartCollectionRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('smart-collection.list returns saved collections', () => {
  const collections = [{ collectionId: 'sc-1', name: 'Heroes' }];
  const libraryService = {
    listSmartCollections: vi.fn(() => collections),
  } as unknown as LibraryService;

  expect(executeSmartCollectionWorkerCommand(
    libraryService,
    smartCollectionRequest({ type: 'smart-collection.list', libraryId: 'lib-1' }),
  )).toEqual({
    ok: true,
    type: 'smart-collection.list',
    collections,
  });
});

test('smart-collection.execute returns optional layout fields', () => {
  const libraryService = {
    executeSmartCollection: vi.fn(() => ({
      items: [{ assetId: 'asset-1' }],
      total: 1,
      offset: 0,
      layout: { columns: 4 },
    })),
  } as unknown as LibraryService;

  expect(executeSmartCollectionWorkerCommand(
    libraryService,
    smartCollectionRequest({
      type: 'smart-collection.execute',
      libraryId: 'lib-1',
      collectionId: 'sc-1',
    }),
  )).toEqual({
    ok: true,
    type: 'smart-collection.executed',
    items: [{ assetId: 'asset-1' }],
    total: 1,
    offset: 0,
    layout: { columns: 4 },
  });
});
