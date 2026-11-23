import type { CDPSession, Locator, Page } from "@playwright/test";

const TOTAL_DELTA_Y_PX = 1_600;
const EVENT_DELTA_Y_PX = 20;
const EVENT_COUNT = TOTAL_DELTA_Y_PX / EVENT_DELTA_Y_PX;
const EVENT_INTERVAL_MS = 50;
const NOMINAL_DURATION_MS = EVENT_COUNT * EVENT_INTERVAL_MS;
const TOTAL_TIMEOUT_MS = 15_000;

type CanvasScrollStart = {
  x: number;
  y: number;
  box: { width: number; height: number };
  scrollTop: number;
  maxScrollTop: number;
};
type CanvasScrollEnd = { scrollTop: number; maxScrollTop: number };

export type NativeCanvasScrollResult =
  | {
      status: "completed";
      input: "Input.dispatchMouseEvent";
      eventType: "mouseWheel";
      requestedDeltaYPx: typeof TOTAL_DELTA_Y_PX;
      eventDeltaYPx: typeof EVENT_DELTA_Y_PX;
      eventCount: typeof EVENT_COUNT;
      eventIntervalMs: typeof EVENT_INTERVAL_MS;
      nominalDurationMs: number;
      observedMs: number;
      canvasBox: { width: number; height: number };
      startTop: number;
      endTop: number;
      travelPx: number;
      maxScrollTop: number;
      legal: boolean;
    }
  | {
      status: "unsupported";
      input: "Input.dispatchMouseEvent";
      eventType: "mouseWheel";
      requestedDeltaYPx: typeof TOTAL_DELTA_Y_PX;
      eventDeltaYPx: typeof EVENT_DELTA_Y_PX;
      eventCount: typeof EVENT_COUNT;
      eventIntervalMs: typeof EVENT_INTERVAL_MS;
      nominalDurationMs: number;
      observedMs: number;
      canvasBox: { width: number; height: number };
      startTop: number;
      legal: false;
      reason: "cdp-method-unavailable";
    };

export class NativeCanvasScrollTimeoutError extends Error {
  readonly code = "NATIVE_CANVAS_SCROLL_TIMEOUT";

  constructor() {
    super("Native canvas wheel input exceeded its 15-second deadline.");
    this.name = "NativeCanvasScrollTimeoutError";
  }
}

function isUnsupportedCdpMethod(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bunknown\s+(?:CDP\s+)?(?:method|command)\b/i.test(message) ||
    /\b(?:method|command)\s+(?:['"]?Input\.dispatchMouseEvent['"]?\s+)?(?:wasn't found|was not found|not found|is not supported|not supported|unsupported|is not implemented|not implemented)\b/i
      .test(message) ||
    /['"]?Input\.dispatchMouseEvent['"]?\s+(?:wasn't found|was not found|not found|is not supported|not supported|unsupported|is not implemented|not implemented)\b/i
      .test(message);
}

class UnsupportedNativeMouseWheelMethodError extends Error {}

async function readCanvasStart(canvas: Locator): Promise<CanvasScrollStart> {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("The canvas locator is not an HTML element.");
    const rect = element.getBoundingClientRect();
    const visibleLeft = Math.max(0, rect.left);
    const visibleRight = Math.min(window.innerWidth, rect.right);
    const visibleTop = Math.max(0, rect.top);
    const visibleBottom = Math.min(window.innerHeight, rect.bottom);
    if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
      throw new Error("The canvas has no visible area for native scroll input.");
    }
    const scrollTop = element.scrollTop;
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    return {
      x: Math.floor((visibleLeft + visibleRight) / 2),
      y: Math.floor((visibleTop + visibleBottom) / 2),
      box: { width: rect.width, height: rect.height },
      scrollTop,
      maxScrollTop,
    };
  });
}

async function readCanvasEnd(canvas: Locator): Promise<CanvasScrollEnd> {
  return canvas.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("The canvas locator is not an HTML element.");
    return {
      scrollTop: element.scrollTop,
      maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight),
    };
  });
}

