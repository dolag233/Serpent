/**
 * Workspace browser-session restore / persist / focus (Serpent-uye).
 * Keeps App.tsx free of the session-scope apply + selection recovery body.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";

import type { AssetSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import {
  buildBrowserSessionFromBrowseState,
  readBrowserSession,
  writeBrowserSession,
} from "./browser-session";
import { LibraryOperationError, toMessage } from "./error-utils";
import {
  isFolderRecursiveEnabled,
  loadFolderRecursivePreferences,
} from "./folder-recursive-preferences";
import { useLocale, useT } from "./i18n";
import {
  applyStoredBrowserSession,
  type LoadContentForRestore,
} from "./restore-browser-session";
import type {
  BrowsePageDefinition,
  BrowseFirstPage,
} from "./use-browse-pagination";
import type { WorkspaceNavHistory, WorkspaceNavLocation } from "./workspace-nav-history";

export type UseBrowserSessionRestoreArgs = {
  api: SerpentLibraryApi | null;
  loadContent: LoadContentForRestore;
  collectionRecursiveRef: MutableRefObject<boolean>;
  folderRecursiveRef: MutableRefObject<boolean>;
  setFolderRecursive: (enabled: boolean) => void;
  setLibrary: Dispatch<SetStateAction<RendererLibrarySummary | null>>;
  setShowTrash: Dispatch<SetStateAction<boolean>>;
  setTrashedAssets: Dispatch<SetStateAction<AssetSummary[]>>;
  setAssetScope: Dispatch<SetStateAction<"all" | "root" | string>>;
  setActiveTagId: Dispatch<SetStateAction<string | null>>;
  setTagFilter: Dispatch<SetStateAction<string>>;
  setActiveCollectionId: Dispatch<SetStateAction<string | null>>;
  setActiveSmartCollectionId: Dispatch<SetStateAction<string | null>>;
  setAssets: Dispatch<SetStateAction<AssetSummary[]>>;
  setSearchTotal: Dispatch<SetStateAction<number | null>>;
  /** Serpent-ws4k: register the restored scope for paginated appends. */
  beginBrowsePage: (definition: BrowsePageDefinition, firstPage: BrowseFirstPage) => void;
  setSelectedAssetId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedAssetIds: Dispatch<SetStateAction<string[]>>;
  setAssetSelectionAnchor: (assetId: string | null) => void;
  /** Blocks the persistence effect while the saved session is being hydrated. */
  setBrowserSessionReady: (ready: boolean) => void;
  pendingRestoredFocusRef: MutableRefObject<string | null>;
  navHistoryRef: MutableRefObject<WorkspaceNavHistory>;
  setNavHistoryUi: Dispatch<
    SetStateAction<{ canBack: boolean; canForward: boolean }>
  >;
  setUiState: Dispatch<
    SetStateAction<
      | "booting"
      | "idle"
      | "creating"
      | "opening"
      | "closing"
      | "loading"
      | "importing"
      | "ready"
    >
  >;
  setError: (message: string | null) => void;
};

