import type { SearchExpressionNode, SearchQuery } from '../shared/asset-types';
import { parseSearchExpressionDetailed, type SearchExpressionDiagnostic } from '../shared/search-expression';

export { parseSearchExpression } from '../shared/search-expression';
export { parseSearchExpressionDetailed } from '../shared/search-expression';

export type SearchHighlightSegment = { text: string; matched: boolean };

export function searchExpressionReasonKey(code: SearchExpressionDiagnostic['code']): string {
  switch (code) {
    case 'too_long': return 'limitLength';
    case 'too_many_terms': return 'limitTerms';
    case 'too_deep': return 'limitGroups';
    case 'unclosed_quote': return 'closeQuote';
    case 'unmatched_parenthesis': return 'balanceParentheses';
    case 'empty_group': return 'fillGroup';
    case 'empty_or': return 'fillOr';
    case 'missing_term': return 'addTerm';
    case 'empty_field': return 'addFieldValue';
  }
}

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
  const parsed = parseSearchExpressionDetailed(expression);
  if (!parsed.ok) return [{ text: value, matched: false }];
  const terms: string[] = [];
  const collect = (node: SearchExpressionNode | null, negated = false) => {
    if (!node) return;
    if (node.kind === 'NOT') return collect(node.child, !negated);
    if (node.kind === 'TERM') {
      if (!negated && node.match === 'contains' && (node.field === null || node.field === field)) terms.push(node.value);
      return;
    }
    node.children.forEach((child) => collect(child, negated));
  };
  collect(parsed.expression.root);
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
