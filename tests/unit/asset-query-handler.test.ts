import { expect, test, vi } from 'vitest';

import { executeAssetQueryWorkerCommand } from '../../src/worker/handlers/asset-query';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function queryRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function hooks(overrides: Partial<{
  shouldYieldForSearchCoalescing: (libraryId: string) => boolean;
  isLatestSearchRequest: (libraryId: string, laneKey: string, requestId: string) => boolean;
}> = {}) {
  return {
    shouldYieldForSearchCoalescing: vi.fn(() => false),
    isLatestSearchRequest: vi.fn(() => true),
    ...overrides,
  };
}

test('asset.metadata.get returns service metadata', async () => {
  const metadata = { title: 'Hero' };
  const libraryService = {
    getAssetMetadata: vi.fn(() => metadata),
  } as unknown as LibraryService;

  await expect(executeAssetQueryWorkerCommand(
    libraryService,
    queryRequest({
      type: 'asset.metadata.get',
      libraryId: 'lib-1',
      assetId: 'asset-1',
    }),
    hooks(),
  )).resolves.toEqual({
    ok: true,
    type: 'asset.metadata.got',
    metadata,
  });
});

test('asset.search returns an empty page when a newer request superseded it', async () => {
  const libraryService = {
    searchAssets: vi.fn(),
  } as unknown as LibraryService;

  await expect(executeAssetQueryWorkerCommand(
    libraryService,
    queryRequest({
      type: 'asset.search',
      libraryId: 'lib-1',
      query: { clauses: [] },
    }),
    hooks({ isLatestSearchRequest: () => false }),
  )).resolves.toEqual({
    ok: true,
    type: 'asset.search.result',
    items: [],
    total: 0,
    offset: 0,
  });
  expect(libraryService.searchAssets).not.toHaveBeenCalled();
});

test('asset.rating.set stays on the bounded-write path', async () => {
  await expect(executeAssetQueryWorkerCommand(
    {} as LibraryService,
    queryRequest({
      type: 'asset.rating.set',
      libraryId: 'lib-1',
      assetIds: ['asset-1'],
      rating: 5,
    }),
    hooks(),
  )).rejects.toThrow('Bounded rating write was not dispatched through its transaction fence.');
});
