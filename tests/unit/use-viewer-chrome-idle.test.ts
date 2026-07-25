import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createViewerChromeIdleScheduler,
  shouldWakeViewerChrome,
} from "../../src/renderer/viewer-chrome-idle";

describe("createViewerChromeIdleScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onIdle after the idle window", () => {
    const onIdle = vi.fn();
    const { bump } = createViewerChromeIdleScheduler(1_000, onIdle);
    bump();
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("bump resets the idle window and reports active", () => {
    const onIdle = vi.fn();
    const onActive = vi.fn();
    const { bump, dispose } = createViewerChromeIdleScheduler(
      1_000,
      onIdle,
      onActive,
    );
    bump();
    expect(onActive).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(800);
    bump();
    expect(onActive).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(800);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);

    dispose();
  });
});

describe("shouldWakeViewerChrome (Serpent-njoy)", () => {
  it("wakes on pointer movement", () => {
    expect(shouldWakeViewerChrome("pointermove")).toBe(true);
  });

  it("wakes on pointer-down / click (incl. on-screen prev/next)", () => {
    expect(shouldWakeViewerChrome("pointerdownOrClick")).toBe(true);
  });

  it("wakes on keyboard and wheel", () => {
    expect(shouldWakeViewerChrome("keyboard")).toBe(true);
    expect(shouldWakeViewerChrome("wheel")).toBe(true);
    expect(shouldWakeViewerChrome("other")).toBe(true);
  });
});
