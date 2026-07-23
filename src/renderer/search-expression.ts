import type { SearchQuery } from "../shared/asset-types";

const SEARCH_FIELD_ALIASES: Record<
  string,
  SearchQuery["clauses"][number]["field"]
> = {
  name: "filename",
  filename: "filename",
  tag: "tags",
  tags: "tags",
  desc: "description",
  description: "description",
  link: "source_url",
  url: "source_url",
  source: "source_url",
  source_url: "source_url",
  author: "author",
  path: "folder_path",
  folder: "folder_path",
  folder_path: "folder_path",
  meta: "metadata_text",
  metadata: "metadata_text",
  metadata_text: "metadata_text",
};

function tokenizeSearchExpression(value: string): Array<string | "|"> {
  const tokens: Array<string | "|"> = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;
  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) tokens.push(trimmed);
    current = "";
  };
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && character === "|") {
      pushCurrent();
      tokens.push("|");
      continue;
    }
    if (!inQuotes && /\s/u.test(character)) {
      pushCurrent();
      continue;
    }
    current += character;
  }
  if (escaped) current += "\\";
  pushCurrent();
  return tokens;
}

/**
 * Parse the intentionally small search syntax shown by the toolbar help:
 * whitespace is AND, `|` separates alternatives, a leading `-` excludes,
 * and canonical field aliases scope a term. Quotes preserve spaces and `|`.
 */
export function parseSearchExpression(value: string): SearchQuery {
  const groups: SearchQuery["clauses"][] = [[]];
  for (const rawToken of tokenizeSearchExpression(value)) {
    if (rawToken === "|") {
      if (groups.at(-1)!.length > 0) groups.push([]);
      continue;
    }
    let token = rawToken;
    const exclude = token.startsWith("-");
    if (exclude) token = token.slice(1);
    const separator = token.indexOf(":");
    const alias = separator > 0 ? token.slice(0, separator).toLowerCase() : null;
    const field = alias ? SEARCH_FIELD_ALIASES[alias] ?? null : null;
    const searchValue = field ? token.slice(separator + 1) : token;
    if (!searchValue) continue;
    groups.at(-1)!.push({ field, values: [searchValue], exclude });
  }
  const nonEmptyGroups = groups.filter((group) => group.length > 0);
  if (nonEmptyGroups.length <= 1) return { clauses: nonEmptyGroups[0] ?? [] };
  return { clauses: [], groups: nonEmptyGroups };
}

export type SearchHighlightSegment = { text: string; matched: boolean };

/**
 * Split a visible field into literal and matching spans. A field-qualified
 * search only highlights that field, while an unqualified term highlights all
 * display values that contain it. Exclusions intentionally never highlight.
 */
export function splitSearchHighlights(
  value: string,
  expression: string,
  field: SearchQuery["clauses"][number]["field"],
): SearchHighlightSegment[] {
  const query = parseSearchExpression(expression);
  const groups = query.groups ?? [query.clauses];
  const terms = [...new Set(
    groups
      .flat()
      .filter((clause) => !clause.exclude && (clause.field === null || clause.field === field))
      .flatMap((clause) => clause.values)
      .filter(Boolean),
  )].sort((left, right) => right.length - left.length);
  if (terms.length === 0 || value.length === 0) return [{ text: value, matched: false }];

  const escapedTerms = terms.map((term) =>
    term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
  );
  const matcher = new RegExp(escapedTerms.join("|"), "giu");
  const segments: SearchHighlightSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(matcher)) {
    const start = match.index ?? cursor;
    if (start > cursor) segments.push({ text: value.slice(cursor, start), matched: false });
    segments.push({ text: match[0], matched: true });
    cursor = start + match[0].length;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), matched: false });
  return segments.length > 0 ? segments : [{ text: value, matched: false }];
}
