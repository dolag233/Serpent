import { expect, test, vi } from 'vitest';

import { executeMediaPathWorkerCommand } from '../../src/worker/handlers/media-paths';
import { LibraryServiceError, type LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function mediaPathRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function hooks() {
  return {
    writePluginMediaArtifact: vi.fn(async () => null),
    scheduleThumbnails: vi.fn(),
    mutationPendingFor: vi.fn(() => false),
  };
}

test('media.get-artifact-path returns the absolute artifact path', async () => {
  const libraryService = {
    getArtifactAbsolutePath: vi.fn(() => 'C:\\libraries\\studio\\artifacts\\a.webp'),
  } as unknown as LibraryService;

  await expect(executeMediaPathWorkerCommand(
    libraryService,
    mediaPathRequest({
      type: 'media.get-artifact-path',
      libraryId: 'lib-1',
      artifactId: 'art-1',
      usage: 'preview',
    }),
    hooks(),
  )).resolves.toEqual({
    ok: true,
    type: 'media.artifact-path',
    artifactId: 'art-1',
    absolutePath: 'C:\\libraries\\studio\\artifacts\\a.webp',
  });
});

test('media.get-thumbnail-artifact throws when the asset is missing', async () => {
  const libraryService = {
    getThumbnailArtifact: vi.fn(() => null),
  } as unknown as LibraryService;

  await expect(executeMediaPathWorkerCommand(
    libraryService,
    mediaPathRequest({
      type: 'media.get-thumbnail-artifact',
      libraryId: 'lib-1',
      assetId: 'asset-1',
    }),
    hooks(),
  )).rejects.toBeInstanceOf(LibraryServiceError);
});

test('media.get-asset-drag-infos yields between sub-batches', async () => {
  const libraryService = {
    resolveAssetDragInfos: vi.fn((_libraryId: string, assetIds: string[]) => (
      assetIds.map((assetId) => ({ assetId }))
    )),
  } as unknown as LibraryService;

  await expect(executeMediaPathWorkerCommand(
    libraryService,
    mediaPathRequest({
      type: 'media.get-asset-drag-infos',
      libraryId: 'lib-1',
      assetIds: Array.from({ length: 33 }, (_, index) => `asset-${index + 1}`),
    }),
    hooks(),
  )).resolves.toEqual({
    ok: true,
    type: 'media.asset-drag-infos',
    entries: Array.from({ length: 33 }, (_, index) => ({ assetId: `asset-${index + 1}` })),
  });
  expect(libraryService.resolveAssetDragInfos).toHaveBeenCalledTimes(2);
});
