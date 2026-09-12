import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureWorkspaceNavViewport,
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
});
