import type { TagSummary } from "../shared/asset-types";
import { buildTagAssignCandidates } from "./tag-picker-candidates";

const TAG_NAME_SEPARATOR = /[,，]/;

/** Split one tag field on English or Chinese commas. Empty pieces are dropped. */
export function splitTagNames(input: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of input.split(TAG_NAME_SEPARATOR)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/**
 * Names already closed by a comma, plus the fragment still being typed.
 * The draft keeps its spacing so the caret does not jump mid-word.
 */
export function peelTagInput(input: string): { committed: string[]; draft: string } {
  const parts = input.split(TAG_NAME_SEPARATOR);
  const draft = parts.pop() ?? "";
  return { committed: splitTagNames(parts.join(",")), draft };
}

/** The fragment still being typed, after the last comma. */
export function tagSuggestionQuery(input: string): string {
  const parts = input.split(TAG_NAME_SEPARATOR);
  return (parts[parts.length - 1] ?? "").trim();
}

/**
 * Tags to apply from the field. A chosen suggestion replaces the fragment
 * after the last comma and keeps the names already typed before it.
 */
export function namesFromTagInput(
  input: string,
  chosen?: { name: string } | null,
): string[] {
  const segments = splitTagNames(input);
  if (!chosen) return segments;
  const draft = tagSuggestionQuery(input);
  const committed = draft ? segments.slice(0, -1) : segments;
  return splitTagNames([...committed, chosen.name].join(","));
}

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
  const query = tagSuggestionQuery(inputValue);
  const normalizedQuery = query.toLocaleLowerCase();
  const resultLimit = query ? 12 : 8;

  const matchingTags = buildTagAssignCandidates(tags, query, assignedTagIds)
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
