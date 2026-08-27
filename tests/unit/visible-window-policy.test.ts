import { describe, expect, it } from 'vitest';

import {
  VISIBLE_WINDOW_PREEMPT_OVERLAP,
  isViewportOnlyThumbnailWave,
  shouldPreemptVisibleWindow,
  shouldRunThumbnailBackgroundRepair,
  visibleWindowOverlapRatio,
} from '../../src/worker/visible-window-policy';

describe('visible-window scheduling policy', () => {
  it('preempts on the first visible-window report', () => {
    expect(shouldPreemptVisibleWindow(undefined, ['a', 'b'])).toBe(true);
  });

  it('does not preempt for a geometry-only report with mostly the same cards', () => {
    expect(visibleWindowOverlapRatio(['a', 'b', 'c', 'd', 'e'], ['a', 'b', 'c', 'd', 'f']))
      .toBe(4 / 5);
    expect(shouldPreemptVisibleWindow(
      ['a', 'b', 'c', 'd', 'e'],
      ['a', 'b', 'c', 'd', 'f'],
    )).toBe(false);
  });

  it('preempts when navigation moves to a mostly different destination', () => {
    expect(visibleWindowOverlapRatio(['a', 'b', 'c', 'd'], ['x', 'y', 'c', 'z']))
      .toBe(1 / 4);
    expect(shouldPreemptVisibleWindow(
      ['a', 'b', 'c', 'd'],
      ['x', 'y', 'c', 'z'],
    )).toBe(true);
  });

  it('uses unique asset ids when calculating overlap', () => {
    expect(visibleWindowOverlapRatio(['a', 'a', 'b'], ['a', 'a', 'c'])).toBe(1 / 2);
    expect(VISIBLE_WINDOW_PREEMPT_OVERLAP).toBe(0.5);
  });

  it('preempts when the visible window changes between empty and non-empty', () => {
    expect(shouldPreemptVisibleWindow([], ['a'])).toBe(true);
    expect(shouldPreemptVisibleWindow(['a'], [])).toBe(true);
    expect(shouldPreemptVisibleWindow([], [])).toBe(false);
  });

  it('marks explicit and pending visible waves as viewport-only', () => {
    expect(isViewportOnlyThumbnailWave({ skipStaleRepair: true, assetIds: ['a'] })).toBe(true);
    expect(isViewportOnlyThumbnailWave({ pendingVisibleWindow: true })).toBe(true);
    expect(isViewportOnlyThumbnailWave({ skipStaleRepair: true })).toBe(false);
    expect(isViewportOnlyThumbnailWave({ assetIds: ['a'] })).toBe(false);
  });

  it('blocks both global repair tails until a normal wave is eligible', () => {
    expect(shouldRunThumbnailBackgroundRepair({
      viewportOnlyWave: true,
      queueWasAborted: false,
      continueImmediately: false,
    })).toBe(false);
    expect(shouldRunThumbnailBackgroundRepair({
      viewportOnlyWave: false,
      queueWasAborted: true,
      continueImmediately: false,
    })).toBe(false);
    expect(shouldRunThumbnailBackgroundRepair({
      viewportOnlyWave: false,
      queueWasAborted: false,
      continueImmediately: true,
    })).toBe(false);
    expect(shouldRunThumbnailBackgroundRepair({
      viewportOnlyWave: false,
      queueWasAborted: false,
      continueImmediately: false,
      visibleWavePending: true,
    })).toBe(false);
    expect(shouldRunThumbnailBackgroundRepair({
      viewportOnlyWave: false,
      queueWasAborted: false,
      continueImmediately: false,
    })).toBe(true);
  });
});
