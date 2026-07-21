/**
 * Discrete browse-canvas card sizes (Serpent-7ny / CANVAS-018).
 *
 * Stops are the pixel widths that pack N columns flush into the current
 * scrollport (minimal right-side leftover). Slider, pinch, and keyboard zoom
 * all move between these stops instead of continuous 2px steps.
 */

import {
  ASSET_GRID_GAP_PX,
  countFittingColumns,
} from "./asset-grid-layout";
import {
  CARD_SIZE_MAX,
  CARD_SIZE_MIN,
} from "./canvas-preferences";

/** Pinch/Ctrl+wheel gain: higher = fewer gestures to cross a stop (was 0.002). */
export const BROWSE_CARD_PINCH_GAIN = 0.01;

/**
 * Accumulated |deltaY| (pixel mode) that advances one discrete stop.
 * Lower threshold = more sensitive trackpad pinch.
 */
export const BROWSE_CARD_PINCH_STOP_DELTA = 28;

export function cardSizeFillingColumns(
  availableWidthPx: number,
  columnCount: number,
  gapPx: number = ASSET_GRID_GAP_PX,
): number {
  const columns = Math.max(1, Math.floor(columnCount));
  if (!(availableWidthPx > 0)) return CARD_SIZE_MIN;
  const raw = (availableWidthPx - (columns - 1) * gapPx) / columns;
  return Math.max(1, Math.floor(raw));
}

function clampCardSize(value: number): number {
  return Math.min(CARD_SIZE_MAX, Math.max(CARD_SIZE_MIN, Math.round(value)));
}

/**
 * Ascending unique sizes in `[min, max]` where each size packs a distinct
 * column count flush against `availableWidthPx`. Falls back to endpoints when
 * the scrollport is unknown or too narrow for multiple stops.
 */
export function enumerateDiscreteCardSizes(
  availableWidthPx: number,
  min: number = CARD_SIZE_MIN,
  max: number = CARD_SIZE_MAX,
  gapPx: number = ASSET_GRID_GAP_PX,
): number[] {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!(availableWidthPx > 0)) {
    return [lo, hi];
  }

  const maxColumns = countFittingColumns(availableWidthPx, lo, gapPx);
  const minColumns = countFittingColumns(availableWidthPx, hi, gapPx);
  const sizes = new Set<number>();

  for (let columns = maxColumns; columns >= minColumns; columns -= 1) {
    const candidate = clampCardSize(
      cardSizeFillingColumns(availableWidthPx, columns, gapPx),
    );
    if (candidate < lo || candidate > hi) continue;
    if (countFittingColumns(availableWidthPx, candidate, gapPx) === columns) {
      sizes.add(candidate);
    }
  }

  sizes.add(clampCardSize(lo));
  sizes.add(clampCardSize(hi));

  return [...sizes].sort((a, b) => a - b);
}

export function nearestDiscreteCardSize(
  requestedSize: number,
  stops: readonly number[],
): number {
  if (stops.length === 0) return clampCardSize(requestedSize);
  let best = stops[0]!;
  let bestDist = Math.abs(requestedSize - best);
  for (let i = 1; i < stops.length; i += 1) {
    const stop = stops[i]!;
    const dist = Math.abs(requestedSize - stop);
    if (dist < bestDist) {
      best = stop;
      bestDist = dist;
    }
  }
  return best;
}

export function indexOfDiscreteCardSize(
  size: number,
  stops: readonly number[],
): number {
  if (stops.length === 0) return 0;
  const nearest = nearestDiscreteCardSize(size, stops);
  const exact = stops.indexOf(nearest);
  return exact >= 0 ? exact : 0;
}

/**
 * Step one discrete stop. `direction` > 0 enlarges cards (fewer columns);
 * < 0 shrinks cards (more columns).
 */
export function stepDiscreteCardSize(
  currentSize: number,
  direction: 1 | -1,
  stops: readonly number[],
): number {
  if (stops.length === 0) return clampCardSize(currentSize);
  const index = indexOfDiscreteCardSize(currentSize, stops);
  const next = index + direction;
  if (next < 0) return stops[0]!;
  if (next >= stops.length) return stops[stops.length - 1]!;
  return stops[next]!;
}

/**
 * Map a continuous pinch/wheel delta onto the next discrete stop.
 * Positive `deltaY` (pinch-out / scroll-down convention in Chromium) shrinks
 * cards — same sign as the previous `Math.exp(-delta * gain)` path.
 *
 * Sensitivity (Serpent-7ny): higher gain + a modest |deltaY| floor that
 * forces a one-stop step when the continuous projection would otherwise
 * stay in the current stop's Voronoi cell.
 */
export function nextDiscreteCardSizeFromPinchDelta(
  currentSize: number,
  deltaY: number,
  stops: readonly number[],
  gain: number = BROWSE_CARD_PINCH_GAIN,
  stepDelta: number = BROWSE_CARD_PINCH_STOP_DELTA,
): number {
  if (stops.length === 0 || deltaY === 0) {
    return nearestDiscreteCardSize(currentSize, stops);
  }
  const currentStop = nearestDiscreteCardSize(currentSize, stops);
  const continuous = currentSize * Math.exp(-deltaY * gain);
  const projected = nearestDiscreteCardSize(continuous, stops);
  if (projected !== currentStop) {
    return projected;
  }
  if (Math.abs(deltaY) >= stepDelta) {
    return stepDiscreteCardSize(
      currentStop,
      deltaY > 0 ? -1 : 1,
      stops,
    );
  }
  return currentStop;
}
