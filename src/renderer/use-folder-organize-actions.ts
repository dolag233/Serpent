import { useCallback } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import type { ImportConflictPlan, ImportCompletion } from "../shared/protocol/responses";
import { LibraryOperationError, toMessage } from "./error-utils";
import { useT } from "./i18n";
import type { AppLocale } from "./i18n/types";

export type UseFolderOrganizeActionsParams = {
  api: SerpentLibraryApi | null;
  libraryId: string | null;
  locale: AppLocale;
  setNotice: (message: string) => void;
  setError: (message: string | null) => void;
  setUiState: (state: "ready" | "loading") => void;
  reloadCurrentContent: () => Promise<void>;
  /**
   * When paste returns a conflict plan, hand it to the existing import UI.
   * Returns true if the caller will finish the import (conflicts dialog).
   */
  onPasteConflict?: (plan: ImportConflictPlan) => void;
  onPasteCompleted?: (completion: ImportCompletion) => void | Promise<void>;
};

/**
 * Folder copy-aside actions: paste (OS clipboard import), clone, move confirm
 * helpers used by REQ-MENU-005 / Serpent-vgp. OS copy itself lives in
 * use-shell-file-actions (Main clipboard write).
 */
export function useFolderOrganizeActions({
  api,
  libraryId,
  locale,
  setNotice,
  setError,
  setUiState,
  reloadCurrentContent,
  onPasteConflict,
  onPasteCompleted,
}: UseFolderOrganizeActionsParams) {
  const t = useT();

  const pasteIntoFolder = useCallback(
    async (folderId: string) => {
      if (!api || !libraryId) return;
      setUiState("loading");
      try {
        const result = await api.pasteIntoFolder({
          libraryId,
          folderId,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        if ("importId" in result.value) {
          onPasteConflict?.(result.value);
          return;
        }
        await onPasteCompleted?.(result.value);
        setNotice(t("toast.folderPasteDone"));
        await reloadCurrentContent();
      } catch (caught) {
        setError(toMessage(caught, t("toast.folderPasteFailed"), locale));
      } finally {
        setUiState("ready");
      }
    },
    [
      api,
      libraryId,
      locale,
      onPasteCompleted,
      onPasteConflict,
      reloadCurrentContent,
      setError,
      setNotice,
      setUiState,
      t,
    ],
  );

  const cloneFolder = useCallback(
    async (folderId: string) => {
      if (!api || !libraryId) return;
      setUiState("loading");
      try {
        const result = await api.cloneFolder({ libraryId, folderId });
        if (!result.ok) throw new LibraryOperationError(result.error);
        setNotice(
          t("toast.folderCloneDone", { name: result.value.folder.name }),
        );
        await reloadCurrentContent();
      } catch (caught) {
        setError(toMessage(caught, t("toast.folderCloneFailed"), locale));
      } finally {
        setUiState("ready");
      }
    },
    [
      api,
      libraryId,
      locale,
      reloadCurrentContent,
      setError,
      setNotice,
      setUiState,
      t,
    ],
  );

  const confirmMoveFolders = useCallback(
    async (input: {
      folderIds: string[];
      targetParentFolderId: string | null;
      conflictStrategy: "keep-both" | "skip";
    }) => {
      if (!api || !libraryId) return;
      if (input.folderIds.length === 0) {
        setNotice(t("toast.folderMoveNothing"));
        return;
      }
      setUiState("loading");
      try {
        const result = await api.moveFolders({
          libraryId,
          folderIds: input.folderIds,
          targetParentFolderId: input.targetParentFolderId,
          conflictStrategy: input.conflictStrategy,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        if (result.value.skippedCount > 0) {
          setNotice(
            t("toast.folderMoveSkipped", {
              moved: result.value.movedCount,
              skipped: result.value.skippedCount,
            }),
          );
        } else {
          setNotice(
            t("toast.folderMoveDone", { count: result.value.movedCount }),
          );
        }
        await reloadCurrentContent();
      } catch (caught) {
        setError(toMessage(caught, t("toast.folderMoveFailed"), locale));
      } finally {
        setUiState("ready");
      }
    },
    [
      api,
      libraryId,
      locale,
      reloadCurrentContent,
      setError,
      setNotice,
      setUiState,
      t,
    ],
  );

  return { pasteIntoFolder, cloneFolder, confirmMoveFolders };
}
