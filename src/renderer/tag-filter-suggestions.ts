import type { TagSummary } from "../shared/asset-types";

// ---------------------------------------------------------------------------
// Tag filter picker suggestion lists (REQ-FILTER-020)
//
// The tag filter popover shows candidates in two modes:
// - Empty query (default view): a "top" section (most-used tags) followed by
//   a "recent" section (tags recently applied as a filter, see
//   tag-filter-recency.ts) with any tag already in "top" skipped to avoid
//   duplicate rows.
// - Non-empty query (search): a single flat list of name matches ranked by
//   usage count, same as before this change.
// Tags already selected are excluded from every list.
// ---------------------------------------------------------------------------

export const TOP_TAG_SUGGESTION_LIMIT = 8;
export const RECENT_TAG_SUGGESTION_LIMIT = 6;
export const TAG_SEARCH_RESULT_LIMIT = 20;

export interface TagFilterDefaultSections {
  readonly top: readonly TagSummary[];
  readonly recent: readonly TagSummary[];
}

function excludeSelected(
  tags: readonly TagSummary[],
  selectedNames: readonly string[],
): TagSummary[] {
  const selected = new Set(selectedNames);
  return tags.filter((tag) => !selected.has(tag.name));
}

/**
 * Default (empty-query) picker content: most-used tags first, then recently
 * applied filter tags that are not already in the "top" set. `recentNames`
 * is expected most-recent-first; result order follows that input order.
 */
export function buildTagFilterDefaultSections(
  tags: readonly TagSummary[],
  selectedNames: readonly string[],
  recentNames: readonly string[],
): TagFilterDefaultSections {
  const available = excludeSelected(tags, selectedNames);

  const top = [...available]
    .sort((a, b) => b.assetCount - a.assetCount)
    .slice(0, TOP_TAG_SUGGESTION_LIMIT);
  const topNames = new Set(top.map((tag) => tag.name));

  const byName = new Map(available.map((tag) => [tag.name, tag] as const));
  const recent: TagSummary[] = [];
  for (const name of recentNames) {
    if (topNames.has(name)) continue;
    const tag = byName.get(name);
    if (!tag) continue;
    recent.push(tag);
    if (recent.length >= RECENT_TAG_SUGGESTION_LIMIT) break;
  }

  return { top, recent };
}

/** Search-query results: name-matching tags ranked by usage, most-used first. */
export function buildTagFilterSearchResults(
  tags: readonly TagSummary[],
  selectedNames: readonly string[],
  query: string,
  limit: number = TAG_SEARCH_RESULT_LIMIT,
): TagSummary[] {
  const lowered = query.trim().toLowerCase();
  return excludeSelected(tags, selectedNames)
    .filter((tag) => !lowered || tag.name.toLowerCase().includes(lowered))
    .sort((a, b) => b.assetCount - a.assetCount)
    .slice(0, limit);
}
