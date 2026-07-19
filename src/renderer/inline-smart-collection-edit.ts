/**
 * SMART-007 / Serpent-san: pure state machine for sidebar inline smart-
 * collection creation. The section 「+」 opens a name-edit row in the smart-
 * collections list (same interaction as folder create), instead of focusing a
 * top-bar name field. This module holds only synchronous, unit-testable
 * transitions; use-inline-smart-collection-edit.ts owns React state, the
 * worker round-trip, and NavigationSidebar renders the row.
 *
 * Commit semantics (Enter and blur share them):
 * - A blank (empty/whitespace) value cancels.
 * - Anything else submits the trimmed name; typed worker failures and the
 *   "needs a real discovery condition" guard are reported through
 *   failInlineSmartCollectionEdit so the row stays open for correction.
 */

/** Default prefill; callers should pass the localized `smartEdit.newName`. */
export const DEFAULT_NEW_SMART_COLLECTION_NAME = "新建智能合集";

export type InlineSmartCollectionEditState = {
  kind: "create";
  value: string;
  /** Typed failure from the last submit; rendered under the row. */
  error: string | null;
  /** True while the worker request is in flight; blocks duplicate submits. */
  submitting: boolean;
};

export type InlineSmartCollectionEditResolution =
  | { action: "submit"; name: string }
  | { action: "cancel" }
  | { action: "keep-editing" };

/**
 * Prefill with the default name fully selected so Enter accepts it as-is and
 * typing replaces it — same fewest-steps convention as folder create.
 */
export function startInlineSmartCollectionCreate(
  defaultName: string = DEFAULT_NEW_SMART_COLLECTION_NAME,
): InlineSmartCollectionEditState {
  return {
    kind: "create",
    value: defaultName,
    error: null,
    submitting: false,
  };
}

/** Typing always clears the previous inline failure reason. */
export function changeInlineSmartCollectionEditValue(
  state: InlineSmartCollectionEditState,
  value: string,
): InlineSmartCollectionEditState {
  return { ...state, value, error: null };
}

/**
 * Shared decision for Enter and blur. "keep-editing" covers a second commit
 * attempt while a request is already in flight.
 */
export function resolveInlineSmartCollectionEditCommit(
  state: InlineSmartCollectionEditState,
): InlineSmartCollectionEditResolution {
  if (state.submitting) return { action: "keep-editing" };
  const name = state.value.trim();
  if (name.length === 0) return { action: "cancel" };
  return { action: "submit", name };
}

export function markInlineSmartCollectionEditSubmitting(
  state: InlineSmartCollectionEditState,
): InlineSmartCollectionEditState {
  return { ...state, submitting: true, error: null };
}

/** Typed/worker failure: the row stays open with the reason for correction. */
export function failInlineSmartCollectionEdit(
  state: InlineSmartCollectionEditState,
  message: string,
): InlineSmartCollectionEditState {
  return { ...state, submitting: false, error: message };
}

/**
 * Identity guard for async completion: the sidebar is non-modal, so a newer
 * session opened while a request is in flight must not be settled by a late
 * result. Create sessions are singular (no parent id), so kind match is enough.
 */
export function isSameInlineSmartCollectionEditSession(
  a: InlineSmartCollectionEditState,
  b: InlineSmartCollectionEditState,
): boolean {
  return a.kind === b.kind;
}
