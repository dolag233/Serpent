import { expect, test, vi } from 'vitest';

import { executeMediaGenerationWorkerCommand } from '../../src/worker/handlers/media-generation';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function generationRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function hooks() {
  return {
    writePluginMediaArtifact: vi.fn(async () => null),
    scheduleThumbnails: vi.fn(),
    publishThumbnailReady: vi.fn(),
    scheduleSecondaryMediaQueue: vi.fn(),
  };
}

test('media.generate-thumbnail publishes a ready event when an artifact is produced', async () => {
  const libraryService = {
    generateThumbnail: vi.fn(async () => ({ artifactId: 'art-1' })),
    isModelAsset: vi.fn(() => false),
  } as unknown as LibraryService;
  const generationHooks = hooks();

  await expect(executeMediaGenerationWorkerCommand(
    libraryService,
    generationRequest({
      type: 'media.generate-thumbnail',
      libraryId: 'lib-1',
      assetId: 'asset-1',
    }),
    generationHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'media.thumbnail.generated',
    assetId: 'asset-1',
    artifactId: 'art-1',
  });
  expect(generationHooks.publishThumbnailReady).toHaveBeenCalledWith({
    type: 'asset.thumbnail.ready',
    libraryId: 'lib-1',
    assetId: 'asset-1',
    artifactId: 'art-1',
  });
  expect(generationHooks.scheduleThumbnails).not.toHaveBeenCalled();
});

test('media.generate-thumbnail schedules a mutation scene for model assets without an artifact', async () => {
  const libraryService = {
    generateThumbnail: vi.fn(async () => null),
    isModelAsset: vi.fn(() => true),
  } as unknown as LibraryService;
  const generationHooks = hooks();

  await expect(executeMediaGenerationWorkerCommand(
    libraryService,
    generationRequest({
      type: 'media.generate-thumbnail',
      libraryId: 'lib-1',
      assetId: 'asset-1',
    }),
    generationHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'media.thumbnail.generated',
    assetId: 'asset-1',
  });
  expect(generationHooks.scheduleThumbnails).toHaveBeenCalledWith('lib-1', 'mutation', ['asset-1']);
});

test('media.retry-artifact uses the urgent secondary queue for proxies', async () => {
  const libraryService = {
    enqueueArtifactRetry: vi.fn(),
  } as unknown as LibraryService;
  const generationHooks = hooks();

  await expect(executeMediaGenerationWorkerCommand(
    libraryService,
    generationRequest({
      type: 'media.retry-artifact',
      libraryId: 'lib-1',
      assetId: 'asset-1',
      kind: 'webm_proxy',
    }),
    generationHooks,
  )).resolves.toEqual({
    ok: true,
    type: 'media.retry-artifact.queued',
    assetId: 'asset-1',
    kind: 'webm_proxy',
  });
  expect(generationHooks.scheduleSecondaryMediaQueue).toHaveBeenCalledWith('lib-1', {
    assetId: 'asset-1',
    urgent: true,
  });
});
