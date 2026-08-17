import type { SearchQuery } from '../shared/asset-types';
import { parseSearchExpression } from '../shared/search-expression';

export { parseSearchExpression } from '../shared/search-expression';

export type SearchHighlightSegment = { text: string; matched: boolean };

/**
 * Split a visible field into literal and matching spans. A field-qualified
 * search only highlights that field, while an unqualified term highlights all
 * display values that contain it. Exclusions intentionally never highlight.
 */
export function splitSearchHighlights(
  value: string,
  expression: string,
  field: SearchQuery['clauses'][number]['field'],
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
    term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
  );
  const matcher = new RegExp(escapedTerms.join('|'), 'giu');
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
