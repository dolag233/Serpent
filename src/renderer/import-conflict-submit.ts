/**
 * Import decision dialogs (name conflict, content duplicate, source failure)
 * must ignore extra confirms while the Worker is still applying the first one
 * (Serpent-85e60c).
 */

export function canBeginImportDecisionSubmit(inFlight: boolean): boolean {
  return !inFlight;
}

/**
 * A second resolve/skip against an already-consumed import token is not a
 * user-visible failure. The in-flight request that actually hit
 * IMPORT_NOT_FOUND still surfaces (pending really gone).
 */
export function shouldSuppressImportContinueError(input: {
  code: string;
  importId: string;
  completedImportId: string | null;
  isInFlightRequest: boolean;
}): boolean {
  if (input.code !== "IMPORT_NOT_FOUND") return false;
  if (input.completedImportId === input.importId) return true;
  return !input.isInFlightRequest;
}
