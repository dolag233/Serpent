import type { UnifiedDirectoryNavEntry } from "./unified-directory-nav";

/**
 * REQ-FOLDER-007: pure state machine for in-tree inline folder name editing.
 * The 新建子文件夹 / 重命名… context-menu entries and the sidebar 「+」 entry
 * all open a name-edit row directly inside the directory tree instead of the
 * former modal dialogs (which this change deletes). This module holds only
 * synchronous, fully unit-testable transitions; the React hook in
 * use-inline-folder-edit.ts owns state, the worker round-trip and the
 * refresh/notice conventions, and NavigationSidebar renders the row.
 *
 * Commit semantics (Enter and blur share them):
 * - A blank (empty/whitespace) value cancels: there is nothing meaningful to
 *   submit, and clearing the field is the natural "never mind" gesture.
 * - A rename back to the original name cancels: reverting is a no-op, not a
 *   rename, so no IPC round-trip and no fake success notice.
 * - Anything else submits the trimmed name; typed worker failures
 *   (INVALID_FOLDER_NAME / FOLDER_NAME_CONFLICT / FOLDER_ALREADY_EXISTS) are
 *   reported back through failInlineFolderEdit so the row stays open with the
 *   reason rendered inline for correction.
 */

/**
 * Default prefill for a create row. Matches `folderEdit.newFolder` (zh-CN).
 * Callers that honour the active locale should pass `t('folderEdit.newFolder')`
 * into `startInlineFolderCreate` instead of relying on this constant.
 */
export const DEFAULT_NEW_FOLDER_NAME = "新建文件夹";

export type InlineFolderEditState =
  | {
      kind: "create";
      /** Folder the new subfolder lands in; null is the library root. */
      parentFolderId: string | null;
      value: string;
      /** Typed failure from the last submit; rendered under the row. */
      error: string | null;
      /** True while the worker request is in flight; blocks duplicate submits. */
      submitting: boolean;
    }
  | {
      kind: "rename";
      folderId: string;
      /** Name when the session opened; re-committing it is a no-op cancel. */
      originalName: string;
      value: string;
      error: string | null;
      submitting: boolean;
    };

export type InlineFolderEditResolution =
  | { action: "submit"; name: string }
  | { action: "cancel" }
  | { action: "keep-editing" };

/**
 * The create row is prefilled with the default name fully selected, so Enter
 * accepts it as-is and typing replaces it — the same fewest-steps convention
 * Finder/Eagle use for inline folder creation.
 */
export function startInlineFolderCreate(
  parentFolderId: string | null,
  defaultName: string = DEFAULT_NEW_FOLDER_NAME,
): InlineFolderEditState {
  return {
    kind: "create",
    parentFolderId,
    value: defaultName,
    error: null,
    submitting: false,
  };
}

export function startInlineFolderRename(
  folderId: string,
  currentName: string,
): InlineFolderEditState {
  return {
    kind: "rename",
    folderId,
    originalName: currentName,
    value: currentName,
    error: null,
    submitting: false,
  };
}

/** Typing always clears the previous inline failure reason. */
export function changeInlineFolderEditValue(
  state: InlineFolderEditState,
  value: string,
): InlineFolderEditState {
  return { ...state, value, error: null };
}

/**
 * Shared decision for Enter and blur. "keep-editing" covers a second commit
 * attempt while a request is already in flight (e.g. blur caused by the
 * submitting re-render); the in-flight request resolves the session.
 */
export function resolveInlineFolderEditCommit(
  state: InlineFolderEditState,
): InlineFolderEditResolution {
  if (state.submitting) return { action: "keep-editing" };
  const name = state.value.trim();
  if (name.length === 0) return { action: "cancel" };
  if (state.kind === "rename" && name === state.originalName) {
    return { action: "cancel" };
  }
  return { action: "submit", name };
}

export function markInlineFolderEditSubmitting(
  state: InlineFolderEditState,
): InlineFolderEditState {
  return { ...state, submitting: true, error: null };
}

/** Typed/worker failure: the row stays open with the reason for correction. */
export function failInlineFolderEdit(
  state: InlineFolderEditState,
  message: string,
): InlineFolderEditState {
  return { ...state, submitting: false, error: message };
}

/**
 * Identity guard for async completion: the tree is non-modal, so the user can
 * open a different edit session while a request is still in flight. Late
 * results must only settle the session they were started from.
 */
export function isSameInlineFolderEditSession(
  a: InlineFolderEditState,
  b: InlineFolderEditState,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "create" && b.kind === "create") {
    return a.parentFolderId === b.parentFolderId;
  }
  if (a.kind === "rename" && b.kind === "rename") {
    return a.folderId === b.folderId;
  }
  return false;
}

/**
 * Indent depth of the edit row. A pending create row nests one level under
 * its parent (the library root's children render at depth 1); a rename row
 * keeps the folder's own depth. Missing entries fall back to depth 1 so a
 * stale session can never render at a misleading indentation.
 */
export function inlineFolderEditDepth(
  state: InlineFolderEditState,
  entries: UnifiedDirectoryNavEntry[],
): number {
  if (state.kind === "create") {
    if (state.parentFolderId === null) return 1;
    const parent = entries.find(
      (entry) => entry.folderId === state.parentFolderId,
    );
    return parent ? parent.depth + 1 : 1;
  }
  const target = entries.find((entry) => entry.folderId === state.folderId);
  return target ? target.depth : 1;
}

/**
 * Index in the flat nav entry list where a pending create row is inserted:
 * directly after the parent folder (its first-child position), or at the top
 * of the list when creating at the library root. An unknown parent (stale
 * session) falls back to the top so the row stays visible.
 */
export function inlineCreateRowIndex(
  entries: UnifiedDirectoryNavEntry[],
  parentFolderId: string | null,
): number {
  if (parentFolderId === null) return 0;
  const parentIndex = entries.findIndex(
    (entry) => entry.folderId === parentFolderId,
  );
  return parentIndex >= 0 ? parentIndex + 1 : 0;
}
