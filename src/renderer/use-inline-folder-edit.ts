import { useCallback, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { lookupMessage, useLocale, useT } from "./i18n";
import { catalogs } from "./i18n/catalogs";
import { PUBLIC_ERROR_MESSAGES_ZH, toMessage } from "./error-utils";
import {
  changeInlineFolderEditValue,
  failInlineFolderEdit,
  isSameInlineFolderEditSession,
  markInlineFolderEditSubmitting,
  resolveInlineFolderEditCommit,
  startInlineFolderCreate,
  startInlineFolderRename,
  type InlineFolderEditState,
} from "./inline-folder-edit";

/**
 * REQ-FOLDER-007: React owner of the in-tree inline folder edit session
 * (新建子文件夹 / 重命名… / 侧栏「+」), replacing the former create/rename
 * dialogs and their App.tsx dialog-state wiring (acceptance rule 8 — App only
 * wires menu entries and passes the session down to NavigationSidebar). The
 * state machine itself lives in inline-folder-edit.ts; this hook adds the
 * worker round-trip (command chain unchanged: folder.create / folder.rename),
 * typed error mapping through the shared error catalog, and
 * the notice + refresh convention after a successful operation.
 *
 * Unlike the dialogs, inline editing does not raise the global loading gate:
 * the per-session `submitting` flag blocks duplicate submits, and freezing the
 * whole shell would defeat the lightweight interaction. Keyboard isolation is
 * already guaranteed by the existing global handlers, which all bail out when
 * the event target is an editable element.
 */

export interface UseInlineFolderEditParams {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  setNotice: (message: string) => void;
  reloadCurrentContent: () => Promise<void>;
}

export interface UseInlineFolderEditResult {
  inlineFolderEdit: InlineFolderEditState | null;
  /** Sidebar 「+」 passes the selected folder (null = library root). */
  openInlineFolderCreate: (parentFolderId: string | null) => void;
  openInlineFolderRename: (folderId: string, currentName: string) => void;
  changeInlineFolderEdit: (value: string) => void;
  cancelInlineFolderEdit: () => void;
  /**
   * Enter and blur both route here; the state machine decides the outcome.
   * The optional callback runs only after a create reaches the Worker and
   * succeeds, before the inline row is removed.
   */
  commitInlineFolderEdit: (
    onCreateSuccess?: (parentFolderId: string | null) => void,
  ) => Promise<void>;
}

export function useInlineFolderEdit({
  api,
  library,
  setNotice,
  reloadCurrentContent,
}: UseInlineFolderEditParams): UseInlineFolderEditResult {
  const t = useT();
  const { locale } = useLocale();
  const [inlineFolderEdit, setInlineFolderEdit] =
    useState<InlineFolderEditState | null>(null);

  const openInlineFolderCreate = useCallback(
    (parentFolderId: string | null) => {
      setInlineFolderEdit(
        startInlineFolderCreate(parentFolderId, t("folderEdit.newFolder")),
      );
    },
    [t],
  );

  const openInlineFolderRename = useCallback(
    (folderId: string, currentName: string) => {
      setInlineFolderEdit(startInlineFolderRename(folderId, currentName));
    },
    [],
  );

  const changeInlineFolderEdit = useCallback((value: string) => {
    setInlineFolderEdit((current) =>
      current ? changeInlineFolderEditValue(current, value) : current,
    );
  }, []);

  const cancelInlineFolderEdit = useCallback(() => {
    setInlineFolderEdit(null);
  }, []);

  const commitInlineFolderEdit = useCallback(async (
    onCreateSuccess?: (parentFolderId: string | null) => void,
  ) => {
    const session = inlineFolderEdit;
    if (!session) return;
    const resolution = resolveInlineFolderEditCommit(session);
    if (resolution.action === "keep-editing") return;
    if (resolution.action === "cancel") {
      setInlineFolderEdit(null);
      return;
    }
    if (!api || !library) return;
    setInlineFolderEdit((current) =>
      current && isSameInlineFolderEditSession(current, session)
        ? markInlineFolderEditSubmitting(current)
        : current,
    );
    const failureFallback =
      session.kind === "create"
        ? t("folderEdit.createFailed")
        : t("folderEdit.renameFailed");
    // Settles the session this commit started from; a newer session opened
    // while the request was in flight is left untouched (the tree is
    // non-modal, unlike the former dialogs).
    const settleFailure = (message: string) => {
      setInlineFolderEdit((current) =>
        current && isSameInlineFolderEditSession(current, session)
          ? failInlineFolderEdit(current, message)
          : current,
      );
    };
    try {
      const result =
        session.kind === "create"
          ? await api.createFolder({
              libraryId: library.libraryId,
              parentFolderId: session.parentFolderId ?? undefined,
              name: resolution.name,
            })
          : await api.renameFolder({
              libraryId: library.libraryId,
              folderId: session.folderId,
              newName: resolution.name,
            });
      if (!result.ok) {
        // Typed failures (invalid name, name conflict) surface inline so the
        // user can fix the name and retry; the row deliberately stays open.
        // Prefer the active-locale catalog, then the zh-CN table.
        const codeMessage =
          lookupMessage(catalogs[locale], `error.code.${result.error.code}`) ??
          PUBLIC_ERROR_MESSAGES_ZH[result.error.code];
        settleFailure(
          codeMessage ?? toMessage(result.error, failureFallback, locale),
        );
        return;
      }
      if (session.kind === "create") {
        onCreateSuccess?.(session.parentFolderId);
      }
      setInlineFolderEdit((current) =>
        current && isSameInlineFolderEditSession(current, session)
          ? null
          : current,
      );
      setNotice(
        session.kind === "create"
          ? t("folderEdit.created", { name: result.value.name })
          : t("folderEdit.renamed", { name: result.value.name }),
      );
      // A rename keeps the folderId, so the current selection survives the
      // refresh; a create lands under the already-selected parent. Neither
      // needs a re-select.
      await reloadCurrentContent();
    } catch (caught) {
      settleFailure(toMessage(caught, failureFallback, locale));
    }
  }, [
    api,
    library,
    inlineFolderEdit,
    locale,
    reloadCurrentContent,
    setNotice,
    t,
  ]);

  return {
    inlineFolderEdit,
    openInlineFolderCreate,
    openInlineFolderRename,
    changeInlineFolderEdit,
    cancelInlineFolderEdit,
    commitInlineFolderEdit,
  };
}
