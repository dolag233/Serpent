import type { TagSummary } from "../shared/asset-types";

export type TagSuggestion =
  | {
      kind: "assign";
      tagId: string;
      name: string;
      assetCount: number;
    }
  | {
      kind: "create";
      name: string;
    };

/**
 * Build the Inspector's tag choices without offering tags that are already on
 * the asset. Zero-use tags are deliberately omitted: an unused tag should not
 * continue to behave like a recent/search result while its eventual cleanup is
 * handled by the library service.
 */
export function buildTagSuggestions(
  tags: TagSummary[],
  inputValue: string,
  assignedTagIds: ReadonlySet<string>,
): TagSuggestion[] {
  const query = inputValue.trim();
  const normalizedQuery = query.toLocaleLowerCase();
  const resultLimit = query ? 12 : 8;

  const matchingTags = tags
    .filter((tag) => tag.assetCount > 0 && !assignedTagIds.has(tag.tagId))
    .filter(
      (tag) =>
        !normalizedQuery ||
        tag.name.toLocaleLowerCase().includes(normalizedQuery),
    )
    .slice(0, resultLimit)
    .map<TagSuggestion>((tag) => ({
      kind: "assign",
      tagId: tag.tagId,
      name: tag.name,
      assetCount: tag.assetCount,
    }));

  if (
    query &&
    !tags.some(
      (tag) => tag.name.toLocaleLowerCase() === normalizedQuery,
    )
  ) {
    matchingTags.push({ kind: "create", name: query });
  }

  return matchingTags;
}

export function moveTagSuggestionIndex(
  currentIndex: number,
  direction: 1 | -1,
  suggestionCount: number,
): number {
  if (suggestionCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= suggestionCount) {
    return direction === 1 ? 0 : suggestionCount - 1;
  }
  return (currentIndex + direction + suggestionCount) % suggestionCount;
}
