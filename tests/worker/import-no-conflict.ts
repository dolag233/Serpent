import type { LibraryService } from '../../src/worker/library-service';
import type { ImportCompletion } from '../../src/shared/protocol/responses';

export type ImportNoConflictDecisions = {
  readonly suspectedDuplicate?: 'skip' | 'merge' | 'create-copy';
  readonly nameConflict?: 'keep-both' | 'replace' | 'skip';
};

/**
 * Worker-test helper: execute an import even when library-level content
 * duplicates or name conflicts appear (Serpent-liyu / library dedup).
 *
 * Default decisions create a second managed copy so fixtures that need N
 * distinct assets with identical bytes still land on disk. Product UI still
 * surfaces ConflictsDialog / NameConflictDialog / ContentDuplicateDialog.
 */
export function importNoConflict(
  service: LibraryService,
  libraryId: string,
  sourcePath: string,
  targetFolderId?: string,
  decisions: ImportNoConflictDecisions = {},
): ImportCompletion {
  const prepared = service.prepareOrExecuteImport({
    libraryId,
    targetFolderId,
    sourceKind: 'files',
    sourcePaths: [sourcePath],
  });
  if ('importId' in prepared) {
    return service.resolveImport({
      importId: prepared.importId,
      suspectedDuplicate: decisions.suspectedDuplicate ?? 'create-copy',
      nameConflict: decisions.nameConflict ?? 'keep-both',
    });
  }
  return prepared;
}
