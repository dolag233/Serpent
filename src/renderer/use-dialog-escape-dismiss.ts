import { useEffect } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import type { ImportConflictPlan } from "../shared/protocol/responses";
import {
  isDialogEscapeLayerActive,
  resolveDialogEscapeAction,
  type DialogEscapeSnapshot,
} from "./dialog-escape-stack";
import { LibraryOperationError, toMessage } from "./error-utils";
import { useLocale, useT } from "./i18n";

export type UseDialogEscapeDismissParams = {
  api: SerpentLibraryApi | null;
  snapshot: DialogEscapeSnapshot;
  cancelAssetRename: () => void;
  cancelBatchRelink: () => void | Promise<void>;
  setPermanentDeleteDialog: (value: null) => void;
  cancelDiskDelete: () => void;
  setDeleteLinkedDialog: (value: null) => void;
  setRestoreDialog: (value: null) => void;
  setMoveDialog: (value: null) => void;
  setUndoMoveDialog: (value: null) => void;
  setCollectionEditor: (value: null) => void;
  setExportDialogOpen: (open: boolean) => void;
  setImportLibraryChooserOpen: (open: boolean) => void;
  setAppSettingsOpen: (open: boolean) => void;
  setLibrarySettingsOpen: (open: boolean) => void;
  setAppLogOpen: (open: boolean) => void;
  setScriptSandboxPreviewOpen: (open: boolean) => void;
  setAboutOpen: (open: boolean) => void;
  setOpenSourceLicensesOpen: (open: boolean) => void;
  setMediaJobsOpen: (open: boolean) => void;
  setLinkedRulesEditor: (value: null) => void;
  resetConvertLinkedDialog: () => void;
  setDialog: (value: null) => void;
  setShowCollectionInput: (open: boolean) => void;
  setConflicts: (value: ImportConflictPlan | null) => void;
  setError: (message: string | null) => void;
  /** Serpent-c2rm: Escape dismisses the pending library-plugin trust prompt as Later. */
  onDismissPluginTrustPrompt?: () => void;
  /** Serpent-99lv: Escape dismisses the blocking fatal alert. */
  onDismissFatalAlert?: () => void;
  /** Serpent-kdnm: Escape on connection-failure dialog aborts remaining AI jobs. */
  onAbortAiConnectionFailure?: () => void;
};

/**
 * Document-level Escape dismiss for stacked App dialogs (Serpent-uye).
 * Priority lives in `dialog-escape-stack.ts`.
 */
export function useDialogEscapeDismiss({
  api,
  snapshot,
  cancelAssetRename,
  cancelBatchRelink,
  setPermanentDeleteDialog,
  cancelDiskDelete,
  setDeleteLinkedDialog,
  setRestoreDialog,
  setMoveDialog,
  setUndoMoveDialog,
  setCollectionEditor,
  setExportDialogOpen,
  setImportLibraryChooserOpen,
  setAppSettingsOpen,
  setLibrarySettingsOpen,
  setAppLogOpen,
  setScriptSandboxPreviewOpen,
  setAboutOpen,
  setOpenSourceLicensesOpen,
  setMediaJobsOpen,
  setLinkedRulesEditor,
  resetConvertLinkedDialog,
  setDialog,
  setShowCollectionInput,
  setConflicts,
  setError,
  onDismissPluginTrustPrompt,
  onDismissFatalAlert,
  onAbortAiConnectionFailure,
}: UseDialogEscapeDismissParams): void {
  const t = useT();
  const { locale } = useLocale();

  useEffect(() => {
    if (!isDialogEscapeLayerActive(snapshot)) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Dialogs are the topmost interaction layer. Handle Escape during the
      // capture phase so a viewer/workspace listener cannot close a surface
      // underneath the dialog first.
      event.stopPropagation();
      const action = resolveDialogEscapeAction(snapshot);
      switch (action.kind) {
        case "none":
          return;
        case "dismiss-fatal-alert":
          onDismissFatalAlert?.();
          return;
        case "abort-ai-connection-failure":
          onAbortAiConnectionFailure?.();
          return;
        case "cancel-asset-rename":
          cancelAssetRename();
          return;
        case "close-permanent-delete":
          setPermanentDeleteDialog(null);
          return;
        case "close-disk-delete":
          cancelDiskDelete();
          return;
        case "close-delete-linked":
          setDeleteLinkedDialog(null);
          return;
        case "cancel-batch-relink":
          void cancelBatchRelink();
          return;
        case "close-restore":
          setRestoreDialog(null);
          return;
        case "close-move":
          setMoveDialog(null);
          return;
        case "close-undo-move":
          setUndoMoveDialog(null);
          return;
        case "close-collection-editor":
          setCollectionEditor(null);
          return;
        case "close-export":
          setExportDialogOpen(false);
          return;
        case "close-import-library-chooser":
          setImportLibraryChooserOpen(false);
          return;
        case "close-app-settings":
          setAppSettingsOpen(false);
          return;
        case "close-library-settings":
          setLibrarySettingsOpen(false);
          return;
        case "close-app-log":
          setAppLogOpen(false);
          return;
        case "close-script-sandbox-preview":
          setScriptSandboxPreviewOpen(false);
          return;
        case "close-about":
          setAboutOpen(false);
          return;
        case "close-open-source-licenses":
          setOpenSourceLicensesOpen(false);
          return;
        case "close-media-jobs":
          setMediaJobsOpen(false);
          return;
        case "close-linked-rules":
          setLinkedRulesEditor(null);
          return;
        case "close-convert-linked":
          resetConvertLinkedDialog();
          return;
        case "close-dialog":
          setDialog(null);
          setShowCollectionInput(false);
          return;
        case "dismiss-plugin-trust-prompt":
          onDismissPluginTrustPrompt?.();
          return;
        case "abandon-import": {
          if (!api) return;
          const importId = action.importId;
          setConflicts(null);
          void Promise.resolve().then(async () => {
            try {
              const result = await api.abandonImport({ importId });
              if (!result.ok) throw new LibraryOperationError(result.error);
            } catch (caught) {
              setError(
                toMessage(caught, t("toast.cancelPendingImportFailed"), locale),
              );
            }
          });
          return;
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [
    api,
    snapshot,
    cancelAssetRename,
    cancelBatchRelink,
    cancelDiskDelete,
    setPermanentDeleteDialog,
    setDeleteLinkedDialog,
    setRestoreDialog,
    setMoveDialog,
    setUndoMoveDialog,
    setCollectionEditor,
    setExportDialogOpen,
    setImportLibraryChooserOpen,
    setAppSettingsOpen,
    setLibrarySettingsOpen,
    setAppLogOpen,
    setScriptSandboxPreviewOpen,
    setAboutOpen,
    setOpenSourceLicensesOpen,
    setMediaJobsOpen,
    setLinkedRulesEditor,
    resetConvertLinkedDialog,
    setDialog,
    setShowCollectionInput,
    setConflicts,
    setError,
    onDismissPluginTrustPrompt,
    onDismissFatalAlert,
    onAbortAiConnectionFailure,
    locale,
    t,
  ]);
}
