import type { ImportProgressEvent } from "../shared/protocol/responses";
import {
  isLibraryOpenTransferKind,
  libraryTransferHeadlineKey,
  type LibraryTransferKind,
} from "./library-transfer-progress";

const TERMINAL_IMPORT_PROGRESS_PHASES = new Set<ImportProgressEvent["phase"]>([
  "complete",
  "cancelled",
  "failed",
]);

export function isActiveImportProgress(
  progress: ImportProgressEvent | null,
): progress is ImportProgressEvent {
  return Boolean(progress && !TERMINAL_IMPORT_PROGRESS_PHASES.has(progress.phase));
}

export function isImportAwaitingUserDecision(input: {
  hasConflicts: boolean;
  hasSequenceOffer: boolean;
}): boolean {
  return input.hasConflicts || input.hasSequenceOffer;
}

/**
 * While a blocking import decision is open, ignore non-terminal progress so a
 * late copy 100% event cannot resurrect the overlay on top of the dialog.
 */
export function shouldApplyImportProgressEvent(
  progress: ImportProgressEvent,
  awaitingUserDecision: boolean,
): boolean {
  if (!awaitingUserDecision) return true;
  return TERMINAL_IMPORT_PROGRESS_PHASES.has(progress.phase);
}

export function isBlockingImportOverlayVisible(
  _uiState: string,
  progress: ImportProgressEvent | null,
  awaitingUserDecision = false,
): boolean {
  if (awaitingUserDecision) return false;
  return isActiveImportProgress(progress);
}

export type ImportOverlayTitle = ReturnType<typeof libraryTransferHeadlineKey> | {
  key: "progress.importingAssets";
  name?: false;
};

export function importOverlayTitle(
  transferKind: LibraryTransferKind,
): ImportOverlayTitle {
  if (isLibraryOpenTransferKind(transferKind)) {
    return libraryTransferHeadlineKey(transferKind);
  }
  return { key: "progress.importingAssets" };
}

export type ImportOverlayDetail = {
  key:
    | "progress.readingSourceItems"
    | "progress.validating"
    | "progress.copyingFiles"
    | "progress.copying"
    | "progress.extractingFiles"
    | "progress.extracting"
    | "progress.verifyingFiles"
    | "progress.verifying"
    | "progress.opening"
    | "progress.importingStarted";
  params?: Record<string, string | number>;
};

export function importOverlayDetail(
  progress: ImportProgressEvent | null,
  formatBytes: (bytes: number) => string,
): ImportOverlayDetail {
  if (!progress) return { key: "progress.importingStarted" };
  switch (progress.phase) {
    case "validate":
      return progress.totalFiles > 0
        ? {
            key: "progress.readingSourceItems",
            params: {
              processed: progress.filesProcessed,
              total: progress.totalFiles,
            },
          }
        : { key: "progress.validating" };
    case "copy":
      return progress.totalFiles > 0
        ? {
            key: "progress.copyingFiles",
            params: {
              processed: progress.filesProcessed,
              total: progress.totalFiles,
              bytesProcessed: formatBytes(progress.bytesProcessed),
              bytesTotal: formatBytes(progress.totalBytes),
            },
          }
        : { key: "progress.copying" };
    case "extract":
      return progress.totalFiles > 0
        ? {
            key: "progress.extractingFiles",
            params: {
              processed: progress.filesProcessed,
              total: progress.totalFiles,
            },
          }
        : { key: "progress.extracting" };
    case "verify":
      return progress.totalFiles > 0
        ? {
            key: "progress.verifyingFiles",
            params: {
              processed: progress.filesProcessed,
              total: progress.totalFiles,
            },
          }
        : { key: "progress.verifying" };
    case "open":
      return { key: "progress.opening" };
    default:
      return { key: "progress.importingStarted" };
  }
}
