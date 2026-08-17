/**
 * Search-query utilities shared by the SQLite owner and worker tests.
 *
 * The current index uses FTS5's trigram tokenizer for real substring matches.
 * Query strings remain structured at the process boundary; these helpers emit
 * only a bindable MATCH expression after validating every field identifier.
 */

export interface SearchClause {
  /** FTS5 column name, or null to search all indexed columns. */
  field: string | null;
  /** One or more values for this clause; multiple values produce FTS5 OR. */
  values: string[];
  /** When true the clause is negated (FTS5 NOT). */
  exclude: boolean;
}

export type SearchGroup = SearchClause[];

const FTS5_COLUMNS = new Set([
  'filename',
  'tags',
  'description',
  'source_url',
  'author',
  'folder_path',
  'metadata_text',
]);

/**
 * Characters that have special meaning inside an FTS5 phrase. They are not
 * discarded: doing so broadens the candidate query and can make it disagree
 * with the exact `instr()` predicate. Queries containing one fall back to the
 * exact path instead.
 */
const FTS5_UNSAFE_LITERAL_RE = /["'()*^:]/u;

/**
 * Normalized text stored in `asset_search_index`. Unicode normalization keeps
 * full-width and composed forms predictable; lowercasing happens in JS rather
 * than relying on SQLite's ASCII-only LOWER() implementation.
 */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

export function searchValueLength(value: string): number {
  return Array.from(normalizeSearchText(value).trim()).length;
}

/** True when each requested value can be narrowed safely by a trigram MATCH. */
export function canUseTrigramSearch(groups: SearchGroup[]): boolean {
  const values = groups.flatMap((group) =>
    group.flatMap((clause) => clause.values),
  );
  return values.length > 0 && values.every((value) => {
    const normalized = normalizeSearchText(value).trim();
    return (
      Array.from(normalized).length >= 3 &&
      !FTS5_UNSAFE_LITERAL_RE.test(normalized)
    );
  });
}

/**
 * Build a complete FTS5 MATCH expression string from structured clauses.
 *
 * The returned string is safe to bind via `WHERE asset_search MATCH ?`.
 * Malformed input that cannot be sanitized results in a query that
 * intentionally matches nothing (`"__IMPOSSIBLE__"`).
 */
export function buildFts5Query(clauses: SearchClause[]): string {
  return buildTrigramFts5Query([clauses]);
}

/**
 * Build a trigram MATCH expression for `(AND clauses) OR (AND clauses)`.
 * A negative-only group cannot be represented by FTS5 because NOT is binary;
 * callers route such a query through the exact `instr()` predicate instead.
 */
export function buildTrigramFts5Query(groups: SearchGroup[]): string {
  const groupExpressions: string[] = [];
  for (const group of groups) {
    const positives: string[] = [];
    const negatives: string[] = [];
    for (const clause of group) {
      if (clause.field !== null && !FTS5_COLUMNS.has(clause.field)) {
        return '"__IMPOSSIBLE__"';
      }
      const phrases = clause.values.map(fts5SafePhrase);
      // `canUseTrigramSearch` avoids this path for unsafe text. Keep the
      // builder defensive for direct callers as well: never silently change a
      // literal such as `https://` or `O'Reilly` into another search term.
      if (phrases.some((value) => value === null)) return '"__IMPOSSIBLE__"';
      const values = phrases
        .filter((value): value is string => value !== null)
        .map((value) =>
          clause.field === null
            ? `"${value}"`
            : `${clause.field} : "${value}"`,
        );
      if (values.length === 0) continue;
      const expression = values.length === 1 ? values[0]! : `(${values.join(' OR ')})`;
      if (clause.exclude) negatives.push(expression);
      else positives.push(expression);
    }
    if (positives.length === 0) return '"__IMPOSSIBLE__"';
    let expression = positives.length === 1
      ? positives[0]!
      : `(${positives.join(' AND ')})`;
    // FTS5 NOT is binary (`left NOT right`), not a unary expression. Nesting
    // also keeps multiple exclusions unambiguous.
    for (const negative of negatives)
      expression = `(${expression} NOT ${negative})`;
    groupExpressions.push(expression);
  }
  return groupExpressions.length === 0
    ? '"__IMPOSSIBLE__"'
    : groupExpressions.length === 1
      ? groupExpressions[0]!
      : `(${groupExpressions.join(' OR ')})`;
}

function fts5SafePhrase(raw: string): string | null {
  const normalized = normalizeSearchText(raw).trim();
  return normalized.length > 0 && !FTS5_UNSAFE_LITERAL_RE.test(normalized)
    ? normalized
    : null;
}

/**
 * Tokenize text for FTS5 indexing, handling CJK characters.
 *
 * Uses Intl.Segmenter with word granularity for language-aware splitting.
 * For CJK character runs (Unicode blocks: CJK Unified Ideographs,
 * CJK Compatibility Ideographs, Hiragana, Katakana, Hangul Syllables),
 * further splits each word into individual characters so unicode61
 * tokenizer produces the correct token boundaries.
 *
 * Returns a space-separated token string suitable for writing to
 * asset_search_content columns.
 */
export function tokenizeForFts(text: string): string {
  if (text.trim().length === 0) return '';

  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const segments = [...segmenter.segment(text)];
  const tokens: string[] = [];

  for (const segment of segments) {
    if (!segment.isWordLike) continue;

    const word = segment.segment;
    if (isMostlyCJK(word)) {
      // Split CJK word into individual characters.
      for (let i = 0; i < word.length; i++) {
        const char = word[i]!;
        if (isCJK(char) || /\p{Letter}/u.test(char)) {
          tokens.push(char);
        }
      }
    } else {
      tokens.push(word);
    }
  }

  return tokens.join(' ');
}

/**
 * Heuristic: true when the word contains predominantly CJK characters.
 */
function isMostlyCJK(text: string): boolean {
  let cjkCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (isCJK(text[i]!)) cjkCount++;
  }
  return cjkCount > 0 && cjkCount >= text.length / 2;
}

/**
 * True when `char` falls in a CJK-related Unicode block.
 */
function isCJK(char: string): boolean {
  const cp = char.codePointAt(0);
  if (cp === undefined) return false;
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Unified Ideographs Extension A
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0x3040 && cp <= 0x309f) || // Hiragana
    (cp >= 0x30a0 && cp <= 0x30ff) || // Katakana
    (cp >= 0xac00 && cp <= 0xd7af)    // Hangul Syllables
  );
}
