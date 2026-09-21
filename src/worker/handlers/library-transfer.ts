import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export async function executeLibraryTransferWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'library.export': {
      if (request.command.format === 'zip') {
        const exported = await libraryService.exportLibraryToZip({
          libraryId: request.command.libraryId,
          destinationPath: request.command.destinationPath,
          includeLinkedContent: request.command.includeLinkedContent,
        });
        return {
          ok: true,
          type: 'library.exported',
          exportId: exported.exportId,
          libraryId: request.command.libraryId,
          format: 'zip' as const,
          fileCount: exported.fileCount,
          totalBytes: exported.totalBytes,
          excludedPreviewCount: exported.excludedPreviewCount,
          includedLinkedContent: exported.includedLinkedContent,
          durationMs: exported.durationMs,
        };
      }
      const exported = await libraryService.exportLibraryToFolder({
        libraryId: request.command.libraryId,
        destinationPath: request.command.destinationPath,
        includeLinkedContent: request.command.includeLinkedContent,
      });
      return {
        ok: true,
        type: 'library.exported',
        exportId: exported.exportId,
        libraryId: request.command.libraryId,
        format: 'folder' as const,
        fileCount: exported.fileCount,
        totalBytes: exported.totalBytes,
        excludedPreviewCount: exported.excludedPreviewCount,
        includedLinkedContent: exported.includedLinkedContent,
        durationMs: exported.durationMs,
      };
    }
    case 'library.export-cancel':
      libraryService.cancelExport(request.command.exportId);
      return { ok: true, type: 'library.closed', libraryId: request.command.exportId };
    case 'library.import-folder': {
      const imported = await libraryService.importLibraryFromFolder({
        sourceFolderPath: request.command.sourceFolderPath,
        copyToParentPath: request.command.copyToParentPath,
      });
      return {
        ok: true,
        type: 'library.imported',
        importId: imported.importId,
        libraryId: imported.libraryId,
        displayName: imported.displayName,
        libraryPath: imported.libraryPath,
      };
    }
    case 'library.import-zip': {
      const imported = await libraryService.importLibraryFromZip({
        sourceZipPath: request.command.sourceZipPath,
        destinationParentPath: request.command.destinationParentPath,
      });
      return {
        ok: true,
        type: 'library.imported',
        importId: imported.importId,
        libraryId: imported.libraryId,
        displayName: imported.displayName,
        libraryPath: imported.libraryPath,
      };
    }
    case 'library.import-cancel':
      libraryService.cancelImport(
        request.command.importId,
        request.command.mode ?? 'abandon',
      );
      return { ok: true, type: 'library.closed', libraryId: request.command.importId };
    case 'library.import-validate': {
      const validated = libraryService.validateImportSource(request.command.sourceFolderPath);
      return {
        ok: true,
        type: 'library.import-validated',
        importId: request.command.importId,
        libraryId: validated.libraryId,
        displayName: validated.displayName,
      };
    }
    default:
      return undefined;
  }
}
