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
  ImportSourceFailurePlan,
  ImageSequenceImportOffer,
  RendererLibrarySummary,
} from "../shared/protocol/responses";
import {
  isImageSequenceImportOffer,
  isImportConflictPlan,
  isImportSourceFailurePlan,
} from "../shared/import-outcome";
import { LibraryOperationError, toMessage, shouldSuppressClipboardPasteFeedback } from "./error-utils";
import {
  externalImportPayload,
  reduceInternalDragPhase,
  scheduleInternalAssetDropCleanup,
  shouldActivateExternalImportOverlay,
  shouldConsumeManagedAssetDrop,
  supportsExternalImportTransfer,
  type InternalDragPhase,
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
import { importSummaryMessage, shouldNotifyImportCompletion } from "./import-summary";

export type UseExternalImportHandlersParams = {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  busy: boolean;
  activeCollectionId: string | null;
  autoDetectImageSequences: boolean;
  detectImageSequences: boolean;
  /** When set, external drop highlight/import is suppressed (viewer open). */
  previewBlocksDrop: boolean;
  managedImportTargetFolderIdRef: MutableRefObject<string | undefined>;
  reloadCurrentContent: () => Promise<void>;
  reloadCurrentContentRef: MutableRefObject<() => Promise<void>>;
  /** After a successful import without conflicts: reveal/select imported assets. */
  onImportCompleted: (completion: ImportCompletion) => void | Promise<void>;
  setUiState: (state: "loading" | "importing" | "ready") => void;
  /** Drop/paste RPC return must clear the overlay even if a complete event was lost. */
  setImportProgress: (progress: null) => void;
  /** Overlay session is the Worker import command, not follow-up reveal. */
  runImportRpc: <T>(work: () => Promise<T>) => Promise<T>;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  setConflicts: (plan: ImportConflictPlan | null) => void;
  setSourceFailurePlan?: (plan: ImportSourceFailurePlan | null) => void;
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
  autoDetectImageSequences,
  detectImageSequences,
  previewBlocksDrop,
  managedImportTargetFolderIdRef,
  reloadCurrentContent,
  reloadCurrentContentRef,
  onImportCompleted,
  setUiState,
  setImportProgress,
  runImportRpc,
  setError,
  setNotice,
  setConflicts,
  setSourceFailurePlan,
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
  const externalDragDepth = useRef(0);
  const internalDragPhase = useRef<InternalDragPhase>("idle");
  const internalDragArmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const internalDragDropCleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInternalAssetDrag = useCallback(
    () => internalDragPhase.current !== "idle",
    [],
  );

  const dismissExternalDrop = useCallback(() => {
    externalDragDepth.current = 0;
    setExternalDropActive(false);
    setFolderCardDropTarget(null);
  }, []);

  const beginInternalAssetDrag = useCallback(() => {
    if (internalDragDropCleanupTimer.current !== null) {
      clearTimeout(internalDragDropCleanupTimer.current);
      internalDragDropCleanupTimer.current = null;
    }
    internalDragPhase.current = reduceInternalDragPhase(
      internalDragPhase.current,
      "begin",
    );
    if (internalDragArmTimer.current !== null) {
      clearTimeout(internalDragArmTimer.current);
    }
    internalDragArmTimer.current = setTimeout(() => {
      internalDragArmTimer.current = null;
      internalDragPhase.current = reduceInternalDragPhase(
        internalDragPhase.current,
        "arm",
      );
    }, 50);
  }, []);

  const finishInternalAssetDrag = useCallback(
    (event: "drop" | "dragend") => {
      const next = reduceInternalDragPhase(internalDragPhase.current, event);
      if (next === internalDragPhase.current) return;
      internalDragPhase.current = next;
      if (internalDragArmTimer.current !== null) {
        clearTimeout(internalDragArmTimer.current);
        internalDragArmTimer.current = null;
      }
      dismissExternalDrop();
    },
    [dismissExternalDrop],
  );

  useEffect(() => {
    // Trusted native drops may run a microtask checkpoint between capture and
    // bubble listeners. A microtask can therefore clear this before React's
    // delegated handler reads it; defer cleanup to the next task instead.
    const onDrop = () => {
      if (internalDragDropCleanupTimer.current !== null) {
        clearTimeout(internalDragDropCleanupTimer.current);
      }
      internalDragDropCleanupTimer.current = scheduleInternalAssetDropCleanup(
        () => {
          internalDragDropCleanupTimer.current = null;
          finishInternalAssetDrag("drop");
        },
      );
    };
    const onDragEnd = () => finishInternalAssetDrag("dragend");
    window.addEventListener("drop", onDrop, true);
    window.addEventListener("dragend", onDragEnd, true);
    return () => {
      window.removeEventListener("drop", onDrop, true);
      window.removeEventListener("dragend", onDragEnd, true);
      if (internalDragArmTimer.current !== null) {
        clearTimeout(internalDragArmTimer.current);
      }
      if (internalDragDropCleanupTimer.current !== null) {
        clearTimeout(internalDragDropCleanupTimer.current);
      }
    };
  }, [finishInternalAssetDrag]);

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
      if (isImportSourceFailurePlan(result.value)) {
        setSourceFailurePlan?.(result.value);
        return;
      }
      if (isImportConflictPlan(result.value)) {
        setConflicts(result.value);
        return;
      }
      if (isImageSequenceImportOffer(result.value)) {
        setImageSequenceImportOffer(result.value);
        return;
      }
      if (shouldNotifyImportCompletion(result.value)) setNotice(importSummaryMessage(result.value, locale));
      await onImportCompleted(result.value);
    },
    [
      locale,
      onImportCompleted,
      reloadCurrentContent,
      setConflicts,
      setSourceFailurePlan,
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
        const result = await runImportRpc(() => api.importDropped({
          libraryId: library.libraryId,
          targetFolderId: targetFolderId ?? undefined,
          targetCollectionId,
          autoDetectImageSequences,
          detectImageSequences,
          files,
          html: webPayload?.html,
          uriList: webPayload?.uriList,
        }));
        await applyDesktopImportResult(result);
      } catch (caught) {
        if (!shouldSuppressClipboardPasteFeedback(caught)) {
          setError(toMessage(caught, t("toast.dropImportFailed"), locale));
        }
      } finally {
        setImportProgress(null);
        setUiState("ready");
        setExternalDropActive(false);
        externalDragDepth.current = 0;
      }
    },
    [
      activeCollectionId,
      autoDetectImageSequences,
      detectImageSequences,
      api,
      applyDesktopImportResult,
      busy,
      library,
      locale,
      managedImportTargetFolderIdRef,
      runImportRpc,
      setError,
      setImportProgress,
      setNotice,
      setUiState,
      t,
    ],
  );

  const pasteClipboardImage = useCallback(
    async (options?: {
      targetFolderId?: string;
      /** Windows clipboard images are often bitmap-only (CF_DIB) that never
          surface as an image item in the renderer's clipboardData. When Main
          reports no image it can read, this runs instead of a failure toast. */
      onNoClipboardImage?: () => void | Promise<void>;
    }) => {
      if (!api || !library || busy) return;
      setUiState("importing");
      setError(null);
      setNotice(null);
      try {
        const result = await runImportRpc(() => api.pasteClipboardImage({
          libraryId: library.libraryId,
          targetFolderId:
            options?.targetFolderId ?? managedImportTargetFolderIdRef.current,
          targetCollectionId: activeCollectionId ?? undefined,
        }));
        if (!result.ok) {
          if (result.error.code === "CLIPBOARD_IMAGE_NOT_FOUND") {
            if (options?.onNoClipboardImage) {
              await options.onNoClipboardImage();
              return;
            }
            throw new LibraryOperationError(result.error);
          }
          if (result.error.code === "IMPORT_COLLECTION_ASSIGN_FAILED") {
            await reloadCurrentContentRef.current();
          }
          throw new LibraryOperationError(result.error);
        }
        if (isImportSourceFailurePlan(result.value)) {
          setSourceFailurePlan?.(result.value);
        } else if (isImportConflictPlan(result.value)) {
          setConflicts(result.value);
        } else if (isImageSequenceImportOffer(result.value)) {
          setImageSequenceImportOffer(result.value);
        } else {
          if (shouldNotifyImportCompletion(result.value)) setNotice(importSummaryMessage(result.value, locale));
          await onImportCompleted(result.value);
        }
      } catch (caught) {
        if (!shouldSuppressClipboardPasteFeedback(caught)) {
          setError(toMessage(caught, t("toast.clipboardImportFailed"), locale));
        }
      } finally {
        setImportProgress(null);
        setUiState("ready");
      }
    },
    [
      activeCollectionId,
      api,
      busy,
      library,
      locale,
      managedImportTargetFolderIdRef,
      onImportCompleted,
      reloadCurrentContentRef,
      runImportRpc,
      setConflicts,
      setSourceFailurePlan,
      setImageSequenceImportOffer,
      setError,
      setImportProgress,
      setNotice,
      setUiState,
      t,
    ],
  );

  const handleExternalDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (previewBlocksDrop) {
        event.preventDefault();
        setExternalDropActive(false);
        return;
      }
      if (
        !library ||
        !shouldActivateExternalImportOverlay(
          Array.from(event.dataTransfer.types),
          internalDragPhase.current !== "idle",
        )
      ) {
        return;
      }
      event.preventDefault();
      externalDragDepth.current += 1;
      setExternalDropActive(true);
    },
    [library, previewBlocksDrop],
  );

  const handleExternalDragLeave = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (internalDragPhase.current !== "idle") return;
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
      const internalAssetDrag = internalDragPhase.current !== "idle";
      const dropEffect = internalAssetDrag
        ? resolveManagedDropEffect("move", event.dataTransfer.effectAllowed)
        : "copy";
      if (!dropEffect) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dropEffect;
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
      const internalAssetDrag = internalDragPhase.current !== "idle";
      if (
        payload.files.length > 0 &&
        internalAssetDrag &&
        onResolveManagedAssetDrop
      ) {
        // A native drag returning to the browse canvas is not an import. Its
        // File handles identify existing managed assets, so consume it here
        // rather than opening a false duplicate-file conflict dialog.
        void onResolveManagedAssetDrop(payload.files).then((assetIds) => {
          if (
            shouldConsumeManagedAssetDrop(
              internalAssetDrag,
              payload.files.length,
              assetIds,
            )
          ) {
            return;
          }
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
      const internalAssetDrag = internalDragPhase.current !== "idle";
      const dropEffect = internalAssetDrag
        ? resolveManagedDropEffect("move", event.dataTransfer.effectAllowed)
        : "copy";
      if (!dropEffect) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = dropEffect;
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
      const internalAssetDrag = internalDragPhase.current !== "idle";
      if (
        payload.files.length > 0 &&
        internalAssetDrag &&
        onResolveManagedAssetDrop
      ) {
        void onResolveManagedAssetDrop(payload.files).then((assetIds) => {
          // Folder/collection targets resolve native managed assets in their
          // dedicated drop handlers. A generic target must not re-import them.
          if (
            shouldConsumeManagedAssetDrop(
              internalAssetDrag,
              payload.files.length,
              assetIds,
            )
          ) {
            return;
          }
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
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (
          supportsExternalImportTransfer(event.dataTransfer) ||
          supportsManagedFolderDrag(event.dataTransfer) ||
          supportsManagedAssetDrag(event.dataTransfer)
        ) {
          setFolderCardDropTarget(folderId);
        }
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
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
      onDragOver: (event: DragEvent<HTMLElement>) => {
        // Serpent-4gyr: keep target warm on dragover — unfocused windows may
        // skip a stable dragenter or only deliver over events.
        if (supportsManagedFolderDrag(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setFolderCardDropTarget(folderId);
          return;
        }
        if (supportsManagedAssetDrag(event.dataTransfer)) {
          const mode = resolveDragDropMode({ altKey: event.altKey });
          const dropEffect = resolveManagedDropEffect(
            mode,
            event.dataTransfer.effectAllowed,
          );
          if (!dropEffect) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = dropEffect;
          setFolderCardDropTarget(folderId);
          return;
        }
        if (supportsExternalImportTransfer(event.dataTransfer)) {
          setFolderCardDropTarget(folderId);
        }
        handleTargetExternalDragOver(event);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
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
        const internalAssetDrag = internalDragPhase.current !== "idle";
        if (
          files.length > 0 &&
          internalAssetDrag &&
          onResolveManagedAssetDrop
        ) {
          event.preventDefault();
          event.stopPropagation();
          setFolderCardDropTarget(null);
          const payload = externalImportPayload(event.dataTransfer);
          void onResolveManagedAssetDrop(files).then((resolvedIds) => {
            if (
              shouldConsumeManagedAssetDrop(
                internalAssetDrag,
                files.length,
                resolvedIds,
              )
            ) {
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
    beginInternalAssetDrag,
    isInternalAssetDrag,
    handleExternalDragEnter,
    handleExternalDragLeave,
    handleExternalDragOver,
    handleExternalDrop,
    handleTargetExternalDragOver,
    handleTargetExternalDrop,
  };
}
