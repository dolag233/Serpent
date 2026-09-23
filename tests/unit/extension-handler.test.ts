import { expect, test, vi } from 'vitest';

import { executeExtensionWorkerCommand } from '../../src/worker/handlers/extension';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function extensionRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('extension.save-from-url schedules a mutation thumbnail', async () => {
  const asset = { assetId: 'asset-1' };
  const libraryService = {
    saveAssetFromUrl: vi.fn(async () => ({ asset })),
  } as unknown as LibraryService;
  const scheduleMutationThumbnails = vi.fn();

  await expect(executeExtensionWorkerCommand(
    libraryService,
    extensionRequest({
      type: 'extension.save-from-url',
      libraryId: 'lib-1',
      mediaUrl: 'https://example.com/hero.png',
    }),
    { scheduleMutationThumbnails },
  )).resolves.toEqual({
    ok: true,
    type: 'extension.asset-saved',
    asset,
  });
  expect(scheduleMutationThumbnails).toHaveBeenCalledWith('lib-1', ['asset-1']);
});

test('extension.save-from-file schedules a mutation thumbnail', async () => {
  const asset = { assetId: 'asset-2' };
  const libraryService = {
    saveAssetFromFile: vi.fn(async () => ({ asset })),
  } as unknown as LibraryService;
  const scheduleMutationThumbnails = vi.fn();

  await expect(executeExtensionWorkerCommand(
    libraryService,
    extensionRequest({
      type: 'extension.save-from-file',
      libraryId: 'lib-1',
      stagedFilePath: 'C:\\temp\\staged.png',
      contentType: 'image/png',
      filename: 'hero.png',
    }),
    { scheduleMutationThumbnails },
  )).resolves.toEqual({
    ok: true,
    type: 'extension.asset-saved',
    asset,
  });
  expect(scheduleMutationThumbnails).toHaveBeenCalledWith('lib-1', ['asset-2']);
});
