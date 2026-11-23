import type { Page } from "@playwright/test";

export type HiddenNativeSurfaceCaptureStats = {
  frameEvents: number;
  ackFailures: number;
};

export type HiddenNativeSurfaceCapture = {
  waitForFirstFrame(timeoutMs?: number): Promise<void>;
  stop(): Promise<HiddenNativeSurfaceCaptureStats>;
};

/** Start a small hidden-surface capture to initialize Chromium's native surface. */
export async function startHiddenNativeSurfaceCapture(
  page: Page,
  options: { everyNthFrame?: 1 | 30 } = {},
): Promise<HiddenNativeSurfaceCapture> {
  const session = await page.context().newCDPSession(page);
  let frameEvents = 0;
  let ackFailures = 0;
  let firstFrameSeen = false;
  let stopped = false;
  let listenerAttached = false;
  let stopPromise: Promise<HiddenNativeSurfaceCaptureStats> | undefined;
  const pendingAcks = new Set<Promise<void>>();
  let resolveFirstFrame!: (received: boolean) => void;
  const firstFrame = new Promise<boolean>((resolve) => { resolveFirstFrame = resolve; });

  const onFrame = ({ sessionId }: { sessionId: number }) => {
    frameEvents += 1;
    if (!firstFrameSeen) {
      firstFrameSeen = true;
      resolveFirstFrame(true);
    }
    let ack: Promise<void>;
    try {
      ack = session.send("Page.screencastFrameAck", { sessionId }).then(
        () => undefined,
        () => { ackFailures += 1; },
      );
    } catch {
      ackFailures += 1;
      return;
    }
    pendingAcks.add(ack);
    void ack.then(() => { pendingAcks.delete(ack); });
  };

  try {
    session.on("Page.screencastFrame", onFrame);
    listenerAttached = true;
    await session.send("Page.startScreencast", {
      format: "jpeg",
      quality: 0,
      maxWidth: 1,
      maxHeight: 1,
      everyNthFrame: options.everyNthFrame ?? 1,
    });
  } catch (error) {
    if (listenerAttached) {
      try {
        session.off("Page.screencastFrame", onFrame);
        listenerAttached = false;
      } catch {
        // Preserve the startup error while still attempting to release the session.
      }
    }
    resolveFirstFrame(false);
    await Promise.all([...pendingAcks]);
    try {
      await session.detach();
    } catch {
      // Preserve the startup error while still attempting to release the session.
    }
    throw error;
  }

  const waitForFirstFrame = async (timeoutMs = 5_000): Promise<void> => {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      throw new RangeError("First-frame timeout must be between 1 and 30000 milliseconds.");
    }
    if (firstFrameSeen) return;
    if (stopped) throw new Error("Capture stopped before its first frame.");

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const received = await Promise.race([
        firstFrame,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        }),
      ]);
      if (!received) throw new Error(`No screencast frame arrived within ${timeoutMs} milliseconds.`);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const stop = (): Promise<HiddenNativeSurfaceCaptureStats> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    if (!firstFrameSeen) resolveFirstFrame(false);
    stopPromise = (async () => {
      let cleanupFailed = false;
      let cleanupError: unknown;
      try {
        await session.send("Page.stopScreencast");
      } catch (error) {
        cleanupFailed = true;
        cleanupError = error;
      }
      if (listenerAttached) {
        try {
          session.off("Page.screencastFrame", onFrame);
          listenerAttached = false;
        } catch (error) {
          if (!cleanupFailed) cleanupError = error;
          cleanupFailed = true;
        }
      }
      try {
        await Promise.all([...pendingAcks]);
      } catch (error) {
        if (!cleanupFailed) cleanupError = error;
        cleanupFailed = true;
      }
      try {
        await session.detach();
      } catch (error) {
        if (!cleanupFailed) cleanupError = error;
        cleanupFailed = true;
      }
      if (cleanupFailed) throw cleanupError;
      return { frameEvents, ackFailures };
    })();
    return stopPromise;
  };

  return { waitForFirstFrame, stop };
}
