/**
 * Stacked photo cover slots for folder cards (Serpent-7ms / Serpent-l67w).
 *
 * Matches the Inspector multi-select deck: small card-stack offsets, no fan
 * rotation. Photos crop to fill (`object-fit: cover` in CSS).
 */

export type FolderCoverStackSlot = {
  /** Kept for style helper compatibility; deck layout uses 0. */
  readonly rotateDeg: number;
  readonly translateXPct: number;
  readonly translateYPct: number;
  readonly zIndex: number;
};

/** Max covers shown on a folder card (matches Worker `coverArtifactIds` batch). */
export const FOLDER_COVER_STACK_MAX = 3;

/**
 * Layout slots for 1–3 cover photos (back → front). Empty folders use no slots.
 * Offsets mirror `.inspector-hero-stack-layer` card-deck layering.
 */
export function folderCoverStackSlots(coverCount: number): FolderCoverStackSlot[] {
  const count = Math.max(0, Math.min(FOLDER_COVER_STACK_MAX, Math.floor(coverCount)));
  if (count <= 0) return [];
  if (count === 1) {
    return [{ rotateDeg: 0, translateXPct: 0, translateYPct: 0, zIndex: 3 }];
  }
  if (count === 2) {
    return [
      { rotateDeg: 0, translateXPct: -5, translateYPct: 5, zIndex: 2 },
      { rotateDeg: 0, translateXPct: 0, translateYPct: 0, zIndex: 3 },
    ];
  }
  return [
    { rotateDeg: 0, translateXPct: -9, translateYPct: 9, zIndex: 1 },
    { rotateDeg: 0, translateXPct: -4.5, translateYPct: 4.5, zIndex: 2 },
    { rotateDeg: 0, translateXPct: 0, translateYPct: 0, zIndex: 3 },
  ];
}

export function folderCoverStackStyle(
  slot: FolderCoverStackSlot,
): { transform: string; zIndex: number } {
  const rotate =
    slot.rotateDeg === 0 ? "" : ` rotate(${slot.rotateDeg}deg)`;
  return {
    transform: `translate(${slot.translateXPct}%, ${slot.translateYPct}%)${rotate}`,
    zIndex: slot.zIndex,
  };
}
