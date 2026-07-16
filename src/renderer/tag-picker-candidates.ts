import type { TagSummary } from "../shared/asset-types";

/**
 * Candidate builders for the context-menu tag picker (REQ-TAG-004).
 *
 * Zero-use tags are treated differently per entry point:
 * - The Inspector suggestion row (via `buildTagSuggestions`) never offers
 *   zero-use tags: quick suggestions should not be polluted by unused names
 *   (TAG-008, accepted by the product owner).
 * - The menu assign picker DOES offer zero-use tags. It is an explicit
 *   search-driven list with no "create tag" path, so hiding an existing
 *   unused tag would make a freshly created tag unreachable from the menu.
 * - The menu remove picker never offers zero-use tags: an unused tag cannot
 *   be present on any asset, so removing it is a no-op anyway.
 */

export interface TagAssignCandidateOptions {
  /** Include tags with zero assets. Used by the context-menu assign picker. */
  includeUnusedTags?: boolean;
}

/**
 * Tags that can be assigned: name matches the trimmed query (case-insensitive
 * substring) and not in `excludedTagIds` (e.g. tags already on the asset when
 * the caller knows them). Zero-use tags are excluded unless
 * `options.includeUnusedTags` is set.
 */
export function buildTagAssignCandidates(
  tags: TagSummary[],
  query: string,
  excludedTagIds: ReadonlySet<string>,
  options: TagAssignCandidateOptions = {},
): TagSummary[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return tags
    .filter(
      (tag) =>
        (options.includeUnusedTags || tag.assetCount > 0) &&
        !excludedTagIds.has(tag.tagId),
    )
    .filter(
      (tag) =>
        !normalizedQuery ||
        tag.name.toLocaleLowerCase().includes(normalizedQuery),
    );
}

const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

/**
 * Tags that can be removed: every non-zero-use tag matching the query. The
 * selection-level tag intersection is not available in the renderer, so
 * removing a tag an asset does not have stays a harmless no-op on the worker.
 */
export function buildTagRemoveCandidates(
  tags: TagSummary[],
  query: string,
): TagSummary[] {
  return buildTagAssignCandidates(tags, query, NO_EXCLUSIONS);
}
