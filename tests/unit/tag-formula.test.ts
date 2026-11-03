import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { parseSearchExpression } from '../../src/shared/search-expression';
import { searchQuerySchema } from '../../src/shared/asset-types';
import { parseTagFormula } from '../../src/shared/tag-formula';
import { searchExpressionError, splitSearchHighlights } from '../../src/renderer/search-expression';
import { buildCatalogContextualSearchWhere, buildCatalogContextualSearchRank } from '../../src/worker/catalog-read';
import { canUseTrigramSearch } from '../../src/worker/search-query';
import { normalizeAutomationAssetSearchInput } from '../../src/main/normalize-automation-asset-search-input';

function matches(formula: string, names: string[]): boolean {
  const query = parseTagFormula(formula);
  return (query.groups ?? [query.clauses]).some((group) => group.every((clause) =>
    names.includes(clause.values[0]!) !== clause.exclude));
}

describe('tag Boolean formula', () => {
  it('implements the requested formula for every combination of four tags', () => {
    for (let mask = 0; mask < 16; mask++) {
      const names = ['A', 'B', 'C', 'D'].filter((_, i) => mask & (1 << i));
      const expected = (names.includes('A') || names.includes('B')) && names.includes('C') && !names.includes('D');
      expect(matches('(A | B) & C - D', names)).toBe(expected);
    }
  });
  it('supports nested NOT, whitespace conjunction and operator precedence', () => {
    expect(matches('!(A | B) & (C | !D)', ['C'])).toBe(true);
    expect(matches('!(A | B) & (C | !D)', ['B', 'C'])).toBe(false);
    expect(matches('A | B & C', ['A'])).toBe(true);
    expect(matches('A | B & C', ['B'])).toBe(false);
    expect(matches('!!A C -D', ['A', 'C'])).toBe(true);
    expect(matches('!(A & B)', ['A'])).toBe(true);
  });
  it('supports Chinese and quoted names with literal punctuation and escaping', () => {
    expect(matches('"科幻-角色" & ("A | B" | 城市) - "待 处理"', ['科幻-角色', '城市'])).toBe(true);
    expect(parseTagFormula('"a\\"b"').clauses[0]!.values).toEqual(['a"b']);
  });
  it('only enables formulas with an explicit prefix and validates the IPC schema', () => {
    expect(parseSearchExpression('标签:(A | B) & C - D')).toEqual(parseTagFormula('(A | B) & C - D'));
    expect(parseSearchExpression('tag-formula:(A | B) & C')).toEqual(parseTagFormula('(A | B) & C'));
    expect(parseSearchExpression(' TAG-FORMULA : !A & B')).toEqual(parseTagFormula('!A & B'));
    expect(parseSearchExpression('name:"(A&B).png"').clauses[0]!.values).toEqual(['(A&B).png']);
    expect(parseSearchExpression('tag:A').clauses[0]).not.toHaveProperty('exact');
    expect(searchQuerySchema.safeParse(parseSearchExpression('标签:(A | B) & C - D')).success).toBe(true);
  });
  it('preserves existing tag aliases and parentheses as literal ordinary-search text', () => {
    const expected = {
      clauses: [
        { field: 'tags', values: ['(A)'], exclude: false },
        { field: 'filename', values: ['hero'], exclude: false },
      ],
    };
    expect(parseSearchExpression('tags:(A) name:hero')).toEqual(expected);
    expect(parseSearchExpression('tag:(A) name:hero')).toEqual(expected);
    expect(parseSearchExpression('tags:"(A)" name:hero')).toEqual(expected);
    expect(parseSearchExpression('tags:(A)')).toEqual({ clauses: [expected.clauses[0]] });
  });
  it.each(['', 'A &', '(A | B', 'A)', 'A || B', '()', '"A', '""'])('rejects incomplete formula %j', (formula) => {
    expect(() => parseTagFormula(formula)).toThrow();
  });
  it('bounds combinatorial expansion, depth and length', () => {
    expect(() => parseTagFormula(Array.from({ length: 6 }, (_, n) => `(A${n}|B${n})`).join('&'))).toThrow(/32/);
    expect(() => parseTagFormula('('.repeat(70) + 'A' + ')'.repeat(70))).toThrow(/嵌套/);
    expect(() => parseTagFormula('a'.repeat(9000))).toThrow(/过长/);
  });
  it('keeps rendering safe during editing and provides an error message', () => {
    expect(searchExpressionError('标签:(A |')).toBeTruthy();
    expect(splitSearchHighlights('example.png', '标签:(A |', 'filename')).toEqual([{ text: 'example.png', matched: false }]);
    expect(normalizeAutomationAssetSearchInput({ query: '标签:(A |' })).toBeUndefined();
  });
  it('does not generate an oversized relevance function for a maximum-size formula', () => {
    const branches = Array.from({ length: 32 }, (_, i) => `A${i}`).join('|');
    const conditions = Array.from({ length: 31 }, (_, i) => `B${i}`).join('&');
    const query = parseTagFormula(`(${branches}) & ${conditions}`);
    expect(query.groups).toHaveLength(32);
    expect(buildCatalogContextualSearchRank(query.groups!)).toEqual({ sql: '', params: [] });
  });
  it('executes exact-name SQL with exclusions, AI tags and bound literal values', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE assets(asset_id TEXT); CREATE TABLE tags(tag_id TEXT,name TEXT);
        CREATE TABLE human_asset_tags(asset_id TEXT,tag_id TEXT); CREATE TABLE ai_asset_tags(asset_id TEXT,tag_id TEXT);
        INSERT INTO assets VALUES ('yes'),('ai'),('partial'),('excluded'),('untagged');
        INSERT INTO tags VALUES ('a','Alpha'),('c','城市'),('d','草稿'),('p','Alpha-long');
        INSERT INTO human_asset_tags VALUES ('yes','a'),('yes','c'),('partial','p'),('partial','c'),
          ('excluded','a'),('excluded','c'),('excluded','d'),('ai','c');
        INSERT INTO ai_asset_tags VALUES ('ai','a');`);
      const query = parseTagFormula('Alpha & 城市 - 草稿');
      const groups = query.groups ?? [query.clauses];
      const where = buildCatalogContextualSearchWhere(groups);
      expect(db.prepare(`SELECT a.asset_id FROM assets a WHERE ${where.sql} ORDER BY a.asset_id`).all(...where.params)
        .map((row) => row.asset_id)).toEqual(['ai', 'yes']);
      const negative = parseTagFormula('!Alpha');
      const negativeWhere = buildCatalogContextualSearchWhere([negative.clauses]);
      expect(db.prepare(`SELECT a.asset_id FROM assets a WHERE ${negativeWhere.sql} ORDER BY a.asset_id`).all(...negativeWhere.params)
        .map((row) => row.asset_id)).toEqual(['partial', 'untagged']);
      expect(canUseTrigramSearch(groups)).toBe(false);
      const literal = buildCatalogContextualSearchWhere([parseTagFormula('"x\' OR 1=1 --"').clauses]);
      expect(literal.sql).not.toContain("x' OR");
      expect(db.prepare(`SELECT a.asset_id FROM assets a WHERE ${literal.sql}`).all(...literal.params)).toEqual([]);
      db.exec('DROP TABLE ai_asset_tags');
      const humanOnly = buildCatalogContextualSearchWhere(groups, false, false);
      expect(db.prepare(`SELECT a.asset_id FROM assets a WHERE ${humanOnly.sql}`).all(...humanOnly.params)
        .map((row) => row.asset_id)).toEqual(['yes']);
      const withoutSearchIndex = buildCatalogContextualSearchWhere(groups, true, false);
      expect(db.prepare(`SELECT a.asset_id FROM assets a WHERE ${withoutSearchIndex.sql}`).all(...withoutSearchIndex.params)
        .map((row) => row.asset_id)).toEqual(['yes']);
      const negativeWithoutIndex = buildCatalogContextualSearchWhere([negative.clauses], true, false);
      expect(db.prepare(`SELECT a.asset_id FROM assets a WHERE ${negativeWithoutIndex.sql} ORDER BY a.asset_id`).all(...negativeWithoutIndex.params)
        .map((row) => row.asset_id)).toEqual(['ai', 'partial', 'untagged']);
    } finally { db.close(); }
  });
});
