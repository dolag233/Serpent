/**
 * Decide whether an FTS search snippet should appear under an asset card's
 * primary display name. Filename hits often return the tokenized index text
 * (e.g. "wide red png"), which visually duplicates the name line.
 */

const HIGHLIGHT_TAG_RE = /<\/?b>/gi;
const ELLIPSIS_RE = /\.\.\./g;
const NON_ALNUM_RE = /[^\p{Letter}\p{Number}]+/gu;

/** Strip FTS `<b>` markers and ellipsis for plain-text comparison. */
export function plainSnippetText(snippet: string): string {
  return snippet.replace(HIGHLIGHT_TAG_RE, "").replace(ELLIPSIS_RE, "").trim();
}

/**
 * Collapse punctuation/separators so "wide-red.png" compares equal to
 * tokenized index text like "wide red png".
 */
export function normalizeForSnippetCompare(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(NON_ALNUM_RE, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Returns the original snippet (with highlight markers) when it adds context
 * beyond the primary display name; otherwise null so the second line is omitted.
 */
export function resolveSearchSnippetCaption(
  snippet: string | null | undefined,
  displayName: string,
): string | null {
  if (snippet == null) return null;
  const trimmed = snippet.trim();
  if (trimmed.length === 0) return null;

  const plain = plainSnippetText(trimmed);
  if (plain.length === 0) return null;

  const normSnippet = normalizeForSnippetCompare(plain);
  if (normSnippet.length === 0) return null;

  const normName = normalizeForSnippetCompare(displayName);
  if (normSnippet === normName) return null;

  return trimmed;
}
