/**
 * Pure priority for Escape dismiss across stacked App dialogs (Serpent-uye).
 * Order matches the historical App.tsx keydown handler.
 */

export type DialogEscapeSnapshot = {
  assetRenameOpen: boolean;
  permanentDeleteOpen: boolean;
  diskDeleteOpen: boolean;
  deleteLinkedOpen: boolean;
  batchRelinkOpen: boolean;
  restoreOpen: boolean;
  moveOpen: boolean;
  undoMoveOpen: boolean;
  collectionEditorOpen: boolean;
  exportDialogOpen: boolean;
  importLibraryChooserOpen: boolean;
  appSettingsOpen: boolean;
  extensionPairingOpen: boolean;
  mediaJobsOpen: boolean;
  linkedRulesEditorOpen: boolean;
  convertLinkedOpen: boolean;
  dialogOpen: boolean;
  /** Serpent-99lv: blocking fatal alert — Escape acknowledges/dismisses. */
  fatalAlertOpen: boolean;
  /** Serpent-kdnm: AI connection lost — Escape aborts remaining jobs. */
  aiConnectionFailureOpen: boolean;
  /** When set, Escape abandons this pending import conflict plan. */
  conflictsImportId: string | null;
};

export type DialogEscapeAction =
  | { kind: "none" }
  | { kind: "cancel-asset-rename" }
  | { kind: "close-permanent-delete" }
  | { kind: "close-disk-delete" }
  | { kind: "close-delete-linked" }
  | { kind: "cancel-batch-relink" }
  | { kind: "close-restore" }
  | { kind: "close-move" }
  | { kind: "close-undo-move" }
  | { kind: "close-collection-editor" }
  | { kind: "close-export" }
  | { kind: "close-import-library-chooser" }
  | { kind: "close-app-settings" }
  | { kind: "close-extension-pairing" }
  | { kind: "close-media-jobs" }
  | { kind: "close-linked-rules" }
  | { kind: "close-convert-linked" }
  | { kind: "close-dialog" }
  | { kind: "dismiss-fatal-alert" }
  | { kind: "abort-ai-connection-failure" }
  | { kind: "abandon-import"; importId: string };

export function isDialogEscapeLayerActive(
  snapshot: DialogEscapeSnapshot,
): boolean {
  return resolveDialogEscapeAction(snapshot).kind !== "none";
}

export function resolveDialogEscapeAction(
  snapshot: DialogEscapeSnapshot,
): DialogEscapeAction {
  // Generic fatal alert sits above other layers (Serpent-99lv).
  if (snapshot.fatalAlertOpen) {
    return { kind: "dismiss-fatal-alert" };
  }
  // Fatal AI connection dialog sits above remaining layers (Serpent-kdnm).
  if (snapshot.aiConnectionFailureOpen) {
    return { kind: "abort-ai-connection-failure" };
  }
  if (snapshot.assetRenameOpen) return { kind: "cancel-asset-rename" };
  if (snapshot.permanentDeleteOpen) return { kind: "close-permanent-delete" };
  if (snapshot.diskDeleteOpen) return { kind: "close-disk-delete" };
  if (snapshot.deleteLinkedOpen) return { kind: "close-delete-linked" };
  if (snapshot.batchRelinkOpen) return { kind: "cancel-batch-relink" };
  if (snapshot.restoreOpen) return { kind: "close-restore" };
  if (snapshot.moveOpen) return { kind: "close-move" };
  if (snapshot.undoMoveOpen) return { kind: "close-undo-move" };
  if (snapshot.collectionEditorOpen) return { kind: "close-collection-editor" };
  if (snapshot.exportDialogOpen) return { kind: "close-export" };
  if (snapshot.importLibraryChooserOpen)
    return { kind: "close-import-library-chooser" };
  if (snapshot.appSettingsOpen) return { kind: "close-app-settings" };
  if (snapshot.extensionPairingOpen) return { kind: "close-extension-pairing" };
  if (snapshot.mediaJobsOpen) return { kind: "close-media-jobs" };
  if (snapshot.linkedRulesEditorOpen) return { kind: "close-linked-rules" };
  if (snapshot.convertLinkedOpen) return { kind: "close-convert-linked" };
  if (snapshot.dialogOpen) return { kind: "close-dialog" };
  if (snapshot.conflictsImportId) {
    return { kind: "abandon-import", importId: snapshot.conflictsImportId };
  }
  return { kind: "none" };
}
