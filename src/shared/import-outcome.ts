import type {
  ImportCompletion,
  ImportConflictPlan,
  ImportSourceFailurePlan,
  ImageSequenceImportOffer,
} from "./protocol/responses";

export type ImportPrepareOutcome =
  | ImportCompletion
  | ImportConflictPlan
  | ImportSourceFailurePlan
  | ImageSequenceImportOffer;

export function isImportConflictPlan(
  value: ImportPrepareOutcome,
): value is ImportConflictPlan {
  return "importId" in value && "suspectedDuplicateCount" in value;
}

export function isImportSourceFailurePlan(
  value: ImportPrepareOutcome,
): value is ImportSourceFailurePlan {
  return "importId" in value && "failedCount" in value && "remainingCount" in value;
}

export function isImageSequenceImportOffer(
  value: ImportPrepareOutcome,
): value is ImageSequenceImportOffer {
  return "sequences" in value && "defaultFps" in value;
}

export function isImportCompletion(
  value: ImportPrepareOutcome,
): value is ImportCompletion {
  return "importedCount" in value && "assets" in value;
}
