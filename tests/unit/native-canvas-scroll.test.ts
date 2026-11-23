import type { CDPSession, Locator, Page } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  nativeScrollCanvasDown,
  NativeCanvasScrollTimeoutError,
} from "../e2e/native-canvas-scroll";

type WheelEventParams = {
  type: string;
  x: number;
  y: number;
  deltaX?: number;
  deltaY?: number;
  pointerType?: string;
};

class FakeHTMLElement {
  scrollTop = 100;
  readonly scrollHeight = 6_000;
  readonly clientHeight = 800;

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect;
  }
}

type CanvasEvaluate = (element: FakeHTMLElement, call: (target: FakeHTMLElement) => unknown, callIndex: number) => unknown;

function setup(
  sendImpl: (element: FakeHTMLElement, params: WheelEventParams) => Promise<void>,
  evaluateImpl?: CanvasEvaluate,
) {
  const element = new FakeHTMLElement();
  let evaluateCallCount = 0;
  const canvas = {
    evaluate: vi.fn(async (callback: (target: FakeHTMLElement) => unknown) => {
      evaluateCallCount += 1;
      return evaluateImpl ? evaluateImpl(element, callback, evaluateCallCount) : callback(element);
    }),
  } as unknown as Locator;
  const page = { isClosed: () => false } as unknown as Page;
  const send = vi.fn(async (_method: string, params: WheelEventParams) => sendImpl(element, params));
  const session = { send } as unknown as CDPSession;

  vi.stubGlobal("HTMLElement", FakeHTMLElement);
  vi.stubGlobal("window", { innerWidth: 800, innerHeight: 600 });

  return { canvas, element, page, send, session };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("nativeScrollCanvasDown", () => {
  it("dispatches 80 timed downward mouse-wheel events over four seconds", async () => {
    vi.useFakeTimers();
    const context = setup(async (element, params) => {
      element.scrollTop = Math.min(
        element.scrollTop + (params.deltaY ?? 0),
        element.scrollHeight - element.clientHeight,
      );
    });

    const pending = nativeScrollCanvasDown(context.page, context.session, context.canvas);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await pending;

    expect(context.send).toHaveBeenCalledTimes(80);
    expect(context.send).toHaveBeenNthCalledWith(1, "Input.dispatchMouseEvent", {
      type: "mouseWheel", x: 400, y: 300, deltaX: 0, deltaY: 20, pointerType: "mouse",
    });
    expect(context.send).toHaveBeenNthCalledWith(80, "Input.dispatchMouseEvent", {
      type: "mouseWheel", x: 400, y: 300, deltaX: 0, deltaY: 20, pointerType: "mouse",
    });
    expect(result).toMatchObject({
      status: "completed",
      input: "Input.dispatchMouseEvent",
      eventType: "mouseWheel",
      requestedDeltaYPx: 1_600,
      eventDeltaYPx: 20,
      eventCount: 80,
      eventIntervalMs: 50,
      nominalDurationMs: 4_000,
      observedMs: 4_000,
      startTop: 100,
      endTop: 1_700,
      travelPx: 1_600,
      legal: true,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns unsupported only for an explicit unknown CDP method", async () => {
    vi.useFakeTimers();
    const context = setup(async () => {
      throw new Error("Protocol error: Unknown method Input.dispatchMouseEvent");
    });

    const result = await nativeScrollCanvasDown(context.page, context.session, context.canvas);

    expect(result).toMatchObject({
      status: "unsupported",
      input: "Input.dispatchMouseEvent",
      legal: false,
      reason: "cdp-method-unavailable",
      startTop: 100,
    });
    expect(context.send).toHaveBeenCalledOnce();
    expect(context.element.scrollTop).toBe(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not turn a generic unknown error into unsupported", async () => {
    vi.useFakeTimers();
    const context = setup(async () => {
      throw new Error("Protocol error (Input.dispatchMouseEvent): unknown error");
    });

    await expect(nativeScrollCanvasDown(context.page, context.session, context.canvas))
      .rejects.toThrow("Native canvas mouse-wheel input failed.");
    expect(context.element.scrollTop).toBe(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails on a pending CDP request at the 15-second deadline and clears timers", async () => {
    vi.useFakeTimers();
    const context = setup(() => new Promise<void>(() => {}));
    const pending = nativeScrollCanvasDown(context.page, context.session, context.canvas);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.send).toHaveBeenCalledOnce();

    const rejected = expect(pending).rejects.toBeInstanceOf(NativeCanvasScrollTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;

    expect(vi.getTimerCount()).toBe(0);
  });

  it("includes an initial canvas geometry read in the 15-second deadline", async () => {
    vi.useFakeTimers();
    const context = setup(async () => {}, (_element, _callback, callIndex) =>
      callIndex === 1 ? new Promise<unknown>(() => {}) : undefined);
    const pending = nativeScrollCanvasDown(context.page, context.session, context.canvas);
    const rejected = expect(pending).rejects.toBeInstanceOf(NativeCanvasScrollTimeoutError);

    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;

    expect(context.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("includes the final canvas position read in the 15-second deadline", async () => {
    vi.useFakeTimers();
    const context = setup(async (element, params) => {
      element.scrollTop = Math.min(
        element.scrollTop + (params.deltaY ?? 0),
        element.scrollHeight - element.clientHeight,
      );
    }, (element, callback, callIndex) =>
      callIndex === 2 ? new Promise<unknown>(() => {}) : callback(element));
    const pending = nativeScrollCanvasDown(context.page, context.session, context.canvas);
    const rejected = expect(pending).rejects.toBeInstanceOf(NativeCanvasScrollTimeoutError);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(context.send).toHaveBeenCalledTimes(80);
    await vi.advanceTimersByTimeAsync(11_000);
    await rejected;

    expect(context.send).toHaveBeenCalledTimes(80);
    expect(vi.getTimerCount()).toBe(0);
  });
});
