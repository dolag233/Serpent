/**
 * Trash restore UX (Serpent-0hnx): silent restore when the original path is
 * free; open the existing restore dialog only when a name conflict exists.
 */

export type TrashRestoreRequest = {
  readonly assetIds: string[];
  readonly target: "original" | "root" | string;
  readonly conflictStrategy: "keep-both" | "replace" | "skip";
};

export function shouldOpenTrashRestoreDialog(
  hasNameConflicts: boolean,
): boolean {
  return hasNameConflicts;
}

export function silentTrashRestoreRequest(
  assetIds: string[],
): TrashRestoreRequest {
  return {
    assetIds,
    target: "original",
    conflictStrategy: "keep-both",
  };
}
