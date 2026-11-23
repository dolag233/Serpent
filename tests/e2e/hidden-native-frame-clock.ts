import type { ElectronApplication, Page } from "@playwright/test";
import { startHiddenNativeSurfaceCapture } from "./hidden-native-surface-capture";

/** Environment calibration only; this is not an asset-loading benchmark. */
export async function probeHiddenNativeFrameClock(application: ElectronApplication, page: Page) {
  const before = await sampleRendererFrameClock(page);
  const state = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window || window.isVisible() || window.webContents.isOffscreen()) {
      throw new Error("Frame-clock calibration requires a hidden native window.");
    }
    // Reapply only after the native view has been attached. No show/focus or
    // Chromium frame-rate switches are used by this calibration.
    window.webContents.setBackgroundThrottling(false);
    return {
      windowVisible: window.isVisible(),
      offscreen: window.webContents.isOffscreen(),
      backgroundThrottling: window.webContents.getBackgroundThrottling(),
    };
  });
  const after = await sampleRendererFrameClock(page);
  const capture = await startHiddenNativeSurfaceCapture(page);
  let screencastClock: Awaited<ReturnType<typeof sampleRendererFrameClock>> | undefined;
  let captureStats: Awaited<ReturnType<typeof capture.stop>> | undefined;
  try {
    await capture.waitForFirstFrame();
    screencastClock = await sampleRendererFrameClock(page);
  } finally {
    captureStats = await capture.stop();
  }
  if (!screencastClock || !captureStats) {
    throw new Error("The hidden native surface capture did not complete.");
  }
  const afterScreencastStopped = await sampleRendererFrameClock(page);
  const sparseCapture = await startHiddenNativeSurfaceCapture(page, { everyNthFrame: 30 });
  let sparseClock: Awaited<ReturnType<typeof sampleRendererFrameClock>> | undefined;
  let sparseStats: Awaited<ReturnType<typeof sparseCapture.stop>> | undefined;
  try {
    sparseClock = await sampleRendererFrameClock(page);
  } finally {
    sparseStats = await sparseCapture.stop();
  }
  if (!sparseClock || !sparseStats) {
    throw new Error("The sparse hidden native surface capture did not complete.");
  }
  const finalWindowVisible = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.isVisible() ?? null,
  );
  return {
    measurement: "empty-renderer-frame-clock",
    before,
    reapplyState: state,
    after,
    afterScreencastStopped,
    screencast: {
      ...screencastClock,
      ...captureStats,
      windowVisible: finalWindowVisible,
    },
    sparseScreencast: {
      ...sparseClock,
      ...sparseStats,
      windowVisible: finalWindowVisible,
    },
  };
}

export async function sampleRendererFrameClock(page: Page, durationMs = 4_000) {
  if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 10_000) {
    throw new RangeError("Frame-clock sample duration must be an integer from 100 to 10000 milliseconds.");
  }
  return page.evaluate(async (sampleDurationMs) => {
    const startedAt = performance.now();
    const intervals: number[] = [];
    let previous: number | undefined;
    let firstFrameAt: number | undefined;
    let lastFrameAt: number | undefined;
    let frame: number;
    let timerTicks = 0;
    const next = (at: number) => {
      const callbackAt = performance.now();
      firstFrameAt ??= callbackAt;
      if (previous !== undefined) intervals.push(at - previous);
      previous = at;
      lastFrameAt = callbackAt;
      frame = requestAnimationFrame(next);
    };
    frame = requestAnimationFrame(next);
    const timer = setInterval(() => { timerTicks += 1; }, 50);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, sampleDurationMs));
    } finally {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    }
    intervals.sort((left, right) => left - right);
    const at = (fraction: number) => intervals.length > 0
      ? Math.round(intervals[Math.min(intervals.length - 1, Math.ceil(intervals.length * fraction) - 1)]! * 10) / 10
      : null;
    return {
      durationMs: Math.round(performance.now() - startedAt),
      frameIntervals: intervals.length,
      frameP50Ms: at(0.5),
      frameP95Ms: at(0.95),
      frameMaxMs: at(1),
      firstFrameDelayMs: firstFrameAt === undefined
        ? null
        : Math.round((firstFrameAt - startedAt) * 10) / 10,
      lastFrameAgeMs: lastFrameAt === undefined
        ? null
        : Math.round((performance.now() - lastFrameAt) * 10) / 10,
      timerTicks,
      documentVisibility: document.visibilityState,
    };
  }, durationMs);
}
