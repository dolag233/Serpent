// ---------------------------------------------------------------------------
// "New to linked folders" add-folder hint (Serpent-b8a853 follow-up)
//
// While a library has never used linked folders, adding an ordinary folder
// pulses the sidebar "导入链接文件夹" entry so the user learns the linked
// folder affordance. Persistence (seen = dismissed) lives in
// feature-hint-preferences under LINKED_FOLDER_ADD_HINT_KEY.
// ---------------------------------------------------------------------------

export const LINKED_FOLDER_ADD_HINT_KEY = "linked-folder-add-hint";

export interface LinkedFolderAddHintInput {
  /** Global feature-hint switch (Settings → Feature hints). */
  readonly hintsEnabled: boolean;
  /** Whether this hint has already been dismissed (hovered or used linked). */
  readonly alreadyDismissed: boolean;
  /** Whether the current library already has linked folders. */
  readonly hasLinkedFolders: boolean;
}

/**
 * True when adding a normal folder should pulse the linked-folder entry:
 * hints on, not dismissed, and no linked folders in the library yet.
 */
export function shouldShowLinkedFolderAddHint(
  input: LinkedFolderAddHintInput,
): boolean {
  if (!input.hintsEnabled) return false;
  if (input.alreadyDismissed) return false;
  if (input.hasLinkedFolders) return false;
  return true;
}