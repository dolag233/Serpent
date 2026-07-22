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
  ImportConflictPlan,
  RendererLibrarySummary,
} from "../shared/protocol/responses";
import { LibraryOperationError, toMessage } from "./error-utils";
import {
  externalImportPayload,
  supportsExternalImportTransfer,
} from "./external-import-transfer";
import {
  parseManagedFolderDrag,
  supportsManagedFolderDrag,
} from "./folder-drag-drop";
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
  setUiState: (state: "loading" | "importing" | "ready") => void;
  setError: (message: string | null) => void;
  setFatal: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  setConflicts: (plan: ImportConflictPlan | null) => void;
  onFoldersDroppedOnFolder?: (
    targetFolderId: string,
    folderIds: readonly string[],
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
  setUiState,
  setError,
  setFatal,
  setNotice,
  setConflicts,
  onFoldersDroppedOnFolder,
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
      if ("importId" in result.value) {
        setConflicts(result.value);
        return;
      }
      setNotice(importSummaryMessage(result.value, locale));
      await reloadCurrentContent();
    },
    [locale, reloadCurrentContent, setConflicts, setNotice],
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
        setFatal(toMessage(caught, t("toast.dropImportFailed"), locale));
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
      setFatal,
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
        await reloadCurrentContentRef.current();
      }
    } catch (caught) {
      setFatal(toMessage(caught, t("toast.clipboardImportFailed"), locale));
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
    reloadCurrentContentRef,
    setConflicts,
    setError,
    setFatal,
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
        return;
      }
      if (!library || !supportsExternalImportTransfer(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
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
      void importDroppedFiles(payload.files, undefined, undefined, payload);
    },
    [importDroppedFiles, previewBlocksDrop],
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
      void importDroppedFiles(
        payload.files,
        targetFolderId,
        targetCollectionId,
        payload,
      );
    },
    [importDroppedFiles, previewBlocksDrop],
  );

  const createFolderCardDropHandlers = useCallback(
    (folderId: string) => ({
      dropActive: folderCardDropTarget === folderId,
      onDragEnter: (event: DragEvent<HTMLButtonElement>) => {
        if (
          supportsExternalImportTransfer(event.dataTransfer) ||
          supportsManagedFolderDrag(event.dataTransfer)
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
        if (supportsExternalImportTransfer(event.dataTransfer)) {
          setFolderCardDropTarget(folderId);
        }
        handleTargetExternalDragOver(event);
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
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
      onFoldersDroppedOnFolder,
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
