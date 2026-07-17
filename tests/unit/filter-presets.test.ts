import { describe, expect, it } from 'vitest';

import {
  ASPECT_RATIO_PRESETS,
  ASPECT_RATIO_TOLERANCE,
  RESOLUTION_PRESETS,
  aspectRatioPresetRange,
  rangesEqual,
  togglePresetRange,
} from '../../src/renderer/filter-presets';

describe('aspect ratio presets (REQ-FILTER-009)', () => {
  it('offers the user-requested preset set in order', () => {
    expect(ASPECT_RATIO_PRESETS.map((preset) => preset.label)).toEqual([
      '16:9',
      '4:3',
      '1:1',
      '3:4',
      '9:16',
    ]);
  });

  it('maps a preset to a ±5% relative tolerance range at 3 decimals', () => {
    const wide = ASPECT_RATIO_PRESETS[0]!;
    const range = aspectRatioPresetRange(wide);
    expect(Number(range.min)).toBeCloseTo(wide.ratio * (1 - ASPECT_RATIO_TOLERANCE), 3);
    expect(Number(range.max)).toBeCloseTo(wide.ratio * (1 + ASPECT_RATIO_TOLERANCE), 3);
    expect(range.min).toBe('1.689');
    expect(range.max).toBe('1.867');
  });

  it('maps 1:1 symmetrically', () => {
    const square = ASPECT_RATIO_PRESETS.find((preset) => preset.label === '1:1')!;
    expect(aspectRatioPresetRange(square)).toEqual({ min: '0.950', max: '1.050' });
  });
});

describe('resolution presets (REQ-FILTER-010)', () => {
  it('defines 1K/2K/4K long-edge buckets', () => {
    expect(RESOLUTION_PRESETS).toEqual([
      { label: '1K', range: { min: '', max: '2239' } },
      { label: '2K', range: { min: '2240', max: '3199' } },
      { label: '4K', range: { min: '3200', max: '' } },
    ]);
  });
});

describe('preset toggle helpers', () => {
  it('rangesEqual compares min and max exactly', () => {
    expect(rangesEqual({ min: '1', max: '2' }, { min: '1', max: '2' })).toBe(true);
    expect(rangesEqual({ min: '1', max: '2' }, { min: '1', max: '' })).toBe(false);
  });

  it('togglePresetRange sets an inactive preset and clears an active one', () => {
    const preset = { min: '1.689', max: '1.867' };
    expect(togglePresetRange({ min: '', max: '' }, preset)).toEqual(preset);
    expect(togglePresetRange(preset, preset)).toEqual({ min: '', max: '' });
    // A custom range is replaced, not cleared.
    expect(togglePresetRange({ min: '2', max: '' }, preset)).toEqual(preset);
  });
});
