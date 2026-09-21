import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export async function executeLibraryIdentityWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'library.list':
      return { ok: true, type: 'library.list', libraries: libraryService.listLibraries() };
    case 'library.change-sequence':
      return {
        ok: true,
        type: 'library.change-sequence',
        libraryId: request.command.libraryId,
        changeSequence: libraryService.getChangeSequence(request.command.libraryId),
      };
    case 'history.status':
      return {
        ok: true,
        type: 'history.status',
        status: libraryService.getOperationHistoryStatus(request.command.libraryId),
      };
    case 'history.group.begin':
    case 'history.group.complete':
      throw new Error('History group control was not dispatched through its write lease.');
    case 'history.undo': {
      const result = await libraryService.undoOperationHistory(request.command);
      return {
        ok: true,
        type: 'history.undone',
        historyEntryId: result.historyEntryId,
        affectedCount: result.affectedCount,
        status: result.status,
      };
    }
    case 'history.redo': {
      const result = await libraryService.redoOperationHistory(request.command);
      return {
        ok: true,
        type: 'history.redone',
        historyEntryId: result.historyEntryId,
        affectedCount: result.affectedCount,
        status: result.status,
      };
    }
    case 'library.create': {
      const library = libraryService.createLibrary(request.command);
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.recovery-report':
      return {
        ok: true,
        type: 'library.recovery-report',
        reportPath: libraryService.getRecoveryReportPath(request.command.libraryId),
      };
    case 'library.inspect-eagle': {
      const inspected = libraryService.inspectEagleLibrary(
        request.command.sourceRootPath,
      );
      return {
        ok: true,
        type: 'library.eagle-inspected',
        displayName: inspected.displayName,
      };
    }
    case 'library.open-eagle': {
      const library = await libraryService.openEagleLibrary(request.command);
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.inspect-billfish': {
      const inspected = libraryService.inspectBillfishLibrary(
        request.command.sourceRootPath,
        request.command.sourceDisplayName,
      );
      return {
        ok: true,
        type: 'library.billfish-inspected',
        displayName: inspected.displayName,
      };
    }
    case 'library.open-billfish': {
      const library = await libraryService.openBillfishLibrary(request.command);
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.navigation-summary':
      return {
        ok: true,
        type: 'library.navigation-summary',
        summary: await libraryService.getLibraryNavigationSummaryAsync({
          libraryId: request.command.libraryId,
          showIgnored: request.command.showIgnored === true,
          includeTrashedFolders: request.command.includeTrashedFolders === true,
        }),
      };
    default:
      return undefined;
  }
}
