/**
 * Pure set-operation helpers for blank-drag marquee selection (REQ-SELECT-001).
 *
 * Modifier semantics are platform-aware (Serpent-b44c): macOS uses ⌘ only for
 * toggle; Windows uses Ctrl. Shift always unions.
 */

import {
  isMarqueeAdditiveModifier,
  isMarqueeToggleModifier,
  type SelectionPlatform,
} from "./selection-modifiers";

export interface MarqueeModifierSnapshot {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

export function isMarqueeAdditive(
  modifiers: MarqueeModifierSnapshot,
  platform: SelectionPlatform,
): boolean {
  return isMarqueeAdditiveModifier(modifiers, platform);
}

/**
 * Computes the resulting selection for a marquee drag given the selection
 * captured at mousedown, the current hit set, and the modifier snapshot taken
 * at mousedown (per rule 5, callers must not re-derive this from a live event
 * mid-drag).
 */
export function computeMarqueeSelection(
  initialSelection: readonly string[],
  hitIds: readonly string[],
  modifiers: MarqueeModifierSnapshot,
  platform: SelectionPlatform,
): string[] {
  if (!isMarqueeAdditiveModifier(modifiers, platform)) return [...hitIds];
  if (isMarqueeToggleModifier(modifiers, platform)) {
    const next = new Set(initialSelection);
    for (const assetId of hitIds) {
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
    }
    return [...next];
  }
  return [...new Set([...initialSelection, ...hitIds])];
}
