import type {
  ExportProgressEvent,
  ImportProgressEvent,
  SyncProgressEvent,
} from "../shared/protocol/responses";

export type LibrarySwitchActivity =
  | "library-operation"
  | "asset-import"
  | "library-export"
  | "sync";

type SwitchUiState =
  | "booting"
  | "idle"
  | "creating"
  | "opening"
  | "closing"
  | "loading"
  | "importing"
  | "ready";

function isImportActive(progress: ImportProgressEvent | null): boolean {
  return progress !== null && !["complete", "cancelled", "failed"].includes(progress.phase);
}

function isExportActive(progress: ExportProgressEvent | null): boolean {
  return progress !== null && !["complete", "cancelled", "failed"].includes(progress.phase);
}

function isSyncActive(progress: SyncProgressEvent | null): boolean {
  return progress !== null && progress.phase !== "complete";
}

/**
 * Returns the operation whose interruption should be explained before a
 * library switch. Plain browse loading is intentionally not included: it has
 * no uncommitted filesystem work and can be discarded safely.
 */
export function activeLibrarySwitchActivity(input: {
  uiState: SwitchUiState;
  importProgress: ImportProgressEvent | null;
  exportProgress: ExportProgressEvent | null;
  syncProgress: SyncProgressEvent | null;
}): LibrarySwitchActivity | null {
  if (["creating", "opening", "closing"].includes(input.uiState)) {
    return "library-operation";
  }
  if (isImportActive(input.importProgress) || input.uiState === "importing") {
    return "asset-import";
  }
  if (isExportActive(input.exportProgress)) return "library-export";
  if (isSyncActive(input.syncProgress)) return "sync";
  return null;
}
