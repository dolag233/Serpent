import type { SearchClause, SearchExpressionNode, SearchQuery } from './asset-types';

export type SearchExpressionContext = 'search' | 'tags';
export type SearchExpressionDiagnostic = {
  code: 'too_long' | 'too_many_terms' | 'too_deep' | 'unclosed_quote' | 'unmatched_parenthesis' | 'empty_group' | 'empty_or' | 'missing_term' | 'empty_field';
  message: string;
  start: number;
  end: number;
};
export type SearchExpressionResult =
  | { ok: true; expression: { version: 1; root: SearchExpressionNode | null }; diagnostic: null }
  | { ok: false; expression: null; diagnostic: SearchExpressionDiagnostic };

const SEARCH_FIELD_ALIASES: Record<string, SearchClause['field']> = {
  name: 'filename', filename: 'filename', tag: 'tags', tags: 'tags',
  desc: 'description', description: 'description', link: 'source_url',
  url: 'source_url', source: 'source_url', source_url: 'source_url', author: 'author',
  path: 'folder_path', folder: 'folder_path', folder_path: 'folder_path',
  meta: 'metadata_text', metadata: 'metadata_text', metadata_text: 'metadata_text',
};
const TAG_ALIASES = new Set(['tag', 'tags']);
type Token = { kind: 'word' | 'or' | 'open' | 'close' | 'minus'; value?: string; quoted?: boolean; start: number; end: number };

function diagnostic(code: SearchExpressionDiagnostic['code'], message: string, start: number, end: number): SearchExpressionResult {
  return { ok: false, expression: null, diagnostic: { code, message, start, end } };
}

function tokenize(source: string): { tokens?: Token[]; error?: SearchExpressionResult } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/u.test(source[i]!)) { i += 1; continue; }
    const start = i;
    const char = source[i]!;
    if (char === '|') { tokens.push({ kind: 'or', start, end: ++i }); continue; }
    if (char === '(') { tokens.push({ kind: 'open', start, end: ++i }); continue; }
    if (char === ')') { tokens.push({ kind: 'close', start, end: ++i }); continue; }
    if (char === '-' && (i === 0 || /\s|[|(]/u.test(source[i - 1]!))) {
      tokens.push({ kind: 'minus', start, end: ++i }); continue;
    }
    let value = '';
    let quoted = false;
    let hadQuote = false;
    let wordParenDepth = 0;
    while (i < source.length) {
      const current = source[i]!;
      if (current === '"') { quoted = !quoted; hadQuote = true; i += 1; continue; }
      if (quoted && current === '\\') {
        const next = source[i + 1];
        if (next === '"' || next === '\\') { value += next; i += 2; continue; }
        value += current; i += 1; continue;
      }
      if (!quoted && current === '\\' && i + 1 < source.length && /[|()"\\]/u.test(source[i + 1]!)) {
        value += source[i + 1]!; i += 2; continue;
      }
      if (!quoted && (/\s/u.test(current) || current === '|')) break;
      if (!quoted && current === '(' && value.length === 0) break;
      if (!quoted && current === '(') wordParenDepth += 1;
      if (!quoted && current === ')' && wordParenDepth === 0) break;
      if (!quoted && current === ')' && wordParenDepth > 0) wordParenDepth -= 1;
      value += current; i += 1;
    }
    if (quoted) return { error: diagnostic('unclosed_quote', 'Close the quotation mark.', start, source.length) };
    if (wordParenDepth > 0) return { error: diagnostic('unmatched_parenthesis', 'Close this word with ).', start, i) };
    if (value.length > 0 || hadQuote) tokens.push({ kind: 'word', value, quoted: hadQuote, start, end: i });
  }
  return { tokens };
}

