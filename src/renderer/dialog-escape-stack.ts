/**
 * Pure priority for Escape dismiss across stacked App dialogs (Serpent-uye).
 * Order matches the historical App.tsx keydown handler.
 */

export type DialogEscapeSnapshot = {
  assetRenameOpen: boolean;
  imageSequenceImportOpen: boolean;
  imageSequenceDialogOpen: boolean;
  batchRelinkOpen: boolean;
  restoreOpen: boolean;
  moveOpen: boolean;
  /** @deprecated Kept for renderer fixture compatibility; legacy dialog was removed. */
  undoMoveOpen?: boolean;
  collectionEditorOpen: boolean;
  exportDialogOpen: boolean;
  importLibraryChooserOpen: boolean;
  appSettingsOpen: boolean;
  librarySettingsOpen: boolean;
  appLogOpen: boolean;
  scriptSandboxPreviewOpen: boolean;
  aboutOpen: boolean;
  openSourceLicensesOpen: boolean;
  mediaJobsOpen: boolean;
  linkedRulesEditorOpen: boolean;
  convertLinkedOpen: boolean;
  dialogOpen: boolean;
  /** Calm prompt when library plugins appear that still need per-device trust. */
  pluginTrustPromptOpen: boolean;
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
  | { kind: "close-image-sequence-import" }
  | { kind: "close-image-sequence-dialog" }
  | { kind: "cancel-batch-relink" }
  | { kind: "close-restore" }
  | { kind: "close-move" }
  | { kind: "close-collection-editor" }
  | { kind: "close-export" }
  | { kind: "close-import-library-chooser" }
  | { kind: "close-app-settings" }
  | { kind: "close-library-settings" }
  | { kind: "close-app-log" }
  | { kind: "close-script-sandbox-preview" }
  | { kind: "close-about" }
  | { kind: "close-open-source-licenses" }
  | { kind: "close-media-jobs" }
  | { kind: "close-linked-rules" }
  | { kind: "close-convert-linked" }
  | { kind: "close-dialog" }
  | { kind: "dismiss-plugin-trust-prompt" }
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
  // Sequence import is rendered above the regular sequence settings dialog;
  // keep its pending offer and focus trap together when Escape dismisses it.
  if (snapshot.imageSequenceImportOpen) {
    return { kind: "close-image-sequence-import" };
  }
  if (snapshot.imageSequenceDialogOpen) {
    return { kind: "close-image-sequence-dialog" };
  }
  if (snapshot.batchRelinkOpen) return { kind: "cancel-batch-relink" };
  if (snapshot.restoreOpen) return { kind: "close-restore" };
  if (snapshot.moveOpen) return { kind: "close-move" };
  if (snapshot.collectionEditorOpen) return { kind: "close-collection-editor" };
  if (snapshot.exportDialogOpen) return { kind: "close-export" };
  if (snapshot.importLibraryChooserOpen)
    return { kind: "close-import-library-chooser" };
  if (snapshot.appSettingsOpen) return { kind: "close-app-settings" };
  if (snapshot.librarySettingsOpen) return { kind: "close-library-settings" };
  if (snapshot.appLogOpen) return { kind: "close-app-log" };
  if (snapshot.scriptSandboxPreviewOpen) {
    return { kind: "close-script-sandbox-preview" };
  }
  if (snapshot.aboutOpen) return { kind: "close-about" };
  if (snapshot.openSourceLicensesOpen)
    return { kind: "close-open-source-licenses" };
  if (snapshot.mediaJobsOpen) return { kind: "close-media-jobs" };
  if (snapshot.linkedRulesEditorOpen) return { kind: "close-linked-rules" };
  if (snapshot.convertLinkedOpen) return { kind: "close-convert-linked" };
  if (snapshot.dialogOpen) return { kind: "close-dialog" };
  if (snapshot.pluginTrustPromptOpen) {
    return { kind: "dismiss-plugin-trust-prompt" };
  }
  if (snapshot.conflictsImportId) {
    return { kind: "abandon-import", importId: snapshot.conflictsImportId };
  }
  return { kind: "none" };
}
