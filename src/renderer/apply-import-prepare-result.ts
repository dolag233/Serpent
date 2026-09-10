import type {
  ImportCompletion,
  ImportConflictPlan,
  ImportSourceFailurePlan,
  ImageSequenceImportOffer,
} from "../shared/protocol/responses";
import {
  isImageSequenceImportOffer,
  isImportConflictPlan,
  isImportSourceFailurePlan,
  type ImportPrepareOutcome,
} from "../shared/import-outcome";

export type ImportPrepareDialogHandlers = {
  onConflicts(plan: ImportConflictPlan): void;
  onSourceFailure(plan: ImportSourceFailurePlan): void;
  onSequenceOffer(offer: ImageSequenceImportOffer): void;
};

/**
 * Routes a prepare/skip/sequence-confirm result to the matching dialog.
 * Returns the completion when no dialog is needed.
 */
export function applyImportPrepareResult(
  value: ImportPrepareOutcome,
  handlers: ImportPrepareDialogHandlers,
): ImportCompletion | null {
  if (isImportSourceFailurePlan(value)) {
    handlers.onSourceFailure(value);
    return null;
  }
  if (isImportConflictPlan(value)) {
    handlers.onConflicts(value);
    return null;
  }
  if (isImageSequenceImportOffer(value)) {
    handlers.onSequenceOffer(value);
    return null;
  }
  return value;
}
