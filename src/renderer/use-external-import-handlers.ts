import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MutableRefObject,
} from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import type {
  ImportCompletion,
  ImportConflictPlan,
  ImageSequenceImportOffer,
  RendererLibrarySummary,
} from "../shared/protocol/responses";
import {
  isImageSequenceImportOffer,
  isImportConflictPlan,
} from "../shared/import-outcome";
import { LibraryOperationError, toMessage, shouldSuppressClipboardPasteFeedback } from "./error-utils";
import {
  externalImportPayload,
  supportsExternalImportTransfer,
} from "./external-import-transfer";
import {
  parseManagedFolderDrag,
  supportsManagedFolderDrag,
} from "./folder-drag-drop";
import {
  parseManagedAssetDrag,
  resolveDragDropMode,
  resolveManagedDropEffect,
  supportsManagedAssetDrag,
  type DragDropMode,
} from "./asset-drag-drop";
import { useLocale, useT } from "./i18n";
import { importSummaryMessage } from "./import-summary";

export type UseExternalImportHandlersParams = {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  busy: boolean;
  activeCollectionId: string | null;
  /** When set, external drop highlight/import is suppressed (viewer open). */
  previewBlocksDrop: boolean;
  managedImportTargetFolderIdRef: MutableRefObject<string | undefined>;
  reloadCurrentContent: () => Promise<void>;
  reloadCurrentContentRef: MutableRefObject<() => Promise<void>>;
  /** After a successful import without conflicts: reveal/select imported assets. */
  onImportCompleted: (completion: ImportCompletion) => void | Promise<void>;
  setUiState: (state: "loading" | "importing" | "ready") => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  setConflicts: (plan: ImportConflictPlan | null) => void;
  setImageSequenceImportOffer: (offer: ImageSequenceImportOffer | null) => void;
  onFoldersDroppedOnFolder?: (
    targetFolderId: string,
    folderIds: readonly string[],
  ) => void;
  /** Renderer-only fallback for HTML5 drags; native drags resolve File handles. */
  getManagedAssetDragIds?: () => readonly string[] | null;
  onResolveManagedAssetDrop?: (files: File[]) => Promise<string[]>;
  onAssetsDroppedOnFolder?: (
    targetFolderId: string,
    assetIds: string[],
    mode: DragDropMode,
  ) => void;
};

/**
 * Desktop drop + clipboard paste import executors and canvas drop chrome
 * (Serpent-uye). Dialog/file-picker import stays in App.
 */
