import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { LinkedFolderSummary, ManagedFolderSummary } from "../shared/asset-types";
import { deferNavigationHydration } from "./browse/defer-navigation-hydration";
import {
  type FolderMutationProjectionGate,
  projectFolderMutation,
  rewriteLinkedFolderIdPrefix,
  type FolderMutationProjection,
  type FolderMutationResult,
} from "./folder-mutation-projection";
import type { LibraryViewSessionToken } from "./library-view-session";
import type { WorkspaceNavHistory } from "./workspace-nav-history";

type Setter<T> = Dispatch<SetStateAction<T>>;

interface FolderMutationBridgeParams {
  libraryRef: RefObject<{ libraryId: string } | null>;
  isLibraryViewCurrent: (token: LibraryViewSessionToken) => boolean;
  projectionGate: FolderMutationProjectionGate;
  refreshAbortRef: RefObject<AbortController | null>;
  reloadRef: RefObject<() => Promise<void>>;
  scopeRef: RefObject<string>;
  historyRef: RefObject<WorkspaceNavHistory>;
  onScopeRemapped: (scope: string) => void;
  onHistoryChanged: () => void;
  setFolders: Setter<ManagedFolderSummary[]>;
  setLinkedFolders: Setter<LinkedFolderSummary[]>;
  setSelectedFolderIds: Setter<string[]>;
  setFilteredCountRefreshToken: Setter<number>;
}

/** Publish committed identity first; read-model failures cannot undo a rename. */
export function useFolderMutationBridge({
  libraryRef, isLibraryViewCurrent, projectionGate, refreshAbortRef, reloadRef,
  scopeRef, historyRef, onScopeRemapped, onHistoryChanged,
  setFolders, setLinkedFolders, setSelectedFolderIds, setFilteredCountRefreshToken,
}: FolderMutationBridgeParams) {
  const isCurrent = useCallback((token: LibraryViewSessionToken) =>
    isLibraryViewCurrent(token) && libraryRef.current?.libraryId === token.libraryId,
  [isLibraryViewCurrent, libraryRef]);

  const scheduleRefreshAfterMutation = useCallback(async (token: LibraryViewSessionToken) => {
    if (!isCurrent(token)) return;
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    try {
      await deferNavigationHydration(async () => {
        if (controller.signal.aborted || !isCurrent(token)) return;
        await reloadRef.current();
      }, { signal: controller.signal, immediate: true });
    } finally {
      if (refreshAbortRef.current === controller) refreshAbortRef.current = null;
    }
  }, [isCurrent, refreshAbortRef, reloadRef]);

  const onMutationCommitted = useCallback((
    mutation: FolderMutationProjection, token: LibraryViewSessionToken,
  ) => {
    if (!isCurrent(token) || !projectionGate.noteMutation(token)) return;
    setFolders((current) => {
      const projected = projectFolderMutation({ folders: current, linkedFolders: [] }, mutation)?.folders;
      return !projected || projected === current ? current : [...projected];
    });
    setLinkedFolders((current) => {
      const projected = projectFolderMutation({ folders: [], linkedFolders: current }, mutation)?.linkedFolders;
      return !projected || projected === current ? current : [...projected];
    });
    setFilteredCountRefreshToken((current) => current + 1);
    if (mutation.kind === "rename" && "linkedFolderId" in mutation.folder) {
      setSelectedFolderIds((current) => current.map((id) => rewriteLinkedFolderIdPrefix(
        id, mutation.previousFolderId ?? "", mutation.folder.folderId,
      )));
    }
  }, [isCurrent, projectionGate, setFolders, setLinkedFolders, setSelectedFolderIds, setFilteredCountRefreshToken]);

  const onRenameSuccess = useCallback((
    result: FolderMutationResult, previousFolderId: string, token: LibraryViewSessionToken,
  ): boolean => {
    if (!("linkedFolderId" in result) || !isCurrent(token)) return false;
    const nextScope = rewriteLinkedFolderIdPrefix(scopeRef.current, previousFolderId, result.folderId);
    if (nextScope !== scopeRef.current) {
      // This is the same physical directory, with a committed new virtual id.
      // Do not make identity depend on a second browse succeeding.
      scopeRef.current = nextScope;
      onScopeRemapped(nextScope);
    }
    const location = historyRef.current.current;
    if (location.kind === "folder") {
      const nextId = rewriteLinkedFolderIdPrefix(location.folderId, previousFolderId, result.folderId);
      if (nextId !== location.folderId) {
        historyRef.current.replaceCurrent({ kind: "folder", folderId: nextId });
        onHistoryChanged();
      }
    }
    // Always reconcile after paint, including when the active scope was renamed.
    return false;
  }, [historyRef, isCurrent, onHistoryChanged, onScopeRemapped, scopeRef]);

  return { onMutationCommitted, scheduleRefreshAfterMutation, onRenameSuccess };
}
