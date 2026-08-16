import { useCallback } from 'react';

import type { ManagedFolderSummary } from '../shared/asset-types';
import type { SerpentLibraryApi } from '../shared/library-api';
import { LibraryOperationError, toMessage } from './error-utils';
import {
  resolveDraggedFolderIdsForTrash,
  resolveFolderOntoFolderDrop,
  type FolderDragFact,
} from './folder-drag-drop';
import { isBrowseScopeAffectedByFolderTrash } from './folder-trash-scope';
import { useLocale, useT } from './i18n';

export type UseFolderDragDropHandlersParams = {
  api: SerpentLibraryApi | null;
  libraryId: string | null;
  assetScope: string;
  folders: readonly ManagedFolderSummary[];
  setNotice: (message: string, historyEntryId?: string) => void;
  setError: (message: string | null) => void;
  setUiState: (state: 'loading' | 'ready') => void;
  reloadCurrentContent: () => Promise<void>;
  /** Remove trashed managed-folder rows immediately, independent of browse scope. */
  onManagedFoldersTrashed: (deletedFolderIds: readonly string[]) => void;
  onDeletedCurrentScope: (deletedFolderIds: readonly string[]) => Promise<void>;
};

export function useFolderDragDropHandlers({
  api,
  libraryId,
  assetScope,
  folders,
  setNotice,
  setError,
  setUiState,
  reloadCurrentContent,
  onManagedFoldersTrashed,
  onDeletedCurrentScope,
}: UseFolderDragDropHandlersParams) {
  const t = useT();
  const { locale } = useLocale();

  const folderFacts = useCallback(
    (): FolderDragFact[] =>
      folders.map((folder) => ({
        folderId: folder.folderId,
        parentFolderId: folder.parentFolderId,
      })),
    [folders],
  );

  const handleFoldersDroppedOnFolder = useCallback(
    (targetFolderId: string | null, draggedFolderIds: readonly string[]) => {
      if (!api || !libraryId) return;
      const resolution = resolveFolderOntoFolderDrop({
        targetFolderId,
        draggedFolderIds,
        folders: folderFacts(),
      });
      if (resolution.kind === 'reject') {
        if (resolution.reason === 'same-parent') {
          setNotice(t('toast.folderAlreadyThere'));
        } else if (resolution.reason === 'into-self') {
          setNotice(t('toast.folderMoveIntoSelf'));
        } else if (resolution.reason === 'into-descendant') {
          setNotice(t('toast.folderMoveIntoDescendant'));
        }
        return;
      }
      void (async () => {
        setUiState('loading');
        try {
          const result = await api.moveFolders({
            libraryId,
            folderIds: [...resolution.folderIds],
            targetParentFolderId: resolution.targetParentFolderId,
            conflictStrategy: 'keep-both',
          });
          if (!result.ok) throw new LibraryOperationError(result.error);
          if (result.value.skippedCount > 0) {
            setNotice(
              t('toast.folderMoveSkipped', {
                moved: result.value.movedCount,
                skipped: result.value.skippedCount,
              }),
              result.value.historyEntryId,
            );
          } else {
            setNotice(
              t('toast.folderMoveDone', { count: result.value.movedCount }),
              result.value.historyEntryId,
            );
          }
          await reloadCurrentContent();
        } catch (caught) {
          setError(toMessage(caught, t('toast.folderMoveFailed'), locale));
        } finally {
          setUiState('ready');
        }
      })();
    },
    [
      api,
      folderFacts,
      libraryId,
      locale,
      reloadCurrentContent,
      setError,
      setNotice,
      setUiState,
      t,
    ],
  );

  const handleFoldersDroppedOnTrash = useCallback(
    (draggedFolderIds: readonly string[]) => {
      if (!api || !libraryId) return;
      const folderIds = resolveDraggedFolderIdsForTrash(
        draggedFolderIds,
        folderFacts(),
      );
      if (folderIds.length === 0) return;

      void (async () => {
        setUiState('loading');
        try {
          let trashedAssets = 0;
          let trashedFolders = 0;
          let historyEntryId: string | undefined;
          if (folderIds.length === 1) {
            const result = await api.trashFolder({ libraryId, folderId: folderIds[0]! });
            if (!result.ok) throw new LibraryOperationError(result.error);
            trashedFolders = 1;
            trashedAssets = result.value.trashedAssetCount;
            historyEntryId = result.value.historyEntryId;
          } else {
            const result = await api.trashSelection({
              libraryId,
              assetIds: [],
              folderIds: [...folderIds],
            });
            if (!result.ok) throw new LibraryOperationError(result.error);
            trashedFolders = result.value.trashedFolderCount;
            trashedAssets = result.value.trashedAssetCount;
            historyEntryId = result.value.historyEntryId;
          }
          setNotice(
            t('toast.selectionTrashed', {
              folders: trashedFolders,
              assets: trashedAssets,
            }),
            historyEntryId,
          );
          // Update the navigation tree immediately. Scope detection below is
          // only responsible for deciding whether to navigate away; it must
          // not be the gate that removes rows from the sidebar after a
          // successful mutation.
          onManagedFoldersTrashed(folderIds);
          if (
            isBrowseScopeAffectedByFolderTrash(assetScope, folderIds, folders)
          ) {
            await onDeletedCurrentScope(folderIds);
          } else {
            await reloadCurrentContent();
          }
        } catch (caught) {
          setError(toMessage(caught, t('toast.folderTrashFailed'), locale));
        } finally {
          setUiState('ready');
        }
      })();
    },
    [
      api,
      assetScope,
      folderFacts,
      folders,
      libraryId,
      locale,
      onManagedFoldersTrashed,
      onDeletedCurrentScope,
      reloadCurrentContent,
      setError,
      setNotice,
      setUiState,
      t,
    ],
  );

  return { handleFoldersDroppedOnFolder, handleFoldersDroppedOnTrash };
}
