import { afterEach, describe, expect, it, vi } from "vitest";

import { scheduleBrowseViewRestore } from "../../src/renderer/browse-view-restore-scheduler";
import { captureBrowseViewSnapshot } from "../../src/renderer/view-restore";

afterEach(() => vi.unstubAllGlobals());

function installAnimationFrameQueue() {
  let nextId = 0;
  const queued = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("window", {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++nextId;
      queued.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      queued.delete(id);
    },
  });
  return {
    flushOne() {
      const next = queued.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (!next) throw new Error("No animation frame is queued.");
      queued.delete(next[0]);
      next[1](0);
    },
    remaining() {
      return queued.size;
    },
  };
}

function createScrollElement(initial: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop?: number;
}) {
  const listeners = new Map<string, EventListenerOrEventListenerObject>();
  const element = {
    scrollTop: initial.scrollTop ?? 0,
    scrollHeight: initial.scrollHeight,
    clientHeight: initial.clientHeight,
    scrollWidth: 800,
    clientWidth: 800,
    scrollLeft: 0,
    scrollTo(this: {
      scrollTop: number;
      scrollLeft: number;
      scrollHeight: number;
      clientHeight: number;
      scrollWidth: number;
      clientWidth: number;
    }, options: ScrollToOptions) {
      const maxTop = Math.max(0, this.scrollHeight - this.clientHeight);
      const maxLeft = Math.max(0, this.scrollWidth - this.clientWidth);
      this.scrollTop = Math.min(maxTop, Math.max(0, options.top ?? 0));
      this.scrollLeft = Math.min(maxLeft, Math.max(0, options.left ?? 0));
    },
    querySelectorAll() {
      return [] as unknown as NodeListOf<HTMLElement>;
    },
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: 800,
        height: this.clientHeight,
        right: 800,
        bottom: this.clientHeight,
      };
    },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
  };
  return element as unknown as HTMLElement & typeof element;
}

describe("scheduleBrowseViewRestore (VIEWER-001 / Serpent-bd481f)", () => {
  it("does not finish at the top when the first frames still have a collapsed scroll extent", () => {
    const frames = installAnimationFrameQueue();
    const canvas = createScrollElement({ clientHeight: 0, scrollHeight: 0 });
    const snapshot = captureBrowseViewSnapshot("asset-1", null, 0, 2400);
    const onComplete = vi.fn();

    scheduleBrowseViewRestore({
      canvas,
      snapshot,
      isCurrent: () => true,
      onComplete,
    });

    frames.flushOne();
    frames.flushOne();
    expect(canvas.scrollTop).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();

    canvas.clientHeight = 600;
    canvas.scrollHeight = 8000;
    for (let frame = 0; frame < 12 && onComplete.mock.calls.length === 0; frame += 1) {
      frames.flushOne();
    }

    expect(canvas.scrollTop).toBe(2400);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not reveal the canvas when a newer close or navigation cancels the restore", () => {
    const frames = installAnimationFrameQueue();
    const canvas = createScrollElement({ clientHeight: 600, scrollHeight: 8000 });
    const snapshot = captureBrowseViewSnapshot("asset-1", null, 0, 2400);
    const onComplete = vi.fn();
    const cancel = scheduleBrowseViewRestore({
      canvas,
      snapshot,
      isCurrent: () => true,
      onComplete,
    });

    cancel();
    expect(onComplete).not.toHaveBeenCalled();
    expect(() => frames.flushOne()).toThrow(/No animation frame is queued/);
  });

  it("reveals a settled bottom frame before the final stability frames", () => {
    const frames = installAnimationFrameQueue();
    const canvas = createScrollElement({ clientHeight: 600, scrollHeight: 9960 });
    const snapshot = captureBrowseViewSnapshot("asset-1", null, 0, 9400, 9400);
    const onPositionReady = vi.fn();
    const onComplete = vi.fn();

    scheduleBrowseViewRestore({ canvas, snapshot, isCurrent: () => true, onPositionReady, onComplete });
    expect(canvas.scrollTop).toBe(9360);
    expect(onPositionReady).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    frames.flushOne();
    frames.flushOne();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a new scroll after the browse frame becomes visible", () => {
    const frames = installAnimationFrameQueue();
    const canvas = createScrollElement({ clientHeight: 600, scrollHeight: 8000 });
    const snapshot = captureBrowseViewSnapshot("asset-1", null, 0, 2400, 7400);
    const onComplete = vi.fn();
    scheduleBrowseViewRestore({ canvas, snapshot, isCurrent: () => true, onComplete });
    expect(canvas.scrollTop).toBe(2400);
    canvas.scrollTop = 2040;
    frames.flushOne();
    expect(canvas.scrollTop).toBe(2040);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
