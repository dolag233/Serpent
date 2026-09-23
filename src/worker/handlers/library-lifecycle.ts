import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export type LibraryLifecycleHooks = {
  prepareForOpen: () => void;
  stopAutomaticWork: (libraryId: string) => void;
};

export async function executeLibraryLifecycleWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: LibraryLifecycleHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'library.open': {
      // Switching libraries through the recent list sends `library.open` for the
      // replacement WITHOUT a preceding `library.close`
      // (library.open-recent.request dispatches open directly). Stop the outgoing
      // libraries' automatic work first, or this command starves behind their
      // media churn and the switch never completes. Queued jobs are preserved:
      // a switch will reopen them. See `library-open-stop.ts` for the rules and
      // the tests that guard them.
      hooks.prepareForOpen();
      // Deterministic renderer E2E seam for the library safety overlay. This
      // is never enabled in production and keeps the opening stage observable
      // long enough to assert that partial navigation stays covered.
      if (process.env.SERPENT_E2E === '1') {
        const delayMs = Number.parseInt(
          process.env.SERPENT_E2E_LIBRARY_OPEN_DELAY_MS ?? '',
          10,
        );
        if (Number.isInteger(delayMs) && delayMs > 0 && delayMs <= 10_000) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
      const library = libraryService.openLibrary(request.command.selectedLibraryPath, {
        replaceExisting: request.command.replaceExisting === true,
      });
      return { ok: true, type: 'library.opened', library };
    }
    case 'library.close':
      hooks.stopAutomaticWork(request.command.libraryId);
      if (process.env.SERPENT_E2E === '1') {
        const delayMs = Number.parseInt(
          process.env.SERPENT_E2E_CLOSE_DELAY_MS ?? '',
          10,
        );
        if (Number.isInteger(delayMs) && delayMs > 0 && delayMs <= 10_000) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
      await libraryService.closeLibraryAsync(request.command.libraryId);
      return { ok: true, type: 'library.closed', libraryId: request.command.libraryId };
    case 'library.rename': {
      const renamed = libraryService.renameLibrary(request.command);
      return { ok: true, type: 'library.renamed', library: renamed };
    }
    case 'library.delete-from-disk': {
      hooks.stopAutomaticWork(request.command.libraryId);
      // Keep the last verified snapshot before the irreversible library-root
      // deletion. The delete operation itself remains synchronous for its
      // existing recovery/reopen contract.
      await libraryService.drainLibraryMedia(request.command.libraryId);
      await libraryService.createDatabaseBackup(request.command.libraryId);
      const deleted = libraryService.deleteLibraryFromDisk(request.command.libraryId);
      return {
        ok: true,
        type: 'library.deleted',
        libraryId: deleted.libraryId,
        displayName: deleted.displayName,
        libraryPath: deleted.libraryPath,
        ...(deleted.pendingAsidePath ? { pendingAsidePath: deleted.pendingAsidePath } : {}),
      };
    }
    case 'system.cleanup-pending-deletions': {
      const outcome = libraryService.cleanupPendingDeletions(request.command.asidePaths);
      return {
        ok: true,
        type: 'system.cleanup-pending-deletions',
        cleanedPaths: outcome.cleanedPaths,
        remainingPaths: outcome.remainingPaths,
      };
    }
    default:
      return undefined;
  }
}
