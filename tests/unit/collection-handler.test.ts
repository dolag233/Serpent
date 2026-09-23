import { expect, test, vi } from 'vitest';

import { executeCollectionWorkerCommand } from '../../src/worker/handlers/collections';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function collectionRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('collection.list returns collections', () => {
  const collections = [{ collectionId: 'col-1', name: 'Hero' }];
  const libraryService = {
    listCollections: vi.fn(() => collections),
  } as unknown as LibraryService;

  expect(executeCollectionWorkerCommand(
    libraryService,
    collectionRequest({ type: 'collection.list', libraryId: 'lib-1' }),
  )).toEqual({
    ok: true,
    type: 'collection.list',
    collections,
  });
});

test('collection.assets.list does not schedule thumbnails', () => {
  const assets = [{ assetId: 'asset-1' }];
  const libraryService = {
    listCollectionAssets: vi.fn(() => assets),
  } as unknown as LibraryService;

  expect(executeCollectionWorkerCommand(
    libraryService,
    collectionRequest({
      type: 'collection.assets.list',
      libraryId: 'lib-1',
      collectionId: 'col-1',
      recursive: false,
    }),
  )).toEqual({
    ok: true,
    type: 'collection.assets.list',
    assets,
  });
});

test('collection.create stays on the bounded-write path', () => {
  expect(() => executeCollectionWorkerCommand(
    {} as LibraryService,
    collectionRequest({
      type: 'collection.create',
      libraryId: 'lib-1',
      name: 'Hero',
    }),
  )).toThrow('Bounded collection.create write was not dispatched through its transaction fence.');
});
