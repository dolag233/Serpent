import { expect, test, vi } from 'vitest';

import { executeLibraryTransferWorkerCommand } from '../../src/worker/handlers/library-transfer';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function transferRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('library.export zip uses the zip exporter', async () => {
  const exported = {
    exportId: 'export-1',
    fileCount: 3,
    totalBytes: 12,
    excludedPreviewCount: 0,
    includedLinkedContent: false,
    durationMs: 40,
  };
  const libraryService = {
    exportLibraryToZip: vi.fn(async () => exported),
  } as unknown as LibraryService;

  await expect(executeLibraryTransferWorkerCommand(
    libraryService,
    transferRequest({
      type: 'library.export',
      libraryId: 'lib-1',
      destinationPath: 'C:\\exports\\studio.zip',
      format: 'zip',
      includeLinkedContent: false,
    }),
  )).resolves.toEqual({
    ok: true,
    type: 'library.exported',
    exportId: 'export-1',
    libraryId: 'lib-1',
    format: 'zip',
    fileCount: 3,
    totalBytes: 12,
    excludedPreviewCount: 0,
    includedLinkedContent: false,
    durationMs: 40,
  });
  expect(libraryService.exportLibraryToZip).toHaveBeenCalledWith({
    libraryId: 'lib-1',
    destinationPath: 'C:\\exports\\studio.zip',
    includeLinkedContent: false,
  });
});

test('library.import-validate returns the inspected library identity', async () => {
  const libraryService = {
    validateImportSource: vi.fn(() => ({
      libraryId: 'lib-2',
      displayName: 'Imported',
    })),
  } as unknown as LibraryService;

  await expect(executeLibraryTransferWorkerCommand(
    libraryService,
    transferRequest({
      type: 'library.import-validate',
      importId: 'import-1',
      sourceFolderPath: 'C:\\imports\\studio',
    }),
  )).resolves.toEqual({
    ok: true,
    type: 'library.import-validated',
    importId: 'import-1',
    libraryId: 'lib-2',
    displayName: 'Imported',
  });
});

test('library.import-cancel defaults to abandon', async () => {
  const libraryService = {
    cancelImport: vi.fn(),
  } as unknown as LibraryService;

  await expect(executeLibraryTransferWorkerCommand(
    libraryService,
    transferRequest({
      type: 'library.import-cancel',
      importId: 'import-1',
    }),
  )).resolves.toEqual({
    ok: true,
    type: 'library.closed',
    libraryId: 'import-1',
  });
  expect(libraryService.cancelImport).toHaveBeenCalledWith('import-1', 'abandon');
});
