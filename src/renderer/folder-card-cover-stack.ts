/**
 * Stacked photo cover slots for physical-folder cards (Serpent-7ms / FOLDER-011).
 * Replaces the Windows-style mosaic grid with fanned photos tucked in the folder body.
 */

export type FolderCoverStackSlot = {
  readonly rotateDeg: number;
  readonly translateXPct: number;
  readonly translateYPct: number;
  readonly zIndex: number;
};

/** Max covers shown on a folder card (matches Worker `coverArtifactIds` batch). */
export const FOLDER_COVER_STACK_MAX = 3;

/**
 * Layout slots for 1–3 cover photos. Empty folders use no slots (glyph only).
 * Photos fan slightly so the card reads as a real folder with tucked previews.
 */
export function folderCoverStackSlots(coverCount: number): FolderCoverStackSlot[] {
  const count = Math.max(0, Math.min(FOLDER_COVER_STACK_MAX, Math.floor(coverCount)));
  if (count <= 0) return [];
  if (count === 1) {
    return [{ rotateDeg: -2, translateXPct: 0, translateYPct: -4, zIndex: 2 }];
  }
  if (count === 2) {
    return [
      { rotateDeg: -10, translateXPct: -10, translateYPct: -2, zIndex: 1 },
      { rotateDeg: 8, translateXPct: 10, translateYPct: -6, zIndex: 2 },
    ];
  }
  return [
    { rotateDeg: -14, translateXPct: -14, translateYPct: 0, zIndex: 1 },
    { rotateDeg: -2, translateXPct: 0, translateYPct: -8, zIndex: 2 },
    { rotateDeg: 12, translateXPct: 14, translateYPct: -2, zIndex: 3 },
  ];
}

export function folderCoverStackStyle(
  slot: FolderCoverStackSlot,
): { transform: string; zIndex: number } {
  return {
    transform: `translate(${slot.translateXPct}%, ${slot.translateYPct}%) rotate(${slot.rotateDeg}deg)`,
    zIndex: slot.zIndex,
  };
}
