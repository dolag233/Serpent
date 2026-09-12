import { isPrimarilyHorizontalWheel } from "./viewer-wheel-intent";

/** WheelEvent.deltaMode: 0 = pixel, 1 = line, 2 = page. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_PX = 16;

export type TabStripWheelSample = {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
};

/**
 * Convert a wheel/trackpad gesture over the tab strip into a horizontal
 * scroll delta. Vertical mouse notches and two-finger pans both move the
 * strip sideways. Ctrl/Cmd+wheel (pinch) is left alone unless Chromium
 * tagged a horizontal two-finger slide with ctrlKey (Serpent-4kg3).
 */
export function horizontalScrollDeltaFromWheel(
  sample: TabStripWheelSample,
  pagePx: number,
): number | null {
  if ((sample.ctrlKey || sample.metaKey) && !isPrimarilyHorizontalWheel(sample)) {
    return null;
  }
  let dx = sample.deltaX;
  let dy = sample.deltaY;
  if (sample.deltaMode === DOM_DELTA_LINE) {
    dx *= LINE_PX;
    dy *= LINE_PX;
  } else if (sample.deltaMode === DOM_DELTA_PAGE) {
    dx *= pagePx;
    dy *= pagePx;
  }
  if (dx === 0 && dy === 0) return 0;
  return Math.abs(dx) >= Math.abs(dy) ? dx : dy;
}

export function nextTabStripScrollLeft(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  delta: number,
): number {
  const max = Math.max(0, scrollWidth - clientWidth);
  return Math.min(max, Math.max(0, scrollLeft + delta));
}
