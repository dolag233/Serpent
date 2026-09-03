import type { TagSummary } from "../shared/asset-types";

// ---------------------------------------------------------------------------
// Tag filter picker suggestion lists (REQ-FILTER-020)
//
// The tag filter popover shows candidates in two modes:
// - Empty query (default view): a "recent" section (tags recently applied as
//   a filter, see tag-filter-recency.ts) followed by an "all" section with
//   every available tag. Recent is intentionally repeated in "all": the
//   second section is the complete library tag set, not another suggestion
//   subset.
// - Non-empty query (search): a single flat list of name matches ranked by
//   usage count, same as before this change.
// Tags already selected are excluded from every list.
// ---------------------------------------------------------------------------

export const RECENT_TAG_SUGGESTION_LIMIT = 6;

export interface TagFilterDefaultSections {
  readonly all: readonly TagSummary[];
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
 * the complete available tag set. The recent section is a deliberate quick
 * access duplicate; the all section must remain complete regardless of sort
 * order or usage count.
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

  return { all: available, recent };
}

/** Search-query results: name-matching tags ranked by usage, most-used first. */
export function buildTagFilterSearchResults(
  tags: readonly TagSummary[],
  selectedNames: readonly string[],
  query: string,
  limit?: number,
): TagSummary[] {
  const lowered = query.trim().toLowerCase();
  const results = excludeSelected(tags, selectedNames)
    .filter((tag) => !lowered || tag.name.toLowerCase().includes(lowered))
    .sort((a, b) => b.assetCount - a.assetCount);
  return limit === undefined ? results : results.slice(0, limit);
}
