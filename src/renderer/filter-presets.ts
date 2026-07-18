// ---------------------------------------------------------------------------
// Filter dimension presets (REQ-FILTER-009 / REQ-FILTER-010)
//
// Pure preset definitions and range mappers for the discovery filter panel:
// aspect-ratio chips map to a ±5% relative tolerance range (matching the
// Wave-2 spec), resolution chips map to long-edge buckets (1K < 2240 ≤
// 2K < 3200 ≤ 4K). Custom min/max inputs stay available beside the chips;
// a chip is "active" when the current range string pair exactly matches the
// preset's, and clicking an active chip clears the range.
// ---------------------------------------------------------------------------

export interface RangeStrings {
  min: string;
  max: string;
}

export interface AspectRatioPreset {
  readonly label: string;
  readonly ratio: number;
}

export const ASPECT_RATIO_TOLERANCE = 0.05;

export const ASPECT_RATIO_PRESETS: readonly AspectRatioPreset[] = [
  { label: '16:9', ratio: 16 / 9 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '1:1', ratio: 1 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '9:16', ratio: 9 / 16 },
];

/** Orientation chips for the Eagle-style shape popover (横图 / 竖图). */
export const ORIENTATION_PRESETS: readonly {
  readonly id: 'landscape' | 'portrait';
  readonly range: RangeStrings;
}[] = [
  { id: 'landscape', range: { min: '1.05', max: '' } },
  { id: 'portrait', range: { min: '', max: '0.95' } },
];

/** ±5% relative tolerance around the preset ratio, rounded to 3 decimals. */
export function aspectRatioPresetRange(preset: AspectRatioPreset): RangeStrings {
  return {
    min: (preset.ratio * (1 - ASPECT_RATIO_TOLERANCE)).toFixed(3),
    max: (preset.ratio * (1 + ASPECT_RATIO_TOLERANCE)).toFixed(3),
  };
}

export interface ResolutionPreset {
  readonly label: string;
  readonly range: RangeStrings;
}

/**
 * Long-edge buckets (see Wave-2 spec): 1K = long edge < 2240, 2K = [2240,
 * 3200), 4K = ≥ 3200. Empty string = open bound.
 */
export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { label: '1K', range: { min: '', max: '2239' } },
  { label: '2K', range: { min: '2240', max: '3199' } },
  { label: '4K', range: { min: '3200', max: '' } },
];

export function rangesEqual(a: RangeStrings, b: RangeStrings): boolean {
  return a.min === b.min && a.max === b.max;
}

/**
 * Toggle a preset against the current range: returns the preset range when
 * inactive, or an empty range when the preset was already active (clear).
 */
export function togglePresetRange(
  current: RangeStrings,
  preset: RangeStrings,
): RangeStrings {
  return rangesEqual(current, preset) ? { min: '', max: '' } : preset;
}
