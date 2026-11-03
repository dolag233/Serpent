import type { SearchClause, SearchQuery } from './asset-types';

type Token = { kind: 'tag' | '&' | '|' | '!' | '-' | '(' | ')' | 'end'; value: string };
type Node = { kind: 'tag'; value: string } | { kind: 'not'; child: Node }
  | { kind: 'and' | 'or'; left: Node; right: Node };
const MAX_GROUPS = 32;
const MAX_CLAUSES = 32;

/** An explicit prefix keeps punctuation in ordinary filename searches literal. */
export function tagFormulaBody(value: string): string | null {
  const trimmed = value.trim();
  const chinese = /^标签\s*[:：]/u.exec(trimmed);
  if (chinese) return trimmed.slice(chinese[0].length);
  const english = /^tag-formula\s*:/iu.exec(trimmed);
  return english ? trimmed.slice(english[0].length) : null;
}

function tokenize(value: string): Token[] {
  if (value.length > 8192) throw new Error('标签公式过长，请缩短条件。');
  const tokens: Token[] = [];
  let position = 0;
  while (position < value.length) {
    const character = value[position]!;
    if (/\s/u.test(character)) { position++; continue; }
    if ('&|!-()'.includes(character)) {
      tokens.push({ kind: character as Token['kind'], value: character });
      position++;
      continue;
    }
    let name = '';
    if (character === '"') {
      position++;
      let closed = false;
      while (position < value.length) {
        const next = value[position++]!;
        if (next === '"') { closed = true; break; }
        if (next === '\\') {
          if (position === value.length) throw new Error('引号中的转义符后缺少字符。');
          name += value[position++]!;
        } else name += next;
      }
      if (!closed) throw new Error('标签名称缺少结束的双引号。');
    } else {
      while (position < value.length && !/[\s&|!()\-"]/u.test(value[position]!)) {
        name += value[position++]!;
      }
    }
    if (!name.trim()) throw new Error('标签名称不能为空。');
    if (name.length > 512) throw new Error('单个标签名称不能超过 512 个字符。');
    tokens.push({ kind: 'tag', value: name.trim() });
    if (tokens.length > 512) throw new Error('标签公式条件过多，请拆成较小的公式。');
  }
  tokens.push({ kind: 'end', value: '' });
  return tokens;
}

/** Parse a tag-only Boolean expression, then lower it to bounded SQL query groups. */
export function parseTagFormula(value: string): SearchQuery {
  const tokens = tokenize(value);
  let cursor = 0;
  let depth = 0;
  const peek = () => tokens[cursor]!;
  function unary(): Node {
    if (++depth > 64) throw new Error('标签公式嵌套过深。');
    try {
      const token = peek();
      if (token.kind === '!' || token.kind === '-') {
        cursor++;
        return { kind: 'not', child: unary() };
      }
      if (token.kind === '(') {
        cursor++;
        const result = expression();
        if (peek().kind !== ')') throw new Error('标签公式缺少右括号 )。');
        cursor++;
        return result;
      }
      if (token.kind !== 'tag') throw new Error('运算符后需要标签名称或括号条件。');
      cursor++;
      return { kind: 'tag', value: token.value };
    } finally { depth--; }
  }
  function conjunction(): Node {
    let left = unary();
    while (['&', '-', '!', 'tag', '('].includes(peek().kind)) {
      if (peek().kind === '&') cursor++;
      left = { kind: 'and', left, right: unary() };
    }
    return left;
  }
  function expression(): Node {
    let left = conjunction();
    while (peek().kind === '|') {
      cursor++;
      left = { kind: 'or', left, right: conjunction() };
    }
    return left;
  }
  if (peek().kind === 'end') throw new Error('请输入标签条件，例如：(A | B) & C - D。');
  const root = expression();
  if (peek().kind !== 'end') throw new Error('标签公式包含多余的右括号或运算符。');

  function lower(node: Node, negated = false): SearchClause[][] {
    if (node.kind === 'tag') return [[{ field: 'tags', values: [node.value], exclude: negated, exact: true }]];
    if (node.kind === 'not') return lower(node.child, !negated);
    const left = lower(node.left, negated);
    const right = lower(node.right, negated);
    const isAnd = (node.kind === 'and') !== negated;
    const groupCount = isAnd ? left.length * right.length : left.length + right.length;
    if (groupCount > MAX_GROUPS) throw new Error('标签公式组合过多，最多支持 32 个或分支，请简化条件。');
    if (!isAnd) return [...left, ...right];
    return left.flatMap((a) => right.map((b) => {
      const joined = [...a, ...b];
      if (joined.length > MAX_CLAUSES) throw new Error('单个分支最多支持 32 个标签条件。');
      return joined;
    }));
  }
  const groups = lower(root);
  return groups.length === 1 ? { clauses: groups[0]! } : { clauses: [], groups };
}
