import { describe, expect, it } from 'vitest';

import { normalizeAutomationAssetSearchInput } from '../../src/main/normalize-automation-asset-search-input';

describe('normalizeAutomationAssetSearchInput', () => {
  it('accepts null query and optional pagination', () => {
    expect(normalizeAutomationAssetSearchInput({ query: null, limit: 1 })).toEqual({
      query: null,
      limit: 1,
    });
  });

  it('parses toolbar text into a SearchQuery AST', () => {
    const normalized = normalizeAutomationAssetSearchInput({ query: 'name:probe', limit: 5 }) as {
      limit: number;
      query: { clauses: Array<{ field: string }> } | null;
    };
    expect(normalized.limit).toBe(5);
    expect(normalized.query?.clauses[0]?.field).toBeTruthy();
  });

  it('rejects non-search payloads', () => {
    expect(normalizeAutomationAssetSearchInput({ query: { not: 'a string' } })).toBeUndefined();
    expect(normalizeAutomationAssetSearchInput(null)).toBeUndefined();
  });
});
