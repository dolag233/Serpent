import { describe, expect, it } from 'vitest';

import { formatDuration, parseNumericRange } from '../../src/renderer/App';
import { parseSearchExpression, splitSearchHighlights } from '../../src/renderer/search-expression';

describe('renderer search expression parser', () => {
  it('maps human field aliases and keeps a quoted phrase together', () => {
    expect(parseSearchExpression('name:"hero concept" tag:y2k')).toEqual({
      clauses: [
        { field: 'filename', values: ['hero concept'], exclude: false },
        { field: 'tags', values: ['y2k'], exclude: false },
      ],
    });
  });

  it('treats whitespace as AND, pipe as OR, and minus as an exclusion', () => {
    expect(parseSearchExpression('tag:角色 -desc:草图 | author:Jane')).toEqual({
      clauses: [],
      groups: [
        [
          { field: 'tags', values: ['角色'], exclude: false },
          { field: 'description', values: ['草图'], exclude: true },
        ],
        [{ field: 'author', values: ['Jane'], exclude: false }],
      ],
    });
  });

  it('keeps pipe and spaces literal inside a quoted phrase', () => {
    expect(parseSearchExpression('desc:"y2k | poster art"')).toEqual({
      clauses: [
        { field: 'description', values: ['y2k | poster art'], exclude: false },
      ],
    });
  });

  it('does not reserve legacy NOT or OR words', () => {
    expect(parseSearchExpression('OR NOT')).toEqual({
      clauses: [
        { field: null, values: ['OR'], exclude: false },
        { field: null, values: ['NOT'], exclude: false },
      ],
    });
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
