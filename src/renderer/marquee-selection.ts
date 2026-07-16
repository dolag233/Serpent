/**
 * Pure set-operation helpers for blank-drag marquee selection (REQ-SELECT-001).
 *
 * Provisional semantics (pending product clarification queue item #10),
 * mirrored from `docs/implementation/0019-product-correctness-vertical-slice.md`:
 *
 * 1. No modifier: selection = current hit set (replace).
 * 2. Ctrl (Windows) / Command (macOS): toggle every asset in the hit set.
 * 3. Shift: same union-add (marquee has no anchor/range semantics; ranges stay
 *    on the Shift+click path).
 * 4. Ctrl/Command+Shift: same union-add.
 * 5. The modifier snapshot is taken once at mousedown and must not change the
 *    operation mid-drag, even if the physical keys change while dragging.
 */

export interface MarqueeModifierSnapshot {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * Whether a modifier snapshot means "preserve the initial selection" rather
 * than "replace with the hit set". Ctrl/Command preserves and toggles while
 * Shift preserves and adds.
 */
export function isMarqueeAdditive(modifiers: MarqueeModifierSnapshot): boolean {
  return modifiers.metaKey || modifiers.ctrlKey || modifiers.shiftKey;
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
): string[] {
  if (!isMarqueeAdditive(modifiers)) return [...hitIds];
  if ((modifiers.metaKey || modifiers.ctrlKey) && !modifiers.shiftKey) {
    const next = new Set(initialSelection);
    for (const assetId of hitIds) {
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
    }
    return [...next];
  }
  return [...new Set([...initialSelection, ...hitIds])];
}