export function useBrowserSessionRestore(
  args: UseBrowserSessionRestoreArgs,
): void {
  const t = useT();
  const { locale } = useLocale();
  // React StrictMode intentionally mounts effects twice in development. The
  // restore flow owns a sequence of async list/load/state operations, so two
  // concurrent runs can race and let the second run overwrite the restored
  // selection (or the browser session) with its initial empty state.
  const restoreStartedRef = useRef(false);
  const {
    api,
    loadContent,
    collectionRecursiveRef,
    folderRecursiveRef,
    setFolderRecursive,
    setLibrary,
    setShowTrash,
    setTrashedAssets,
    setAssetScope,
    setActiveTagId,
    setTagFilter,
    setActiveCollectionId,
    setActiveSmartCollectionId,
    setAssets,
    setSearchTotal,
    beginBrowsePage,
    setSelectedAssetId,
    setSelectedAssetIds,
    setAssetSelectionAnchor,
    setBrowserSessionReady,
    pendingRestoredFocusRef,
    navHistoryRef,
    setNavHistoryUi,
    setUiState,
    setError,
  } = args;

  const restore = useCallback(async () => {
    setBrowserSessionReady(false);
    if (!api) {
      setError(t("toast.bridgeUnavailable"));
      setUiState("idle");
      setBrowserSessionReady(true);
      return;
    }
    let activeLibrary: RendererLibrarySummary | null = null;
    try {
      const result = await api.listOpen();
      if (!result.ok) throw new LibraryOperationError(result.error);
      activeLibrary = result.value[0] ?? null;
      setLibrary(activeLibrary);
      setShowTrash(false);
      setTrashedAssets([]);
      if (activeLibrary) {
        const restoredItems = (await loadContent(activeLibrary, "all")) ?? [];
        const session = readBrowserSession(activeLibrary.libraryId);
        let restoredLocation: WorkspaceNavLocation = { kind: "all" };
        if (session) {
          try {
            const applied = await applyStoredBrowserSession({
              api,
              library: activeLibrary,
              session,
              initialItems: restoredItems,
              collectionRecursive: collectionRecursiveRef.current,
              isFolderRecursiveEnabled: (libraryId, folderId) =>
                isFolderRecursiveEnabled(
                  loadFolderRecursivePreferences(),
                  libraryId,
                  folderId,
                ),
              loadContent,
              setShowTrash,
              setAssetScope,
              setFolderRecursive,
              folderRecursiveRef,
              setActiveTagId,
              setTagFilter,
              setActiveCollectionId,
              setActiveSmartCollectionId,
              setAssets,
              setTrashedAssets,
              setSearchTotal,
              beginBrowsePage,
            });
            restoredLocation = applied.restoredLocation;
            if (applied.restoredAsset) {
              setSelectedAssetId(applied.restoredAsset.assetId);
              setSelectedAssetIds([applied.restoredAsset.assetId]);
              setAssetSelectionAnchor(applied.restoredAsset.assetId);
              pendingRestoredFocusRef.current = applied.restoredAsset.assetId;
            }
          } catch (sessionError) {
            console.warn(
              "Saved browser session could not be restored.",
              sessionError,
            );
            setShowTrash(false);
            setAssetScope("all");
            setActiveTagId(null);
            setActiveCollectionId(null);
            setActiveSmartCollectionId(null);
            restoredLocation = { kind: "all" };
            await loadContent(activeLibrary, "all");
          }
        }
        navHistoryRef.current.clear(restoredLocation);
        setNavHistoryUi({ canBack: false, canForward: false });
      } else {
        navHistoryRef.current.clear({ kind: "all" });
        setNavHistoryUi({ canBack: false, canForward: false });
      }
      setUiState(activeLibrary ? "ready" : "idle");
    } catch (caught) {
      setError(toMessage(caught, t("toast.workspaceRestoreFailed"), locale));
      setUiState(activeLibrary ? "ready" : "idle");
    } finally {
      // Do not let useBrowserSessionPersist observe the transient empty
      // selection between setLibrary() and applyStoredBrowserSession().
      setBrowserSessionReady(true);
    }
  }, [
    api,
    beginBrowsePage,
    collectionRecursiveRef,
    folderRecursiveRef,
    loadContent,
    locale,
    navHistoryRef,
    pendingRestoredFocusRef,
    setActiveCollectionId,
    setActiveSmartCollectionId,
    setActiveTagId,
    setAssetScope,
    setAssetSelectionAnchor,
    setBrowserSessionReady,
    setAssets,
    setError,
    setFolderRecursive,
    setLibrary,
    setNavHistoryUi,
    setSearchTotal,
    setSelectedAssetId,
    setSelectedAssetIds,
    setShowTrash,
    setTagFilter,
    setTrashedAssets,
    setUiState,
    t,
  ]);

  useEffect(() => {
    // The preload bridge can be unavailable for the first render. Leave the
    // guard unset in that case so the effect can retry when the bridge arrives.
    if (!api || restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    void Promise.resolve().then(restore);
  }, [api, restore]);
}

export type UseBrowserSessionPersistArgs = {
  library: RendererLibrarySummary | null;
  /** False while the saved scope/selection is being hydrated on startup. */
  browserSessionReady: boolean;
  selectedAsset: AssetSummary | undefined;
  showTrash: boolean;
  activeTagId: string | null;
  tags: readonly { tagId: string; name: string }[];
  activeCollectionId: string | null;
  activeSmartCollectionId: string | null;
  assetScope: "all" | "root" | string;
};

export function useBrowserSessionPersist(
  args: UseBrowserSessionPersistArgs,
): void {
  const {
    library,
    browserSessionReady,
    selectedAsset,
    showTrash,
    activeTagId,
    tags,
    activeCollectionId,
    activeSmartCollectionId,
    assetScope,
  } = args;

  useEffect(() => {
    if (!library || !browserSessionReady) return;
    const session = buildBrowserSessionFromBrowseState({
      showTrash,
      activeTagId,
      activeTagName: tags.find((tag) => tag.tagId === activeTagId)?.name,
      activeCollectionId,
      activeSmartCollectionId,
      assetScope,
      // Persist scope even with an empty selection so relaunch restores the
      // last folder/collection instead of falling back to "all assets".
      selectedAssetId: selectedAsset?.assetId ?? "",
      selectedAssetName: selectedAsset?.displayName ?? "",
    });
    writeBrowserSession(library.libraryId, session);
  }, [
    activeCollectionId,
    activeSmartCollectionId,
    browserSessionReady,
    activeTagId,
    assetScope,
    library,
    selectedAsset,
    showTrash,
    tags,
  ]);
}

export type UsePendingRestoredAssetFocusArgs = {
  pendingRestoredFocusRef: MutableRefObject<string | null>;
  workspaceCanvasRef: RefObject<HTMLElement | null>;
  assets: readonly AssetSummary[];
  trashedAssets: readonly AssetSummary[];
  selectedAssetId: string | undefined;
};

/** After restore, scroll/focus the card once it mounts in the canvas. */
export function usePendingRestoredAssetFocus(
  args: UsePendingRestoredAssetFocusArgs,
): void {
  const {
    pendingRestoredFocusRef,
    workspaceCanvasRef,
    assets,
    trashedAssets,
    selectedAssetId,
  } = args;

  useEffect(() => {
    const assetId = pendingRestoredFocusRef.current;
    if (!assetId) return;
    const frame = window.requestAnimationFrame(() => {
      // A context menu owns focus while it is open. An import reveal may have
      // queued this card focus before the user opened the menu; applying it
      // now would close the menu's focus invariant a few frames later. Treat
      // the explicit menu interaction as consuming the pending reveal focus.
      const openMenu = document.querySelector<HTMLElement>('[role="menu"]');
      if (openMenu && openMenu.getBoundingClientRect().width > 0) {
        pendingRestoredFocusRef.current = null;
        return;
      }
      // The reveal focus is a best-effort default for an idle canvas, not a
      // mandate that can override a later user action. In particular, the
      // sidebar's inline folder editor focuses an input immediately after it
      // mounts; moving focus to the card here would blur that input and its
      // blur handler would submit/cancel the edit unexpectedly.
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        activeElement !== document.documentElement
      ) {
        pendingRestoredFocusRef.current = null;
        return;
      }
      const card = Array.from(
        workspaceCanvasRef.current?.querySelectorAll<HTMLElement>(
          "[data-asset-id]",
        ) ?? [],
      ).find((candidate) => candidate.dataset.assetId === assetId);
      if (!card) return;
      card.scrollIntoView({ block: "center", inline: "center" });
      card.focus({ preventScroll: true });
      pendingRestoredFocusRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    assets,
    pendingRestoredFocusRef,
    selectedAssetId,
    trashedAssets,
    workspaceCanvasRef,
  ]);
}
