/**
 * Secure FTS5 query builder.
 *
 * Builds a complete MATCH expression string from structured SearchClause[] input.
 * The entire expression is intended to be passed as a single `?` bind parameter
 * to `WHERE asset_search MATCH ?` -- SQL fragments are never concatenated.
 *
 * A separate `tokenizeForFts()` helper splits CJK text into space-separated
 * tokens via Intl.Segmenter (word granularity), plus a CJK character-level
 * fallback. Apply this to filename/description/tags before writing to
 * asset_search_content so that unicode61 tokenizer can index CJK correctly.
 */

export interface SearchClause {
  /** FTS5 column name, or null to search all indexed columns. */
  field: string | null;
  /** One or more values for this clause; multiple values produce FTS5 OR. */
  values: string[];
  /** When true the clause is negated (FTS5 NOT). */
  exclude: boolean;
}

const FTS5_COLUMNS = new Set([
  'filename',
  'tags',
  'description',
  'source_url',
  'folder_path',
  'metadata_text',
]);

/**
 * Characters that have special meaning inside FTS5 query strings.
 * We strip them so they cannot change the parse tree.
 */
const FTS5_SPECIAL_RE = /["'()*^]/g;

/**
 * Build a complete FTS5 MATCH expression string from structured clauses.
 *
 * The returned string is safe to bind via `WHERE asset_search MATCH ?`.
 * Malformed input that cannot be sanitized results in a query that
 * intentionally matches nothing (`"__IMPOSSIBLE__"`).
 */
export function buildFts5Query(clauses: SearchClause[]): string {
  const positiveParts: string[] = [];
  const negativeParts: string[] = [];

  // FTS5 NOT is a binary operator and cannot lead an expression. Normalize
  // caller order so mixed queries always emit positive terms before exclusions.
  const normalizedClauses = [
    ...clauses.filter((clause) => !clause.exclude),
    ...clauses.filter((clause) => clause.exclude),
  ];

  for (const clause of normalizedClauses) {
    if (clause.values.length === 0) continue;

    // Validate field name if specified.
    if (clause.field !== null && !FTS5_COLUMNS.has(clause.field)) {
      // Unknown field: produce a query that will never match anything,
      // rather than silently ignoring the clause.
      return '"__IMPOSSIBLE__"';
    }

    const sanitizedValues: string[] = [];
    for (const raw of clause.values) {
      const token = fts5SafeToken(raw);
      // If after sanitization the token is empty, skip it for this clause.
      // If all values produce empty tokens the clause is skipped entirely.
      if (token.length === 0) continue;
      const valueWithField =
        clause.field !== null ? `${clause.field}:${token}` : token;
      sanitizedValues.push(valueWithField);
    }

    if (sanitizedValues.length === 0) continue;

    const valueExpr =
      sanitizedValues.length > 1
        ? `(${sanitizedValues.join(' OR ')})`
        : sanitizedValues[0]!;

    if (clause.exclude) negativeParts.push(valueExpr);
    else positiveParts.push(valueExpr);
  }

  if (positiveParts.length === 0) {
    // FTS5 has no unary NOT or universal-match term. Callers that intentionally
    // support a pure exclusion must invert a positive subquery outside MATCH.
    // Invalid/empty positive input therefore safely matches nothing.
    return '"__IMPOSSIBLE__"';
  }

  return [...positiveParts, ...negativeParts.map((part) => `NOT ${part}`)].join(' ');
}

/**
 * Sanitize a user-supplied value into an FTS5-safe token string.
 *
 * - Applies CJK tokenization (same as used when writing to asset_search_index)
 *   so search terms match the indexed token stream.
 * - Strips special characters that have syntactic meaning ('"' ( ) * ^).
 * - Wraps each whitespace-delimited word in double quotes for literal matching.
 * - Returns empty string when the raw input is empty or consists entirely of
 *   special characters after tokenization.
 */
function fts5SafeToken(raw: string): string {
  // Apply CJK tokenization first so search terms match indexed tokens.
  const tokenized = tokenizeForFts(raw);
  const cleaned = tokenized.replace(FTS5_SPECIAL_RE, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words.map((w) => `"${w}"`).join(' ');
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
