import { describe, expect, it } from 'vitest';

import {
  assertRegisteredHistoryRecipePair,
  historyRecipeDescriptor,
  registeredHistoryRecipeKinds,
} from '../../src/worker/operation-history-recipes';

describe('operation history recipe registry', () => {
  it('registers a bidirectional descriptor for every recipe kind', () => {
    for (const kind of registeredHistoryRecipeKinds()) {
      const descriptor = historyRecipeDescriptor(kind);
      expect(descriptor).toBeDefined();
      expect(descriptor?.version).toBe(1);
      expect(historyRecipeDescriptor(descriptor!.inverseKind)).toBeDefined();
    }
  });

  it('rejects an unregistered or mismatched pair', () => {
    expect(() => assertRegisteredHistoryRecipePair(
      { kind: 'unknown-history-recipe', version: 1, payload: {} },
      { kind: 'asset-trash', version: 1, payload: {} },
    )).toThrow(/not registered/);
  });
});