export function useExternalImportHandlers({
  api,
  library,
  busy,
  activeCollectionId,
  previewBlocksDrop,
  managedImportTargetFolderIdRef,
  reloadCurrentContent,
  reloadCurrentContentRef,
  onImportCompleted,
  setUiState,
  setError,
  setNotice,
  setConflicts,
  setImageSequenceImportOffer,
  onFoldersDroppedOnFolder,
  getManagedAssetDragIds,
  onResolveManagedAssetDrop,
  onAssetsDroppedOnFolder,
}: UseExternalImportHandlersParams) {
  const t = useT();
  const { locale } = useLocale();
  const [externalDropActive, setExternalDropActive] = useState(false);
  const [folderCardDropTarget, setFolderCardDropTarget] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!folderCardDropTarget) return;
    const clear = () => setFolderCardDropTarget(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [folderCardDropTarget]);
  const externalDragDepth = useRef(0);

  const applyDesktopImportResult = useCallback(
    async (
      result: Awaited<ReturnType<SerpentLibraryApi["importDropped"]>>,
    ): Promise<void> => {
      if (!result.ok) {
        if (result.error.code === "IMPORT_COLLECTION_ASSIGN_FAILED") {
          await reloadCurrentContent();
        }
        throw new LibraryOperationError(result.error);
      }
      if (isImportConflictPlan(result.value)) {
        setConflicts(result.value);
        return;
      }
      if (isImageSequenceImportOffer(result.value)) {
        setImageSequenceImportOffer(result.value);
        return;
      }
      setNotice(importSummaryMessage(result.value, locale));
      await onImportCompleted(result.value);
    },
    [
      locale,
      onImportCompleted,
      reloadCurrentContent,
      setConflicts,
      setImageSequenceImportOffer,
      setNotice,
    ],
  );

  const importDroppedFiles = useCallback(
    async (
      files: File[],
      targetFolderId: string | null | undefined = managedImportTargetFolderIdRef.current,
      targetCollectionId = activeCollectionId ?? undefined,
      webPayload?: { html: string; uriList: string },
    ) => {
      if (!api || !library || (files.length === 0 && !webPayload) || busy) return;
      setUiState("importing");
      setError(null);
      setNotice(null);
      try {
        const result = await api.importDropped({
          libraryId: library.libraryId,
          targetFolderId: targetFolderId ?? undefined,
          targetCollectionId,
          files,
          html: webPayload?.html,
          uriList: webPayload?.uriList,
        });
        await applyDesktopImportResult(result);
      } catch (caught) {
        if (!shouldSuppressClipboardPasteFeedback(caught)) {
          setError(toMessage(caught, t("toast.dropImportFailed"), locale));
        }
      } finally {
        setUiState("ready");
        setExternalDropActive(false);
        externalDragDepth.current = 0;
      }
    },
    [
      activeCollectionId,
      api,
      applyDesktopImportResult,
      busy,
      library,
      locale,
      managedImportTargetFolderIdRef,
      setError,
      setNotice,
      setUiState,
      t,
    ],
  );

  const pasteClipboardImage = useCallback(async () => {
    if (!api || !library || busy) return;
    setUiState("importing");
    setError(null);
    setNotice(null);
    try {
      const result = await api.pasteClipboardImage({
        libraryId: library.libraryId,
        targetFolderId: managedImportTargetFolderIdRef.current,
        targetCollectionId: activeCollectionId ?? undefined,
      });
      if (!result.ok) {
        if (result.error.code === "IMPORT_COLLECTION_ASSIGN_FAILED") {
          await reloadCurrentContentRef.current();
        }
        throw new LibraryOperationError(result.error);
      }
      if ("importId" in result.value) {
        setConflicts(result.value);
      } else {
        setNotice(importSummaryMessage(result.value, locale));
        await onImportCompleted(result.value);
      }
    } catch (caught) {
      if (!shouldSuppressClipboardPasteFeedback(caught)) {
        setError(toMessage(caught, t("toast.clipboardImportFailed"), locale));
      }
    } finally {
      setUiState("ready");
    }
  }, [
    activeCollectionId,
    api,
    busy,
    library,
    locale,
    managedImportTargetFolderIdRef,
    onImportCompleted,
    reloadCurrentContentRef,
    setConflicts,
    setError,
    setNotice,
    setUiState,
    t,
  ]);

  const handleExternalDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (previewBlocksDrop) {
        event.preventDefault();
        setExternalDropActive(false);
        return;
      }
      if (!library || !supportsExternalImportTransfer(event.dataTransfer)) return;
      event.preventDefault();
      externalDragDepth.current += 1;
      setExternalDropActive(true);
    },
    [library, previewBlocksDrop],
  );

  const handleExternalDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!supportsExternalImportTransfer(event.dataTransfer)) return;
      externalDragDepth.current = Math.max(0, externalDragDepth.current - 1);
      if (externalDragDepth.current === 0) setExternalDropActive(false);
    },
    [],
  );

  const handleExternalDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (previewBlocksDrop) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
        setFolderCardDropTarget(null);
        return;
      }
      // Serpent-pagf: resolve folder-card under pointer from the canvas
      // dragover (incl. capture). Unfocused Finder→Electron may skip a
      // stable card dragenter; canvas over + closest() still warms highlight
      // when any over event reaches the renderer.
      const card = (event.target as Element | null)?.closest?.(
        ".folder-card:not(.is-trashed-folder)",
      );
      const folderId = card?.getAttribute("data-folder-id") ?? null;
      if (supportsManagedFolderDrag(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setFolderCardDropTarget(folderId);
        return;
      }
      if (!library || !supportsExternalImportTransfer(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setFolderCardDropTarget(folderId);
    },
    [library, previewBlocksDrop],
  );

  const handleExternalDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (previewBlocksDrop) {
        event.preventDefault();
        externalDragDepth.current = 0;
        setExternalDropActive(false);
        return;
      }
      if (!supportsExternalImportTransfer(event.dataTransfer)) return;
      event.preventDefault();
      externalDragDepth.current = 0;
      setExternalDropActive(false);
      const payload = externalImportPayload(event.dataTransfer);
      if (payload.files.length > 0 && onResolveManagedAssetDrop) {
        // A native drag returning to the browse canvas is not an import. Its
        // File handles identify existing managed assets, so consume it here
        // rather than opening a false duplicate-file conflict dialog.
        void onResolveManagedAssetDrop(payload.files).then((assetIds) => {
          if (assetIds.length > 0) return;
          void importDroppedFiles(payload.files, undefined, undefined, payload);
        });
        return;
      }
      void importDroppedFiles(payload.files, undefined, undefined, payload);
    },
    [importDroppedFiles, onResolveManagedAssetDrop, previewBlocksDrop],
  );

  const handleTargetExternalDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (previewBlocksDrop) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "none";
        return;
      }
      if (!library || !supportsExternalImportTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [library, previewBlocksDrop],
  );

  const handleTargetExternalDrop = useCallback(
    (
      event: DragEvent<HTMLElement>,
      targetFolderId: string | null | undefined,
      targetCollectionId: string | undefined,
    ) => {
      if (previewBlocksDrop) {
        event.preventDefault();
        externalDragDepth.current = 0;
        setExternalDropActive(false);
        setFolderCardDropTarget(null);
        return;
      }
      if (!supportsExternalImportTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      setFolderCardDropTarget(null);
      const payload = externalImportPayload(event.dataTransfer);
      if (payload.files.length > 0 && onResolveManagedAssetDrop) {
        void onResolveManagedAssetDrop(payload.files).then((assetIds) => {
          // Folder/collection targets resolve native managed assets in their
          // dedicated drop handlers. A generic target must not re-import them.
          if (assetIds.length > 0) return;
          void importDroppedFiles(
            payload.files,
            targetFolderId,
            targetCollectionId,
            payload,
          );
        });
        return;
      }
      void importDroppedFiles(
        payload.files,
        targetFolderId,
        targetCollectionId,
        payload,
      );
    },
    [importDroppedFiles, onResolveManagedAssetDrop, previewBlocksDrop],
  );

  const createFolderCardDropHandlers = useCallback(
    (folderId: string) => ({
      dropActive: folderCardDropTarget === folderId,
      onDragEnter: (event: DragEvent<HTMLButtonElement>) => {
        if (
          supportsExternalImportTransfer(event.dataTransfer) ||
          supportsManagedFolderDrag(event.dataTransfer) ||
          supportsManagedAssetDrag(event.dataTransfer)
        ) {
          setFolderCardDropTarget(folderId);
        }
      },
      onDragLeave: (event: DragEvent<HTMLButtonElement>) => {
        // Serpent-4gyr: cross-app drags often report relatedTarget=null while
        // still hovering; clearing here kills the highlight when unfocused.
        if (event.relatedTarget == null) return;
        if (event.currentTarget.contains(event.relatedTarget as Node)) {
          return;
        }
        setFolderCardDropTarget((current) =>
          current === folderId ? null : current,
        );
      },
      onDragOver: (event: DragEvent<HTMLButtonElement>) => {
        // Serpent-4gyr: keep target warm on dragover — unfocused windows may
        // skip a stable dragenter or only deliver over events.
        if (supportsManagedFolderDrag(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setFolderCardDropTarget(folderId);
          return;
        }
        if (supportsManagedAssetDrag(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = resolveManagedDropEffect(
            resolveDragDropMode({ altKey: event.altKey }),
          );
          setFolderCardDropTarget(folderId);
          return;
        }
        if (supportsExternalImportTransfer(event.dataTransfer)) {
          setFolderCardDropTarget(folderId);
        }
        handleTargetExternalDragOver(event);
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
        const assetIds =
          parseManagedAssetDrag(event.dataTransfer) ??
          (getManagedAssetDragIds
            ? [...(getManagedAssetDragIds() ?? [])]
            : null) ??
          null;
        if (assetIds && assetIds.length > 0) {
          event.preventDefault();
          setFolderCardDropTarget(null);
          onAssetsDroppedOnFolder?.(
            folderId,
            assetIds,
            resolveDragDropMode({ altKey: event.altKey }),
          );
          return;
        }
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0 && onResolveManagedAssetDrop) {
          event.preventDefault();
          event.stopPropagation();
          setFolderCardDropTarget(null);
          const payload = externalImportPayload(event.dataTransfer);
          void onResolveManagedAssetDrop(files).then((resolvedIds) => {
            if (resolvedIds.length > 0) {
              onAssetsDroppedOnFolder?.(
                folderId,
                resolvedIds,
                resolveDragDropMode({ altKey: event.altKey }),
              );
              return;
            }
            void importDroppedFiles(files, folderId, undefined, payload);
          });
          return;
        }
        const draggedFolderIds = parseManagedFolderDrag(event.dataTransfer);
        if (draggedFolderIds && draggedFolderIds.length > 0) {
          event.preventDefault();
          setFolderCardDropTarget(null);
          onFoldersDroppedOnFolder?.(folderId, draggedFolderIds);
          return;
        }
        handleTargetExternalDrop(event, folderId, undefined);
      },
    }),
    [
      folderCardDropTarget,
      handleTargetExternalDragOver,
      handleTargetExternalDrop,
      importDroppedFiles,
      getManagedAssetDragIds,
      onResolveManagedAssetDrop,
      onFoldersDroppedOnFolder,
      onAssetsDroppedOnFolder,
    ],
  );

  return {
    externalDropActive,
    setExternalDropActive,
    folderCardDropTarget,
    createFolderCardDropHandlers,
    pasteClipboardImage,
    importDroppedFiles,
    handleExternalDragEnter,
    handleExternalDragLeave,
    handleExternalDragOver,
    handleExternalDrop,
    handleTargetExternalDragOver,
    handleTargetExternalDrop,
  };
}
