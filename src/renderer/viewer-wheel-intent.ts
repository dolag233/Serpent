/**
 * Classify a wheel event on the viewer stage as a zoom or a pan intent
 * (Serpent-yo0n / Serpent-4kg3).
 *
 * A physical mouse wheel should zoom (anchored at the pointer); a trackpad
 * two-finger scroll should keep panning, and a trackpad pinch should zoom.
 * Browsers do not expose the device directly, so this uses the standard
 * heuristic stack:
 *
 * - ctrlKey/metaKey: Chromium reports trackpad pinch gestures as wheel
 *   events with ctrlKey set; Ctrl+wheel is also the explicit zoom chord.
 *   Exception (Serpent-4kg3): when the delta is primarily horizontal,
 *   Chromium sometimes still sets ctrlKey during a two-finger slide.
 *   Those events must pan/swipe, not zoom — real pinch and Ctrl+wheel
 *   produce a dominant vertical delta.
 * - deltaMode LINE/PAGE: only discrete devices (mouse wheels) report
 *   non-pixel modes.
 * - Fractional pixel deltas: only high-resolution trackpads produce
 *   sub-pixel values.
 * - Large integer pixel deltas (>= MOUSE_NOTCH_THRESHOLD): Chrome reports a
 *   mouse notch as roughly 100–150px per tick; trackpad scroll deltas are
 *   smaller and continuous.
 *
 * Known trade-off: a mouse with driver-level smooth scrolling (small pixel
 * deltas) is read as a trackpad and pans instead of zooming. The threshold
 * is exported so tests document the boundary.
 *
 * Serpent-6k1: a strictly-vertical INTEGER pixel wheel is always a mouse
 * wheel (trackpad two-finger scroll is fractional and/or diagonal), so it
 * zooms regardless of magnitude — this is what makes a plain mouse wheel zoom
 * on macOS, where Chromium reports the notch as small integer pixels rather
 * than the ~120px it reports on Windows.
 */
export type ViewerWheelIntent = "zoom" | "pan";

export interface ViewerWheelSample {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly deltaX: number;
  readonly deltaY: number;
  /** WheelEvent.deltaMode: 0 = pixel, 1 = line, 2 = page. */
  readonly deltaMode: number;
}

export const VIEWER_WHEEL_MOUSE_NOTCH_THRESHOLD = 40;

/**
 * |deltaX| must exceed |deltaY| by this factor to count as a horizontal
 * slide rather than a pinch / vertical zoom chord (Serpent-4kg3).
 * Matches the viewer flick dominance used for prev/next at fit scale.
 */
export const VIEWER_WHEEL_HORIZONTAL_DOMINANCE_RATIO = 2;

const DOM_DELTA_PIXEL = 0;

/**
 * True when the wheel delta is clearly a horizontal slide (pan / swipe),
 * not a vertical scroll or pinch scale change.
 */
export function isPrimarilyHorizontalWheel(
  sample: Pick<ViewerWheelSample, "deltaX" | "deltaY">,
): boolean {
  const absX = Math.abs(sample.deltaX);
  const absY = Math.abs(sample.deltaY);
  return absX > absY * VIEWER_WHEEL_HORIZONTAL_DOMINANCE_RATIO;
}

export function classifyViewerWheel(
  sample: ViewerWheelSample,
): ViewerWheelIntent {
  if (sample.ctrlKey || sample.metaKey) {
    // Pinch / Ctrl|Cmd+wheel zoom — but not when Chromium tagged a
    // horizontal two-finger slide with ctrlKey (Serpent-4kg3).
    if (isPrimarilyHorizontalWheel(sample)) return "pan";
    return "zoom";
  }
  if (sample.deltaMode !== DOM_DELTA_PIXEL) return "zoom";
  if (sample.deltaX === 0 && sample.deltaY === 0) return "pan";
  if (!Number.isInteger(sample.deltaX) || !Number.isInteger(sample.deltaY)) {
    return "pan";
  }
  const dominant = Math.max(Math.abs(sample.deltaX), Math.abs(sample.deltaY));
  if (dominant >= VIEWER_WHEEL_MOUSE_NOTCH_THRESHOLD) return "zoom";
  // Serpent-6k1: on macOS a real mouse wheel reports small *integer* pixel
  // deltas (Chromium converts the line-based notch, unlike Windows' ~120px),
  // which the threshold above misreads as a trackpad → pan, forcing Ctrl to
  // zoom. A strictly vertical integer delta is a mouse wheel — zoom it.
  // Trackpad two-finger scroll is fractional and/or diagonal, so it still pans.
  if (sample.deltaX === 0 && sample.deltaY !== 0) return "zoom";
  return "pan";
}

/**
 * Zoom anchor for one wheel gesture (Serpent-yo0n, 2026-07-20 user ruling):
 * the zoom center is the pointer position captured when the scroll gesture
 * STARTS. Every wheel event in the same burst reuses it, so the image point
 * under the gesture-start cursor stays fixed for the whole gesture even if
 * the pointer drifts mid-scroll. A burst ends after
 * VIEWER_WHEEL_GESTURE_TIMEOUT_MS without a zoom-classified wheel event; the
 * next event re-anchors at the then-current pointer position.
 */
export interface ViewerWheelGestureAnchor {
  readonly clientX: number;
  readonly clientY: number;
  readonly lastEventAt: number;
}

export const VIEWER_WHEEL_GESTURE_TIMEOUT_MS = 500;

export function resolveWheelGestureAnchor(
  previous: ViewerWheelGestureAnchor | null,
  clientX: number,
  clientY: number,
  now: number,
): ViewerWheelGestureAnchor {
  if (
    previous === null ||
    now - previous.lastEventAt > VIEWER_WHEEL_GESTURE_TIMEOUT_MS
  ) {
    return { clientX, clientY, lastEventAt: now };
  }
  return { ...previous, lastEventAt: now };
}