export function parseSearchExpressionDetailed(source: string, context: SearchExpressionContext = 'search'): SearchExpressionResult {
  if (source.length > 512) return diagnostic('too_long', 'Expression is limited to 512 characters.', 512, source.length);
  const scanned = tokenize(source);
  if (scanned.error) return scanned.error;
  const tokens = scanned.tokens ?? [];
  let cursor = 0;
  let termCount = 0;
  let depth = 0;
  const fail = (code: SearchExpressionDiagnostic['code'], message: string, token?: Token): SearchExpressionResult =>
    diagnostic(code, message, token?.start ?? source.length, token?.end ?? source.length);
  const term = (token: Token): SearchExpressionNode | null => {
    const raw = token.value ?? '';
    const separator = raw.indexOf(':');
    const equal = raw.indexOf('=');
    const isEqual = equal > 0 && (separator < 0 || equal < separator);
    const split = isEqual ? equal : separator;
    const alias = split > 0 ? raw.slice(0, split).toLowerCase() : '';
    const suffix = split > 0 ? raw.slice(split + 1) : raw;
    const knownField = isEqual ? TAG_ALIASES.has(alias) : Object.hasOwn(SEARCH_FIELD_ALIASES, alias);
    if (knownField && !suffix) return null;
    let field: SearchClause['field'] = null;
    let match: 'contains' | 'exact_tag' = 'contains';
    let value = raw;
    if (knownField) {
      if (context === 'tags' && !TAG_ALIASES.has(alias)) return null;
      field = isEqual ? 'tags' : SEARCH_FIELD_ALIASES[alias]!;
      value = suffix;
      if (isEqual || (context === 'tags' && !alias) || (context === 'tags' && alias === 'tag' && isEqual)) match = 'exact_tag';
    } else if (context === 'tags') {
      if (split > 0 && alias.length > 0 && TAG_ALIASES.has(alias)) {
        field = 'tags'; value = suffix;
      } else if (split > 0 && Object.hasOwn(SEARCH_FIELD_ALIASES, alias)) return null;
      else { field = 'tags'; match = 'exact_tag'; }
    }
    if (!value) return null;
    termCount += 1;
    if (termCount > 32) return null;
    return { kind: 'TERM', field, match, value, quoted: token.quoted === true };
  };
  const parsePrimary = (): SearchExpressionNode | SearchExpressionResult | null => {
    const token = tokens[cursor];
    if (!token) return fail('missing_term', 'Add a term after this operator.');
    if (token.kind === 'open') {
      if (++depth > 8) return fail('too_deep', 'Groups can be nested up to 8 levels.', token);
      cursor += 1;
      if (tokens[cursor]?.kind === 'close') return fail('empty_group', 'Add a term inside the group.', token);
      const nested = parseOr();
      if (isResult(nested)) return nested;
      if (tokens[cursor]?.kind !== 'close') return fail('unmatched_parenthesis', 'Close this group with ).', token);
      cursor += 1; depth -= 1;
      return nested;
    }
    if (token.kind === 'word') {
      cursor += 1;
      if (termCount >= 32) return fail('too_many_terms', 'Expression is limited to 32 terms.', token);
      const parsed = term(token);
      if (!parsed) return fail('empty_field', context === 'tags' ? 'Only tag names can be combined here.' : 'Add a value after the field name.', token);
      return parsed;
    }
    return fail(token.kind === 'close' ? 'unmatched_parenthesis' : 'missing_term', 'Add a term here.', token);
  };
  const parseUnary = (): SearchExpressionNode | SearchExpressionResult | null => {
    if (tokens[cursor]?.kind === 'minus') {
      const token = tokens[cursor++]!;
      if (!tokens[cursor] || ['or', 'close'].includes(tokens[cursor]!.kind)) return fail('missing_term', 'Add a term after -.', token);
      const child = parseUnary();
      return isResult(child) ? child : { kind: 'NOT', child: child! };
    }
    return parsePrimary();
  };
  const parseAnd = (): SearchExpressionNode | SearchExpressionResult | null => {
    const left = parseUnary();
    if (isResult(left)) return left;
    const nodes: SearchExpressionNode[] = [left!];
    while (cursor < tokens.length && ['word', 'open', 'minus'].includes(tokens[cursor]!.kind)) {
      const next = parseUnary();
      if (isResult(next)) return next;
      nodes.push(next!);
    }
    return nodes.length === 1 ? nodes[0]! : { kind: 'AND', children: nodes };
  };
  const parseOr = (): SearchExpressionNode | SearchExpressionResult | null => {
    if (tokens[cursor]?.kind === 'or') return fail('empty_or', 'Add a term on both sides of |.', tokens[cursor]);
    const left = parseAnd();
    if (isResult(left)) return left;
    const nodes: SearchExpressionNode[] = [left!];
    while (tokens[cursor]?.kind === 'or') {
      const operator = tokens[cursor++]!;
      if (!tokens[cursor] || ['or', 'close'].includes(tokens[cursor]!.kind)) return fail('empty_or', 'Add a term on both sides of |.', operator);
      const right = parseAnd();
      if (isResult(right)) return right;
      nodes.push(right!);
    }
    return nodes.length === 1 ? nodes[0]! : { kind: 'OR', children: nodes };
  };
  const isResult = (value: unknown): value is SearchExpressionResult =>
    Boolean(value && typeof value === 'object' && 'ok' in value);
  if (!tokens.length) return { ok: true, expression: { version: 1, root: null }, diagnostic: null };
  const root = parseOr();
  if (isResult(root)) return root;
  if (cursor < tokens.length) return fail(tokens[cursor]!.kind === 'close' ? 'unmatched_parenthesis' : 'missing_term', 'Check this part of the expression.', tokens[cursor]);
  if (termCount > 32) return fail('too_many_terms', 'Expression is limited to 32 terms.');
  return { ok: true, expression: { version: 1, root }, diagnostic: null };
}

function legacyQuery(node: SearchExpressionNode | null): SearchQuery {
  const clauses: SearchQuery['clauses'] = [];
  if (!node) return { clauses, expression: { version: 1, root: null } };
  return { clauses, expression: { version: 1, root: node } };
}

/** Parse the shared text syntax. Invalid partial input keeps an empty query; UI callers should use the detailed API. */
export function parseSearchExpression(value: string): SearchQuery {
  const result = parseSearchExpressionDetailed(value, 'search');
  return legacyQuery(result.ok ? result.expression.root : null);
}
