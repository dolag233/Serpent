import { useCallback, useRef, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { parseLinkedVirtualFolderId } from "../shared/linked-folder-tree";
import type { LibraryViewSessionToken } from "./library-view-session";
import {
  type FolderMutationProjection,
  type FolderMutationResult,
} from "./folder-mutation-projection";
import { lookupMessage, useLocale, useT } from "./i18n";
import { catalogs } from "./i18n/catalogs";
import { PUBLIC_ERROR_MESSAGES_ZH, toMessage } from "./error-utils";
import {
  changeInlineFolderEditValue,
  failInlineFolderEdit,
  markInlineFolderEditSubmitting,
  resolveInlineFolderEditCommit,
  startInlineFolderCreate,
  startInlineFolderRename,
  type InlineFolderEditState,
} from "./inline-folder-edit";

/**
 * REQ-FOLDER-007: React owner of the in-tree inline folder edit session. The
 * worker round-trip remains unchanged; successful mutations are projected by
 * the owning view before any background refresh is scheduled.
 */

export interface UseInlineFolderEditParams {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  setNotice: (message: string, historyEntryId?: string) => void;
  captureLibraryViewToken: (libraryId: string) => LibraryViewSessionToken | null;
  isLibraryViewCurrent: (token: LibraryViewSessionToken) => boolean;
  onMutationCommitted: (
    mutation: FolderMutationProjection,
    libraryViewToken: LibraryViewSessionToken,
  ) => void;
  /** Starts the ordinary browse/nav reconciliation after a paint boundary. */
  scheduleRefreshAfterMutation: (
    libraryViewToken: LibraryViewSessionToken,
  ) => Promise<void>;
  onPostCommitError?: (
    error: unknown,
    libraryViewToken: LibraryViewSessionToken,
  ) => void;
  /** Linked roots and virtual child ids use a separate physical-directory API. */
  isLinkedFolderId?: (folderId: string) => boolean;
  /** Return true only when the caller has also handled content reconciliation. */
  onRenameSuccess?: (
    result: FolderMutationResult,
    previousFolderId: string,
    libraryViewToken: LibraryViewSessionToken,
  ) => Promise<boolean> | boolean;
}

export interface UseInlineFolderEditResult {
  inlineFolderEdit: InlineFolderEditState | null;
  /** Sidebar 「+」 passes the selected folder (null = library root). */
  openInlineFolderCreate: (parentFolderId: string | null) => void;
  openInlineFolderRename: (folderId: string, currentName: string) => void;
  changeInlineFolderEdit: (value: string) => void;
  cancelInlineFolderEdit: () => void;
  /** Enter and blur share the same per-session single-submit guard. */
  commitInlineFolderEdit: (
    onCreateSuccess?: (
      folderId: string,
      parentFolderId: string | null,
    ) => void,
  ) => Promise<void>;
}

interface InlineFolderEditSession {
  readonly token: number;
  readonly libraryViewToken: LibraryViewSessionToken;
  readonly state: InlineFolderEditState;
}

export function useInlineFolderEdit({
  api,
  library,
  setNotice,
  captureLibraryViewToken,
  isLibraryViewCurrent,
  onMutationCommitted,
  scheduleRefreshAfterMutation,
  onPostCommitError,
  isLinkedFolderId,
  onRenameSuccess,
}: UseInlineFolderEditParams): UseInlineFolderEditResult {
  const t = useT();
  const { locale } = useLocale();
  const nextSessionToken = useRef(0);
  const committingTokens = useRef(new Set<number>());
  const [session, setSession] = useState<InlineFolderEditSession | null>(null);

  const isCurrentSessionView = useCallback(
    (value: InlineFolderEditSession) =>
      isLibraryViewCurrent(value.libraryViewToken)
      && library?.libraryId === value.libraryViewToken.libraryId,
    [isLibraryViewCurrent, library?.libraryId],
  );

  const visibleSession = session && isCurrentSessionView(session) ? session : null;
  const inlineFolderEdit = visibleSession?.state ?? null;

  const beginSession = useCallback((state: InlineFolderEditState) => {
    if (!library) return;
    const libraryViewToken = captureLibraryViewToken(library.libraryId);
    if (!libraryViewToken || !isLibraryViewCurrent(libraryViewToken)) return;
    nextSessionToken.current += 1;
    setSession({
      token: nextSessionToken.current,
      libraryViewToken,
      state,
    });
  }, [captureLibraryViewToken, isLibraryViewCurrent, library]);

  const openInlineFolderCreate = useCallback(
    (parentFolderId: string | null) => {
      beginSession(startInlineFolderCreate(parentFolderId, t("folderEdit.newFolder")));
    },
    [beginSession, t],
  );

  const openInlineFolderRename = useCallback(
    (folderId: string, currentName: string) => {
      beginSession(startInlineFolderRename(folderId, currentName));
    },
    [beginSession],
  );

  const changeInlineFolderEdit = useCallback((value: string) => {
    const token = visibleSession?.token;
    if (token === undefined) return;
    setSession((current) =>
      current?.token === token
        ? { ...current, state: changeInlineFolderEditValue(current.state, value) }
        : current,
    );
  }, [visibleSession?.token]);

  const cancelInlineFolderEdit = useCallback(() => {
    const token = visibleSession?.token;
    if (token === undefined) return;
    setSession((current) => current?.token === token ? null : current);
  }, [visibleSession?.token]);

  const reportPostCommitError = useCallback((
    error: unknown,
    libraryViewToken: LibraryViewSessionToken,
  ) => {
    if (!isLibraryViewCurrent(libraryViewToken)) return;
    try {
      onPostCommitError?.(error, libraryViewToken);
    } catch {
      // A reporting callback must not turn a committed write into a failed edit.
    }
  }, [isLibraryViewCurrent, onPostCommitError]);

  const commitInlineFolderEdit = useCallback(async (
    onCreateSuccess?: (
      folderId: string,
      parentFolderId: string | null,
    ) => void,
  ) => {
    const activeSession = visibleSession;
    if (!activeSession || !api || !library) return;
    const sessionToken = activeSession.token;
    const libraryViewToken = activeSession.libraryViewToken;
    if (
      committingTokens.current.has(sessionToken)
      || !isCurrentSessionView(activeSession)
    ) return;
    const currentViewToken = captureLibraryViewToken(library.libraryId);
    if (
      !currentViewToken
      || currentViewToken.libraryId !== libraryViewToken.libraryId
      || currentViewToken.generation !== libraryViewToken.generation
    ) return;

    const resolution = resolveInlineFolderEditCommit(activeSession.state);
    if (resolution.action === "keep-editing") return;
    if (resolution.action === "cancel") {
      setSession((current) => current?.token === sessionToken ? null : current);
      return;
    }

    const editState = activeSession.state;
    const failureFallback = editState.kind === "create"
      ? t("folderEdit.createFailed")
      : t("folderEdit.renameFailed");
    const updateSession = (update: (state: InlineFolderEditState) => InlineFolderEditState) => {
      setSession((current) =>
        current?.token === sessionToken
          ? { ...current, state: update(current.state) }
          : current,
      );
    };
    const settleWriteFailure = (message: string) => {
      if (!isLibraryViewCurrent(libraryViewToken)) return;
      updateSession((current) => failInlineFolderEdit(current, message));
    };

    committingTokens.current.add(sessionToken);
    updateSession((current) => markInlineFolderEditSubmitting(current));
    try {
      const createParent = editState.kind === "create" ? editState.parentFolderId : null;
      const createParentVirtual = createParent ? parseLinkedVirtualFolderId(createParent) : null;
      const createParentIsLinked = Boolean(
        createParent
        && (createParentVirtual || isLinkedFolderId?.(createParent)),
      );
      const renameVirtual = editState.kind === "rename"
        ? parseLinkedVirtualFolderId(editState.folderId)
        : null;
      const renameIsLinked = Boolean(
        editState.kind === "rename"
        && (renameVirtual || isLinkedFolderId?.(editState.folderId)),
      );
      const result = editState.kind === "create"
        ? createParentIsLinked
          ? await api.createLinkedFolderDirectory({
              libraryId: libraryViewToken.libraryId,
              linkedFolderId: createParentVirtual?.linkedFolderId ?? createParent!,
              relativePath: createParentVirtual?.relativePath ?? "",
              name: resolution.name,
            })
          : await api.createFolder({
              libraryId: libraryViewToken.libraryId,
              parentFolderId: editState.parentFolderId ?? undefined,
              name: resolution.name,
            })
        : renameIsLinked
          ? await api.renameLinkedFolderDirectory({
              libraryId: libraryViewToken.libraryId,
              linkedFolderId: renameVirtual?.linkedFolderId ?? editState.folderId,
              relativePath: renameVirtual?.relativePath ?? "",
              newName: resolution.name,
            })
          : await api.renameFolder({
              libraryId: libraryViewToken.libraryId,
              folderId: editState.folderId,
              newName: resolution.name,
            });

      if (!result.ok) {
        if (!isLibraryViewCurrent(libraryViewToken)) return;
        const codeMessage =
          lookupMessage(catalogs[locale], `error.code.${result.error.code}`)
          ?? PUBLIC_ERROR_MESSAGES_ZH[result.error.code];
        settleWriteFailure(
          codeMessage ?? toMessage(result.error, failureFallback, locale),
        );
        return;
      }

      if (!isLibraryViewCurrent(libraryViewToken)) return;
      const mutation: FolderMutationProjection = {
        kind: editState.kind,
        folder: result.value,
        ...(editState.kind === "rename"
          ? { previousFolderId: editState.folderId }
          : {}),
      };

      setSession((current) => current?.token === sessionToken ? null : current);
      try {
        onMutationCommitted(mutation, libraryViewToken);
      } catch (caught) {
        reportPostCommitError(caught, libraryViewToken);
      }
      if (editState.kind === "create") {
        try {
          onCreateSuccess?.(result.value.folderId, editState.parentFolderId);
        } catch (caught) {
          reportPostCommitError(caught, libraryViewToken);
        }
      }
      try {
        setNotice(
          editState.kind === "create"
            ? t("folderEdit.created", { name: result.value.name })
            : t("folderEdit.renamed", { name: result.value.name }),
          "historyEntryId" in result.value ? result.value.historyEntryId : undefined,
        );
      } catch (caught) {
        reportPostCommitError(caught, libraryViewToken);
      }

      void (async () => {
        let alreadyNavigated = false;
        if (editState.kind === "rename") {
          try {
            alreadyNavigated = await onRenameSuccess?.(
              result.value,
              editState.folderId,
              libraryViewToken,
            ) ?? false;
          } catch (caught) {
            reportPostCommitError(caught, libraryViewToken);
          }
        }
        if (alreadyNavigated || !isLibraryViewCurrent(libraryViewToken)) return;
        try {
          await scheduleRefreshAfterMutation(libraryViewToken);
        } catch (caught) {
          reportPostCommitError(caught, libraryViewToken);
        }
      })();
    } catch (caught) {
      if (isLibraryViewCurrent(libraryViewToken)) {
        settleWriteFailure(toMessage(caught, failureFallback, locale));
      }
    } finally {
      committingTokens.current.delete(sessionToken);
    }
  }, [
    api,
    captureLibraryViewToken,
    isCurrentSessionView,
    isLibraryViewCurrent,
    isLinkedFolderId,
    library,
    locale,
    onMutationCommitted,
    onRenameSuccess,
    reportPostCommitError,
    scheduleRefreshAfterMutation,
    t,
    visibleSession,
    setNotice,
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
