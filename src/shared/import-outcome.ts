import type {
  ImportCompletion,
  ImportConflictPlan,
  ImageSequenceImportOffer,
} from "./protocol/responses";

export function isImportConflictPlan(
  value: ImportCompletion | ImportConflictPlan | ImageSequenceImportOffer,
): value is ImportConflictPlan {
  return "importId" in value && "suspectedDuplicateCount" in value;
}

export function isImageSequenceImportOffer(
  value: ImportCompletion | ImportConflictPlan | ImageSequenceImportOffer,
): value is ImageSequenceImportOffer {
  return "sequences" in value && "defaultFps" in value;
}

export function isImportCompletion(
  value: ImportCompletion | ImportConflictPlan | ImageSequenceImportOffer,
): value is ImportCompletion {
  return "importedCount" in value && "assets" in value;
}
