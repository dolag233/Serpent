import type { TagSummary } from "../shared/asset-types";

// ---------------------------------------------------------------------------
// Tag management workspace model (Serpent-eaxs / REQ-TAG-010–013 redo)
//
// Pure decision logic for the chip-grid tag management page: sorting,
// name filtering, and the click-selection state machine. Kept free of React
// so the selection semantics stay unit-testable and mirror the asset canvas
// model (plain click = only target; Ctrl/Cmd = toggle; Shift = range from
// anchor replacing selection; Ctrl/Cmd+Shift = range append).
// ---------------------------------------------------------------------------

export type TagSortKey = "name" | "count";
export type TagSortDirection = "asc" | "desc";

/**
 * Sort tags for the management grid. `count` sorts by asset usage with a
 * stable A→Z name tiebreak (tiebreak direction does not flip with the count
 * direction); `name` sorts alphabetically in the requested direction.
 */
export function sortTags(
  tags: readonly TagSummary[],
  key: TagSortKey,
  direction: TagSortDirection,
): TagSummary[] {
  const factor = direction === "desc" ? -1 : 1;
  return [...tags].sort((a, b) => {
    if (key === "count") {
      if (a.assetCount !== b.assetCount) {
        return (a.assetCount - b.assetCount) * factor;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    return (
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * factor
    );
  });
}

/** Case-insensitive substring filter over tag names (empty query = all). */
export function filterTagsByQuery(
  tags: readonly TagSummary[],
  query: string,
): TagSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...tags];
  return tags.filter((tag) => tag.name.toLowerCase().includes(needle));
}

export type TagSelectionState = {
  readonly selectedIds: readonly string[];
  readonly anchorId: string | null;
};

export type TagSelectionClickModifiers = {
  /** Ctrl (Windows) or Cmd (macOS) — toggle semantics. */
  readonly toggle: boolean;
  /** Shift — range semantics relative to the anchor. */
  readonly range: boolean;
};

/**
 * Apply a chip click to the selection state, mirroring the asset canvas
 * combination-key model:
 * - plain click: select only the target (and re-anchor);
 * - toggle click: add/remove the target (and re-anchor);
 * - range click: replace selection with the anchor→target range in the
 *   current visible reading order (anchor unchanged);
 * - toggle+range click: append that range to the current selection.
 * A range click without a usable anchor degrades to a plain click.
 */
export function applyTagSelectionClick(
  state: TagSelectionState,
  tagId: string,
  visibleOrder: readonly string[],
  modifiers: TagSelectionClickModifiers,
): TagSelectionState {
  if (modifiers.range && state.anchorId) {
    const anchorIndex = visibleOrder.indexOf(state.anchorId);
    const targetIndex = visibleOrder.indexOf(tagId);
    if (anchorIndex !== -1 && targetIndex !== -1) {
      const from = Math.min(anchorIndex, targetIndex);
      const to = Math.max(anchorIndex, targetIndex);
      const range = visibleOrder.slice(from, to + 1);
      const base = modifiers.toggle ? state.selectedIds : [];
      return {
        selectedIds: [...new Set([...base, ...range])],
        anchorId: state.anchorId,
      };
    }
  }
  if (modifiers.toggle) {
    return {
      selectedIds: state.selectedIds.includes(tagId)
        ? state.selectedIds.filter((id) => id !== tagId)
        : [...state.selectedIds, tagId],
      anchorId: tagId,
    };
  }
  return { selectedIds: [tagId], anchorId: tagId };
}

/**
 * Resolve which tags a context menu acts on: right-clicking a chip inside
 * the current selection keeps the selection; right-clicking elsewhere
 * collapses the selection to just that chip (asset canvas behaviour).
 */
export function resolveTagMenuTargetIds(
  selectedIds: readonly string[],
  tagId: string,
): string[] {
  return selectedIds.includes(tagId) ? [...selectedIds] : [tagId];
}
