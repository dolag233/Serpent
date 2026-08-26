/**
 * A visible-window report is emitted while the renderer is still settling its
 * geometry. Those reports may contain a slightly different set of cards even
 * though the user is looking at the same destination. Repeatedly preempting a
 * decode wave for that kind of report creates cancellation churn and delays
 * the actual visible media.
 */

/**
 * A destination change below this overlap is treated as a real navigation and
 * is allowed to preempt media outside the new viewport.
 */
export const VISIBLE_WINDOW_PREEMPT_OVERLAP = 0.5;

export function visibleWindowOverlapRatio(
  previous: readonly string[],
  next: readonly string[],
): number {
  const previousIds = new Set(previous);
  const nextIds = new Set(next);
  if (previousIds.size === 0 || nextIds.size === 0) return 0;

  let common = 0;
  for (const assetId of nextIds) {
    if (previousIds.has(assetId)) common += 1;
  }
  return common / Math.min(previousIds.size, nextIds.size);
}

export function shouldPreemptVisibleWindow(
  previous: readonly string[] | undefined,
  next: readonly string[],
): boolean {
  if (previous === undefined) return true;
  if (previous.length === 0 || next.length === 0) {
    return previous.length !== next.length;
  }
  return visibleWindowOverlapRatio(previous, next) < VISIBLE_WINDOW_PREEMPT_OVERLAP;
}

/**
 * Explicit viewport waves are allowed to service only the reported ids. A
 * pending wave has the same restriction even when it arrived while a
 * background queue was already active: it must not inherit the queue's
 * whole-library repair tail.
 */
export function isViewportOnlyThumbnailWave(input: {
  skipStaleRepair?: boolean;
  assetIds?: readonly string[];
  pendingVisibleWindow?: boolean;
}): boolean {
  return input.pendingVisibleWindow === true
    || (input.skipStaleRepair === true && input.assetIds !== undefined);
}

/** Keep global fill and dimension backfill out of an explicit visible wave. */
export function shouldRunThumbnailBackgroundRepair(input: {
  viewportOnlyWave: boolean;
  queueWasAborted: boolean;
  continueImmediately: boolean;
}): boolean {
  return !input.viewportOnlyWave
    && !input.queueWasAborted
    && !input.continueImmediately;
}
