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
    expect(isMarqueeAdditive(NONE, 'mac')).toBe(false);
  });

  it('is true for metaKey on macOS', () => {
    expect(isMarqueeAdditive(META, 'mac')).toBe(true);
  });

  it('ignores ctrlKey on macOS (system context menu)', () => {
    expect(isMarqueeAdditive(CTRL, 'mac')).toBe(false);
  });

  it('is true for ctrlKey on Windows', () => {
    expect(isMarqueeAdditive(CTRL, 'windows')).toBe(true);
  });

  it('is true for shiftKey alone', () => {
    expect(isMarqueeAdditive(SHIFT, 'mac')).toBe(true);
  });

  it('is true for meta+shift and ctrl+shift combinations', () => {
    expect(isMarqueeAdditive(META_SHIFT, 'mac')).toBe(true);
    expect(isMarqueeAdditive(CTRL_SHIFT, 'windows')).toBe(true);
  });
});

describe('computeMarqueeSelection', () => {
  it('replaces with the hit set when no modifier is held', () => {
    const result = computeMarqueeSelection(['a', 'b'], ['c', 'd'], NONE, 'mac');
    expect(result).toEqual(['c', 'd']);
  });

  it('replaces with an empty hit set when no modifier is held and nothing is hit', () => {
    const result = computeMarqueeSelection(['a', 'b'], [], NONE, 'mac');
    expect(result).toEqual([]);
  });

  it('toggles the hit set against the initial selection for metaKey on macOS', () => {
    const result = computeMarqueeSelection(['a', 'b'], ['b', 'c'], META, 'mac');
    expect(new Set(result)).toEqual(new Set(['a', 'c']));
  });

  it('does not toggle for ctrlKey on macOS', () => {
    const result = computeMarqueeSelection(['a', 'b'], ['b', 'c'], CTRL, 'mac');
    expect(result).toEqual(['b', 'c']);
  });

  it('toggles the hit set against the initial selection for ctrlKey on Windows', () => {
    const result = computeMarqueeSelection(['a', 'b'], ['b', 'c'], CTRL, 'windows');
    expect(new Set(result)).toEqual(new Set(['a', 'c']));
  });

  it('unions the initial selection with the hit set for shiftKey', () => {
    const result = computeMarqueeSelection(['a'], ['b'], SHIFT, 'mac');
    expect(new Set(result)).toEqual(new Set(['a', 'b']));
  });

  it('unions for Ctrl/Command+Shift combinations, with Shift taking precedence', () => {
    expect(new Set(computeMarqueeSelection(['a'], ['b'], META_SHIFT, 'mac'))).toEqual(
      new Set(['a', 'b']),
    );
    expect(
      new Set(computeMarqueeSelection(['a'], ['b'], CTRL_SHIFT, 'windows')),
    ).toEqual(new Set(['a', 'b']));
  });

  it('does not duplicate ids already present in the initial selection', () => {
    const result = computeMarqueeSelection(['a', 'b'], ['a', 'b'], SHIFT, 'mac');
    expect(result).toEqual(['a', 'b']);
  });

  it('keeps the initial selection when the additive hit set is empty', () => {
    const result = computeMarqueeSelection(['a', 'b'], [], SHIFT, 'mac');
    expect(new Set(result)).toEqual(new Set(['a', 'b']));
  });
});