/** Scroll the canvas with timed native mouse-wheel events; no JS scroll fallback. */
export async function nativeScrollCanvasDown(
  page: Page,
  session: CDPSession,
  canvas: Locator,
): Promise<NativeCanvasScrollResult> {
  if (page.isClosed()) throw new Error("Cannot send native canvas input to a closed page.");
  const startedAt = Date.now();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let timedOut = false;
  let startSnapshot: CanvasScrollStart | undefined;
  const schedule = (callback: () => void, delayMs: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
  };
  const waitUntil = (deadline: number) => new Promise<void>((resolve) => {
    const delay = deadline - Date.now();
    if (delay <= 0) resolve();
    else schedule(resolve, delay);
  });
  let rejectTimeout!: (error: NativeCanvasScrollTimeoutError) => void;
  const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  schedule(() => {
    timedOut = true;
    rejectTimeout(new NativeCanvasScrollTimeoutError());
  }, TOTAL_TIMEOUT_MS);

  const runWorkflow = async (): Promise<{ start: CanvasScrollStart; end: CanvasScrollEnd }> => {
    const start = await readCanvasStart(canvas);
    startSnapshot = start;
    if (timedOut) throw new NativeCanvasScrollTimeoutError();
    if (start.maxScrollTop - start.scrollTop < TOTAL_DELTA_Y_PX) {
      throw new Error("The canvas does not have enough remaining scroll range for the native wheel sequence.");
    }
    const gestureStartedAt = Date.now();

    for (let index = 0; index < EVENT_COUNT; index += 1) {
      if (timedOut) throw new NativeCanvasScrollTimeoutError();
      await waitUntil(gestureStartedAt + index * EVENT_INTERVAL_MS);
      if (timedOut) throw new NativeCanvasScrollTimeoutError();
      try {
        await session.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: start.x,
          y: start.y,
          deltaX: 0,
          deltaY: EVENT_DELTA_Y_PX,
          pointerType: "mouse",
        });
      } catch (error) {
        if (isUnsupportedCdpMethod(error)) throw new UnsupportedNativeMouseWheelMethodError();
        throw error;
      }
      if (timedOut) throw new NativeCanvasScrollTimeoutError();
    }
    await waitUntil(gestureStartedAt + NOMINAL_DURATION_MS);
    if (timedOut) throw new NativeCanvasScrollTimeoutError();
    const end = await readCanvasEnd(canvas);
    if (timedOut) throw new NativeCanvasScrollTimeoutError();
    return { start, end };
  };

  let start: CanvasScrollStart;
  let end: CanvasScrollEnd;
  try {
    const result = await Promise.race([runWorkflow(), timeout]);
    start = result.start;
    end = result.end;
  } catch (error) {
    const observedMs = Date.now() - startedAt;
    if (error instanceof NativeCanvasScrollTimeoutError) throw error;
    if (error instanceof UnsupportedNativeMouseWheelMethodError && startSnapshot) {
      return {
        status: "unsupported",
        input: "Input.dispatchMouseEvent",
        eventType: "mouseWheel",
        requestedDeltaYPx: TOTAL_DELTA_Y_PX,
        eventDeltaYPx: EVENT_DELTA_Y_PX,
        eventCount: EVENT_COUNT,
        eventIntervalMs: EVENT_INTERVAL_MS,
        nominalDurationMs: NOMINAL_DURATION_MS,
        observedMs,
        canvasBox: { width: startSnapshot.box.width, height: startSnapshot.box.height },
        startTop: startSnapshot.scrollTop,
        legal: false,
        reason: "cdp-method-unavailable",
      };
    }
    // Avoid exposing raw CDP error text in test output.
    // eslint-disable-next-line preserve-caught-error
    throw new Error("Native canvas mouse-wheel input failed.");
  } finally {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  const travelPx = end.scrollTop - start.scrollTop;
  const legal =
    Number.isFinite(start.scrollTop) &&
    Number.isFinite(end.scrollTop) &&
    Number.isFinite(start.maxScrollTop) &&
    Number.isFinite(end.maxScrollTop) &&
    start.scrollTop >= 0 && start.scrollTop <= start.maxScrollTop &&
    end.scrollTop >= 0 && end.scrollTop <= end.maxScrollTop &&
    travelPx > 0;

  return {
    status: "completed",
    input: "Input.dispatchMouseEvent",
    eventType: "mouseWheel",
    requestedDeltaYPx: TOTAL_DELTA_Y_PX,
    eventDeltaYPx: EVENT_DELTA_Y_PX,
    eventCount: EVENT_COUNT,
    eventIntervalMs: EVENT_INTERVAL_MS,
    nominalDurationMs: NOMINAL_DURATION_MS,
    observedMs: Date.now() - startedAt,
    canvasBox: { width: start.box.width, height: start.box.height },
    startTop: start.scrollTop,
    endTop: end.scrollTop,
    travelPx,
    maxScrollTop: end.maxScrollTop,
    legal,
  };
}
