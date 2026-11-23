import type { Page } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";

import { startHiddenNativeSurfaceCapture } from "../../tests/e2e/hidden-native-surface-capture";

type FrameEvent = { sessionId: number; data: string; metadata: { url: string } };
type FrameListener = (event: FrameEvent) => void;

class FakeCDPSession {
  readonly calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  detached = 0;
  removedListeners = 0;
  failStart?: Error;
  failStop?: Error;
  failAck = false;
  emitFrameOnStart = true;
  private listener: FrameListener | undefined;

  on(_event: string, listener: FrameListener): void {
    this.listener = listener;
  }

  off(_event: string, listener: FrameListener): void {
    if (this.listener === listener) this.listener = undefined;
    this.removedListeners += 1;
  }

  async send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ method, ...(params === undefined ? {} : { params }) });
    if (method === "Page.startScreencast") {
      if (this.failStart) throw this.failStart;
      if (this.emitFrameOnStart) {
        this.listener?.({
          sessionId: 47,
          data: "fixture-frame-bytes",
          metadata: { url: "fixture-url-marker" },
        });
      }
    }
    if (method === "Page.screencastFrameAck" && this.failAck) {
      throw new Error("ack failed");
    }
    if (method === "Page.stopScreencast" && this.failStop) throw this.failStop;
    return {};
  }

  async detach(): Promise<void> {
    this.detached += 1;
  }
}

function fakePage(session: FakeCDPSession): Page {
  return {
    context: () => ({ newCDPSession: async () => session }),
  } as unknown as Page;
}

const unhandledRejections: unknown[] = [];
const recordUnhandledRejection = (reason: unknown) => { unhandledRejections.push(reason); };

afterEach(() => {
  process.off("unhandledRejection", recordUnhandledRejection);
  unhandledRejections.length = 0;
});

describe("hidden native surface capture", () => {
  it("uses a 1px JPEG capture, acknowledges the first frame, and returns no frame content", async () => {
    const session = new FakeCDPSession();
    const capture = await startHiddenNativeSurfaceCapture(fakePage(session));
    await capture.waitForFirstFrame();

    const stats = await capture.stop();
    expect(session.calls[0]).toEqual({
      method: "Page.startScreencast",
      params: {
        format: "jpeg",
        quality: 0,
        maxWidth: 1,
        maxHeight: 1,
        everyNthFrame: 1,
      },
    });
    expect(session.calls[1]).toEqual({
      method: "Page.screencastFrameAck",
      params: { sessionId: 47 },
    });
    expect(stats).toEqual({ frameEvents: 1, ackFailures: 0 });
    expect(JSON.stringify(stats)).not.toContain("fixture-frame-bytes");
    expect(JSON.stringify(stats)).not.toContain("fixture-url-marker");
  });

  it("allows sparse capture every 30th frame", async () => {
    const session = new FakeCDPSession();
    const capture = await startHiddenNativeSurfaceCapture(fakePage(session), { everyNthFrame: 30 });

    expect(session.calls[0]).toEqual({
      method: "Page.startScreencast",
      params: {
        format: "jpeg",
        quality: 0,
        maxWidth: 1,
        maxHeight: 1,
        everyNthFrame: 30,
      },
    });
    await capture.stop();
  });

  it("counts ack failures without an unhandled rejection", async () => {
    const session = new FakeCDPSession();
    session.failAck = true;
    process.on("unhandledRejection", recordUnhandledRejection);
    const capture = await startHiddenNativeSurfaceCapture(fakePage(session));
    await capture.waitForFirstFrame();

    const stats = await capture.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(stats.ackFailures).toBe(1);
    expect(unhandledRejections).toEqual([]);
    expect(session.detached).toBe(1);
  });

  it("detaches and preserves the start error", async () => {
    const session = new FakeCDPSession();
    const startError = new Error("start failed");
    session.failStart = startError;

    await expect(startHiddenNativeSurfaceCapture(fakePage(session))).rejects.toBe(startError);
    expect(session.removedListeners).toBe(1);
    expect(session.detached).toBe(1);
    expect(session.calls.some(({ method }) => method === "Page.stopScreencast")).toBe(false);
  });

  it("removes the listener and detaches even when stop fails", async () => {
    const session = new FakeCDPSession();
    const stopError = new Error("stop failed");
    const capture = await startHiddenNativeSurfaceCapture(fakePage(session));
    session.failStop = stopError;

    await expect(capture.stop()).rejects.toBe(stopError);
    expect(session.removedListeners).toBe(1);
    expect(session.detached).toBe(1);
  });

  it("runs stop and detach once when stop is repeated", async () => {
    const session = new FakeCDPSession();
    const capture = await startHiddenNativeSurfaceCapture(fakePage(session));

    const [first, second] = await Promise.all([capture.stop(), capture.stop()]);
    expect(first).toEqual({ frameEvents: 1, ackFailures: 0 });
    expect(second).toBe(first);
    expect(session.calls.filter(({ method }) => method === "Page.stopScreencast")).toHaveLength(1);
    expect(session.detached).toBe(1);
  });

  it("can stop and detach after first-frame timeout", async () => {
    const session = new FakeCDPSession();
    session.emitFrameOnStart = false;
    process.on("unhandledRejection", recordUnhandledRejection);
    const capture = await startHiddenNativeSurfaceCapture(fakePage(session));

    try {
      await expect(capture.waitForFirstFrame(10)).rejects.toThrow("No screencast frame arrived");
    } finally {
      await capture.stop();
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(session.removedListeners).toBe(1);
    expect(session.detached).toBe(1);
    expect(unhandledRejections).toEqual([]);
  });
});
