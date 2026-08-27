import { afterEach, describe, expect, it, vi } from "vitest";

import { deferNavigationHydration } from "../../src/renderer/browse/defer-navigation-hydration";

describe("deferNavigationHydration", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for a paint boundary and a quiet canvas interval before loading", async () => {
    vi.useFakeTimers();
    const requestAnimationFrame = vi.fn((callback: (timestamp: number) => void) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("window", { requestAnimationFrame });
    vi.stubGlobal("document", { querySelector: vi.fn(() => null) });
    const load = vi.fn(async () => "ready");

    const result = deferNavigationHydration(load);

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe("ready");
  });

  it("restarts the quiet interval when the canvas scrolls", async () => {
    vi.useFakeTimers();
    const requestAnimationFrame = vi.fn((callback: (timestamp: number) => void) => {
      callback(0);
      return 1;
    });
    const listeners = new Map<string, EventListener>();
    const canvas = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("window", { requestAnimationFrame });
    vi.stubGlobal("document", { querySelector: vi.fn(() => canvas) });
    const load = vi.fn(async () => "ready");

    const result = deferNavigationHydration(load);

    await vi.advanceTimersByTimeAsync(999);
    listeners.get("scroll")?.(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(999);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledOnce();
    await expect(result).resolves.toBe("ready");
    expect(canvas.removeEventListener).toHaveBeenCalledOnce();
  });
});
