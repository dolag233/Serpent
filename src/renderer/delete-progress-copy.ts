import type { DeleteProgressEvent } from "../shared/protocol/responses";

const TERMINAL_DELETE_PROGRESS_PHASES = new Set<DeleteProgressEvent["phase"]>([
  "complete",
  "failed",
  "cancelled",
]);

export function isActiveDeleteProgress(
  progress: DeleteProgressEvent | null,
): progress is DeleteProgressEvent {
  return Boolean(progress && !TERMINAL_DELETE_PROGRESS_PHASES.has(progress.phase));
}

export function isDeleteProgressCancelable(
  progress: DeleteProgressEvent | null,
): boolean {
  return Boolean(
    progress
      && progress.kind === "disk"
      && progress.operationId
      && progress.cancelable !== false
      && progress.phase === "run",
  );
}

export function deleteOverlayTitleKey(
  kind: DeleteProgressEvent["kind"] | undefined,
): "progress.deletingAssets" | "progress.trashingAssets" | "progress.purgingTrash" {
  if (kind === "trash") return "progress.trashingAssets";
  if (kind === "permanent") return "progress.purgingTrash";
  return "progress.deletingAssets";
}

export function deleteOverlayDetail(
  progress: DeleteProgressEvent | null,
): {
  key: "progress.deletingFiles" | "progress.deleting";
  params?: Record<string, number>;
} {
  if (progress && progress.totalFiles > 0) {
    return {
      key: "progress.deletingFiles",
      params: {
        processed: progress.filesProcessed,
        total: progress.totalFiles,
      },
    };
  }
  return { key: "progress.deleting" };
}
