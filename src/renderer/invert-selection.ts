/**
 * Invert selection among the currently visible id set (Serpent-5fq).
 *
 * Product: complement of selected ∩ visible within visible — not set XOR
 * across hidden items. Order follows `visibleIds` so the primary/anchor
 * stays deterministic for subsequent Shift ranges.
 */

export function invertSelection(
  visibleIds: readonly string[],
  selectedIds: readonly string[],
): string[] {
  if (visibleIds.length === 0) return [];
  const selected = new Set(selectedIds);
  return visibleIds.filter((id) => !selected.has(id));
}
