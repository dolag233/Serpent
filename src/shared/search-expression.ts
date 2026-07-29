import type { SearchQuery } from './asset-types';

const SEARCH_FIELD_ALIASES: Record<
  string,
  SearchQuery['clauses'][number]['field']
> = {
  name: 'filename',
  filename: 'filename',
  tag: 'tags',
  tags: 'tags',
  desc: 'description',
  description: 'description',
  link: 'source_url',
  url: 'source_url',
  source: 'source_url',
  source_url: 'source_url',
  author: 'author',
  path: 'folder_path',
  folder: 'folder_path',
  folder_path: 'folder_path',
  meta: 'metadata_text',
  metadata: 'metadata_text',
  metadata_text: 'metadata_text',
};

function tokenizeSearchExpression(value: string): Array<string | '|'> {
  const tokens: Array<string | '|'> = [];
  let current = '';
  let inQuotes = false;
  let escaped = false;
  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) tokens.push(trimmed);
    current = '';
  };
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && character === '|') {
      pushCurrent();
      tokens.push('|');
      continue;
    }
    if (!inQuotes && /\s/u.test(character)) {
      pushCurrent();
      continue;
    }
    current += character;
  }
  if (escaped) current += '\\';
  pushCurrent();
  return tokens;
}

/**
 * Parse the small public search syntax used by the toolbar and Script API.
 * Whitespace is AND, `|` separates alternatives, a leading `-` excludes,
 * and field aliases scope a term. Quotes preserve spaces and `|`.
 */
export function parseSearchExpression(value: string): SearchQuery {
  const groups: SearchQuery['clauses'][] = [[]];
  for (const rawToken of tokenizeSearchExpression(value)) {
    if (rawToken === '|') {
      if (groups.at(-1)!.length > 0) groups.push([]);
      continue;
    }
    let token = rawToken;
    const exclude = token.startsWith('-');
    if (exclude) token = token.slice(1);
    const separator = token.indexOf(':');
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
