import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureWorkspaceNavViewport,
  pendingWorkspaceViewportAction,
  restoreWorkspaceNavViewport,
  resolveWorkspaceScrollTop,
} from "../../src/renderer/workspace-scroll-position";

afterEach(() => vi.unstubAllGlobals());

function installAnimationFrameQueue() {
  let nextId = 0;
  const queued = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++nextId;
      queued.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      cancelled.push(id);
      queued.delete(id);
    },
  });
  return {
    cancelled,
    flushOne() {
      const next = queued.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (!next) throw new Error("No animation frame is queued.");
      queued.delete(next[0]);
      next[1](0);
    },
  };
}

function createScrollElement() {
  const listeners = new Map<string, EventListenerOrEventListenerObject>();
  return {
    scrollTop: 0,
    scrollHeight: 1_100,
    clientHeight: 100,
    scrollTo(this: { scrollTop: number }, { top }: ScrollToOptions) {
      this.scrollTop = top ?? 0;
    },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    emit(type: string) {
      const listener = listeners.get(type);
      if (typeof listener === "function") listener(new Event(type));
      else listener?.handleEvent(new Event(type));
    },
  } as unknown as HTMLElement & { emit: (type: string) => void };
}

describe("pendingWorkspaceViewportAction", () => {
  const scrolledAwayFromTop = {
    previewActive: false,
    navigationPending: false,
    restoreLoopActive: false,
    intendedTop: 0,
    targetTop: 0,
    currentTop: 2400,
    extent: 8000,
  };

  it("discards a leftover top restore after the user has already scrolled", () => {
    expect(pendingWorkspaceViewportAction(scrolledAwayFromTop)).toBe("clear");
  });

  it("applies a top restore while folder navigation is still in flight", () => {
    expect(
      pendingWorkspaceViewportAction({
        ...scrolledAwayFromTop,
        navigationPending: true,
      }),
    ).toBe("apply");
  });

  it("clears leftover pending while the viewer owns the canvas", () => {
    expect(
      pendingWorkspaceViewportAction({
        ...scrolledAwayFromTop,
        previewActive: true,
        navigationPending: true,
      }),
    ).toBe("clear");
  });

  it("clears once the canvas already matches a holdable target", () => {
    expect(
      pendingWorkspaceViewportAction({
        previewActive: false,
        navigationPending: false,
        restoreLoopActive: false,
        intendedTop: 0,
        targetTop: 0,
        currentTop: 0,
        extent: 8000,
      }),
    ).toBe("clear");
  });

  it("keeps retrying when the live extent cannot hold the intended offset", () => {
    expect(
      pendingWorkspaceViewportAction({
        previewActive: false,
        navigationPending: true,
        restoreLoopActive: true,
        intendedTop: 2400,
        targetTop: 0,
        currentTop: 0,
        extent: 10,
      }),
    ).toBe("apply");
  });
});

describe("workspace scroll position", () => {
  it("captures an exact offset and its relative progress", () => {
    expect(captureWorkspaceNavViewport({
      scrollTop: 730,
      scrollHeight: 1_100,
      clientHeight: 100,
    } as HTMLElement)).toEqual({
      scrollTop: 730,
      scrollProgress: 0.73,
      scrollExtent: 1_000,
    });
  });

  it("uses the exact offset for the same extent and progress after a resize", () => {
    const viewport = {
      scrollTop: 730,
      scrollProgress: 0.73,
      scrollExtent: 1_000,
    };
    expect(resolveWorkspaceScrollTop(viewport, 1_000)).toBe(730);
    expect(resolveWorkspaceScrollTop(viewport, 2_000)).toBe(1_460);
  });

  it("reveals only after the restored extent stays stable", () => {
    const frames = installAnimationFrameQueue();
    const element = createScrollElement();
    const onComplete = vi.fn();
    restoreWorkspaceNavViewport(
      element,
      { scrollTop: 730, scrollProgress: 0.73, scrollExtent: 1_000 },
      () => true,
      onComplete,
    );

    for (let frame = 0; frame < 8; frame += 1) {
      frames.flushOne();
      expect(onComplete).not.toHaveBeenCalled();
    }
    frames.flushOne();
    expect(element.scrollTop).toBe(730);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("cancels auto restoration and reveals when the user starts scrolling", () => {
    const frames = installAnimationFrameQueue();
    const element = createScrollElement();
    const onComplete = vi.fn();
    restoreWorkspaceNavViewport(
      element,
      { scrollTop: 730, scrollProgress: 0.73, scrollExtent: 1_000 },
      () => true,
      onComplete,
    );

    element.emit("wheel");

    expect(frames.cancelled).toHaveLength(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps a native scrollbar jump instead of restoring the prior location", () => {
    const frames = installAnimationFrameQueue();
    const element = createScrollElement();
    const onComplete = vi.fn();
    restoreWorkspaceNavViewport(
      element,
      { scrollTop: 0, scrollProgress: 0, scrollExtent: 1_000 },
      () => true,
      onComplete,
    );
    frames.flushOne();
    element.scrollTop = 500;
    element.emit("scroll");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(frames.cancelled).toHaveLength(1);
    expect(element.scrollTop).toBe(500);
  });

  it("keeps restoring after a temporary extent shrink clamps its own offset", () => {
    const frames = installAnimationFrameQueue();
    const element = createScrollElement();
    const onComplete = vi.fn();
    restoreWorkspaceNavViewport(
      element,
      { scrollTop: 730, scrollProgress: 0.73, scrollExtent: 1_000 },
      () => true,
      onComplete,
    );
    frames.flushOne();
    expect(element.scrollTop).toBe(730);
    Object.defineProperty(element, "scrollHeight", { value: 200, writable: true, configurable: true });
    element.scrollTop = 100;
    element.emit("scroll");
    expect(onComplete).not.toHaveBeenCalled();
    Object.defineProperty(element, "scrollHeight", { value: 1_100, writable: true, configurable: true });
    frames.flushOne();
    expect(element.scrollTop).toBe(730);
  });

  it("does not cancel restoration for its own scroll event or a small layout shift", () => {
    const frames = installAnimationFrameQueue();
    const element = createScrollElement();
    const onComplete = vi.fn();
    restoreWorkspaceNavViewport(
      element,
      { scrollTop: 730, scrollProgress: 0.73, scrollExtent: 1_000 },
      () => true,
      onComplete,
    );
    frames.flushOne();
    element.emit("scroll");
    element.scrollTop = 780;
    element.emit("scroll");
    expect(onComplete).not.toHaveBeenCalled();
    frames.flushOne();
    expect(element.scrollTop).toBe(730);
  });
});
