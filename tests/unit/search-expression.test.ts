import { describe, expect, it } from 'vitest';
import { searchExpressionSchema } from '../../src/shared/asset-types';

import { formatDuration, parseNumericRange } from '../../src/renderer/App';
import { parseSearchExpression, parseSearchExpressionDetailed, splitSearchHighlights } from '../../src/renderer/search-expression';

describe('renderer search expression parser', () => {
  it('rejects exact tag nodes that claim another field at the protocol boundary', () => {
    expect(searchExpressionSchema.safeParse({ version: 1, root: {
      kind: 'TERM', field: 'filename', match: 'exact_tag', value: 'Forest',
    } }).success).toBe(false);
  });
  it('maps human field aliases and keeps a quoted phrase together', () => {
    expect(parseSearchExpression('name:"hero concept" tag:y2k').expression?.root).toEqual({
      kind: 'AND', children: [
        { kind: 'TERM', field: 'filename', match: 'contains', value: 'hero concept', quoted: true },
        { kind: 'TERM', field: 'tags', match: 'contains', value: 'y2k', quoted: false },
      ],
    });
  });

  it('treats whitespace as AND, pipe as OR, and minus as an exclusion', () => {
    expect(parseSearchExpression('tag:角色 -desc:草图 | author:Jane').expression?.root).toMatchObject({
      kind: 'OR', children: [
        { kind: 'AND', children: [
          { kind: 'TERM', field: 'tags', value: '角色' },
          { kind: 'NOT', child: { kind: 'TERM', field: 'description', value: '草图' } },
        ] },
        { kind: 'TERM', field: 'author', value: 'Jane' },
      ],
    });
  });

  it('keeps pipe and spaces literal inside a quoted phrase', () => {
    expect(parseSearchExpression('desc:"y2k | poster art"').expression?.root).toMatchObject({
      kind: 'TERM', field: 'description', value: 'y2k | poster art', quoted: true,
    });
  });

  it('does not reserve legacy NOT or OR words', () => {
    expect(parseSearchExpression('OR NOT').expression?.root).toMatchObject({ kind: 'AND', children: [
      { kind: 'TERM', value: 'OR' }, { kind: 'TERM', value: 'NOT' },
    ] });
  });

  it('honors grouping, exact tag membership, and field-specific legacy contains semantics', () => {
    expect(parseSearchExpressionDetailed('(tag=A | tag=B) tag=C -tag=D').expression?.root).toMatchObject({
      kind: 'AND', children: [
        { kind: 'OR', children: [
          { kind: 'TERM', field: 'tags', match: 'exact_tag', value: 'A' },
          { kind: 'TERM', field: 'tags', match: 'exact_tag', value: 'B' },
        ] },
        { kind: 'TERM', field: 'tags', match: 'exact_tag', value: 'C' },
        { kind: 'NOT', child: { kind: 'TERM', field: 'tags', match: 'exact_tag', value: 'D' } },
      ],
    });
    expect(parseSearchExpressionDetailed('tag:A').expression?.root).toMatchObject({ kind: 'TERM', match: 'contains', value: 'A' });
  });

  it('parses quoted tag names, escaped quotes, and parentheses inside words', () => {
    expect(parseSearchExpressionDetailed('-"带 空格标签"', 'tags').expression?.root).toMatchObject({
      kind: 'NOT', child: { kind: 'TERM', field: 'tags', match: 'exact_tag', value: '带 空格标签' },
    });
    expect(parseSearchExpressionDetailed('tag="带 空格标签"').expression?.root).toMatchObject({ kind: 'TERM', match: 'exact_tag', value: '带 空格标签' });
    expect(parseSearchExpressionDetailed('image(1).png').expression?.root).toMatchObject({ kind: 'TERM', value: 'image(1).png' });
  });

  it.each([
    ['"', 'unclosed_quote'], ['()', 'empty_group'], ['A || B', 'empty_or'], ['| A', 'empty_or'],
    ['A |', 'empty_or'], ['-', 'missing_term'], ['name:', 'empty_field'], ['""', 'empty_field'], ['image(1', 'unmatched_parenthesis'],
  ] as const)('reports invalid syntax %s', (text, code) => {
    const result = parseSearchExpressionDetailed(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.code).toBe(code);
  });

  it('keeps only matching visible filename spans highlighted', () => {
    expect(splitSearchHighlights('Y2K-reference.png', 'tag:y2k | name:reference', 'filename'))
      .toEqual([
        { text: 'Y2K-', matched: false },
        { text: 'reference', matched: true },
        { text: '.png', matched: false },
      ]);
  });
});

describe('renderer technical metadata formatting', () => {
  it('formats media duration for humans', () => {
    expect(formatDuration(5_000)).toBe('0:05');
    expect(formatDuration(65_999)).toBe('1:05');
    expect(formatDuration(3_665_000)).toBe('1:01:05');
  });

  it('creates scaled numeric ranges without string comparison syntax', () => {
    expect(parseNumericRange('1.5', '30', 1_000)).toEqual({ min: 1_500, max: 30_000 });
    expect(parseNumericRange('1.7', '1.8', 1, false)).toEqual({ min: 1.7, max: 1.8 });
    expect(parseNumericRange('', '')).toBeNull();
    expect(parseNumericRange('20', '10')).toBeNull();
  });
});
