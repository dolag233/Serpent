import { describe, expect, it } from 'vitest';

import {
  computeMarqueeSelection,
  isMarqueeAdditive,
  type MarqueeModifierSnapshot,
} from '../../src/renderer/marquee-selection';

const NONE: MarqueeModifierSnapshot = { metaKey: false, ctrlKey: false, shiftKey: false };
const META: MarqueeModifierSnapshot = { metaKey: true, ctrlKey: false, shiftKey: false };
const CTRL: MarqueeModifierSnapshot = { metaKey: false, ctrlKey: true, shiftKey: false };
const SHIFT: MarqueeModifierSnapshot = { metaKey: false, ctrlKey: false, shiftKey: true };
const META_SHIFT: MarqueeModifierSnapshot = { metaKey: true, ctrlKey: false, shiftKey: true };
const CTRL_SHIFT: MarqueeModifierSnapshot = { metaKey: false, ctrlKey: true, shiftKey: true };

describe('isMarqueeAdditive', () => {
  it('is false when no modifier is held', () => {
    expect(isMarqueeAdditive(NONE)).toBe(false);
  });

  it('is true for metaKey (macOS Command)', () => {
    expect(isMarqueeAdditive(META)).toBe(true);
  });

  it('is true for ctrlKey (Windows Ctrl)', () => {
    expect(isMarqueeAdditive(CTRL)).toBe(true);
  });

  it('is true for shiftKey alone', () => {
    expect(isMarqueeAdditive(SHIFT)).toBe(true);
  });

  it('is true for meta+shift and ctrl+shift combinations', () => {
    expect(isMarqueeAdditive(META_SHIFT)).toBe(true);
    expect(isMarqueeAdditive(CTRL_SHIFT)).toBe(true);
  });
});

describe('computeMarqueeSelection', () => {
  it('replaces with the hit set when no modifier is held', () => {
    const result = computeMarqueeSelection(['a', 'b'], ['c', 'd'], NONE);
    expect(result).toEqual(['c', 'd']);
  });

  it('replaces with an empty hit set when no modifier is held and nothing is hit', () => {
    const result = computeMarqueeSelection(['a', 'b'], [], NONE);
    expect(result).toEqual([]);
  });

  it('unions the initial selection with the hit set for metaKey (Command)', () => {
    const result = computeMarqueeSelection(['a', 'b'], ['b', 'c'], META);
    expect(new Set(result)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('unions the initial selection with the hit set for ctrlKey (Windows Ctrl)', () => {
    const result = computeMarqueeSelection(['a', 'b'], ['b', 'c'], CTRL);
    expect(new Set(result)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('unions the initial selection with the hit set for shiftKey', () => {
    const result = computeMarqueeSelection(['a'], ['b'], SHIFT);
    expect(new Set(result)).toEqual(new Set(['a', 'b']));
  });

  it('unions for Ctrl/Command+Shift combinations, matching the click model', () => {
    expect(new Set(computeMarqueeSelection(['a'], ['b'], META_SHIFT))).toEqual(
      new Set(['a', 'b']),
    );
    expect(new Set(computeMarqueeSelection(['a'], ['b'], CTRL_SHIFT))).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('does not duplicate ids already present in the initial selection', () => {
    const result = computeMarqueeSelection(['a', 'b'], ['a', 'b'], SHIFT);
    expect(result).toEqual(['a', 'b']);
  });

  it('keeps the initial selection when the additive hit set is empty', () => {
    const result = computeMarqueeSelection(['a', 'b'], [], SHIFT);
    expect(new Set(result)).toEqual(new Set(['a', 'b']));
  });
});
