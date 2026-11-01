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
  return dominant >= VIEWER_WHEEL_MOUSE_NOTCH_THRESHOLD ? "zoom" : "pan";
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

/**
 * Pixel distance that counts as one mouse-wheel notch. Chromium reports a
 * physical notch as about 100px. Trackpad samples accumulate until they
 * cross this distance. Reversing direction drops the leftover.
 */
export const VIEWER_WHEEL_NOTCH_PIXELS = 100;

export function accumulateWheelNotches(
  accumulatedPixels: number,
  deltaY: number,
  deltaMode: number,
  notchPixels: number = VIEWER_WHEEL_NOTCH_PIXELS,
): { steps: number; accumulatedPixels: number } {
  const kept = Number.isFinite(accumulatedPixels) ? accumulatedPixels : 0;
  if (!Number.isFinite(deltaY) || deltaY === 0) {
    return { steps: 0, accumulatedPixels: kept };
  }
  // Line and page devices already report one gesture as a small integer.
  if (deltaMode === 1) {
    return { steps: Math.trunc(deltaY), accumulatedPixels: 0 };
  }
  if (deltaMode === 2) {
    return { steps: Math.sign(deltaY), accumulatedPixels: 0 };
  }
  if (!Number.isFinite(notchPixels) || notchPixels <= 0) {
    return { steps: 0, accumulatedPixels: 0 };
  }
  const base = kept !== 0 && Math.sign(deltaY) !== Math.sign(kept) ? 0 : kept;
  const total = base + deltaY;
  const steps = Math.trunc(total / notchPixels);
  return { steps, accumulatedPixels: total - steps * notchPixels };
}

/** Non-passive listener. Positive steps are a downward wheel. */
export function bindVerticalWheelSteps(
  element: HTMLElement,
  onSteps: (steps: number) => void,
): () => void {
  let accumulated = 0;
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const next = accumulateWheelNotches(
      accumulated,
      event.deltaY,
      event.deltaMode,
    );
    accumulated = next.accumulatedPixels;
    if (next.steps === 0) return;
    onSteps(next.steps);
  };
  element.addEventListener("wheel", onWheel, { passive: false });
  return () => element.removeEventListener("wheel", onWheel);
}

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
