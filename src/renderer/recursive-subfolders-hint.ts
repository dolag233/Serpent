// ---------------------------------------------------------------------------
// One-time "recursive subfolders" hint decision (Serpent-b8a853)
//
// Pure helpers so the browse canvas can flash the include-subfolders icon a
// single, faint time when the user lands on a folder that has children but no
// direct assets (i.e. the recursive toggle is the only way to see anything).
// Persistence lives in feature-hint-preferences (global switch + seen keys).
// ---------------------------------------------------------------------------

export function recursiveSubfoldersHintKey(
  libraryId: string,
  folderId: string,
): string {
  return `recursive-subfolders:${libraryId}:${folderId}`;
}

export interface RecursiveSubfoldersHintInput {
  /** Whether the recursive (include-subfolders) toggle is currently enabled. */
  readonly recursiveEnabled: boolean;
  /** Global feature-hint switch (Settings → Feature hints). */
  readonly hintsEnabled: boolean;
  /**
   * Whether this folder's hint has already been dismissed (the user expanded
   * its subfolders at least once), so it must never pulse again.
   */
  readonly alreadyDismissed: boolean;
  /**
   * Whether the browsed folder currently renders child-folder cards and zero
   * direct assets (browse canvas mode "folders-only"). Works for managed AND
   * linked folders, unlike per-folder summary counts.
   */
  readonly hasChildFoldersWithoutDirectAssets: boolean;
}

/**
 * True when the include-subfolders icon should keep pulsing its gentle hint:
 * the folder shows child folders but no direct assets (so the recursive toggle
 * is the only way to see anything), recursive still off, the global switch on,
 * and the hint not yet dismissed (user has never expanded this folder).
 */
export function shouldFlashRecursiveSubfoldersHint(
  input: RecursiveSubfoldersHintInput,
): boolean {
  if (input.recursiveEnabled) return false;
  if (!input.hintsEnabled) return false;
  if (input.alreadyDismissed) return false;
  if (!input.hasChildFoldersWithoutDirectAssets) return false;
  return true;
}