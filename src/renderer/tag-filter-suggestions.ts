import type { TagSummary } from "../shared/asset-types";

// ---------------------------------------------------------------------------
// Tag filter picker suggestion lists (REQ-FILTER-020)
//
// The tag filter popover shows candidates in two modes:
// - Empty query (default view): a "recent" section (tags recently applied as
//   a filter, see tag-filter-recency.ts) followed by a "top" section
//   (most-used tags). Recent wins on name overlap so「最近筛选」stays visible
//   (Serpent-e3e).
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
 * Default (empty-query) picker content: recently-filtered tags first, then
 * most-used tags. Recent wins when a name appears in both (Serpent-e3e):
 * otherwise a popular tag used as a filter never surfaces under「最近筛选」.
 */
export function buildTagFilterDefaultSections(
  tags: readonly TagSummary[],
  selectedNames: readonly string[],
  recentNames: readonly string[],
): TagFilterDefaultSections {
  const available = excludeSelected(tags, selectedNames);
  const byName = new Map(available.map((tag) => [tag.name, tag] as const));

  const recent: TagSummary[] = [];
  const recentNameSet = new Set<string>();
  for (const name of recentNames) {
    const tag = byName.get(name);
    if (!tag || recentNameSet.has(name)) continue;
    recent.push(tag);
    recentNameSet.add(name);
    if (recent.length >= RECENT_TAG_SUGGESTION_LIMIT) break;
  }

  const top = [...available]
    .filter((tag) => !recentNameSet.has(tag.name))
    .sort((a, b) => b.assetCount - a.assetCount)
    .slice(0, TOP_TAG_SUGGESTION_LIMIT);

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
