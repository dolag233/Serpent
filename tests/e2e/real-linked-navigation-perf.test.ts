import { existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync, statfsSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test, type ElectronApplication, type JSHandle } from "@playwright/test";
import type { SerpentLibraryApi } from "../../src/shared/library-api";
import type { NativeCanvasScrollResult } from "./native-canvas-scroll";
import type { HiddenNativeSurfaceCapture } from "./hidden-native-surface-capture";
import type { ViewportGeometrySnapshot, ViewportReportGeometryProbe } from "./viewport-report-geometry-probe";
import { installBrowseJumpStageProbe } from "./browse-jump-stage-probe";
import { probeDuplicateDimensions } from "./dimension-completion-regression";
import { probeBrowseBurst } from "./browse-burst-probe";
import { probeFolderInteractions } from "./folder-interaction-perf-probe";
import { probeAiConnectionContention } from "./ai-probe-contention-probe";
import type { CanvasLayoutWorkSummary } from "./canvas-layout-work-probe";
import { summarizeCpuProfileWork } from "./cpu-profile-work-summary";
import { installRenderFunctionCallProbe } from "./render-function-call-probe";
import {
  collectCompetingWorkStages,
  collectLatePreviewQueueStages,
  sampleMissingPreviewCards,
} from "./late-preview-queue-probe";
import {
  installRendererProbe, launchBenchmarkApp, readRendererProbe,
  readSessionLog, resetRendererCounters, summarizeTimings, visibleImageStats,
} from "./perf-bench-helpers";

/** Opt-in real source tree. Only the disposable catalog is writable. */
const source = process.env.SERPENT_REAL_NAV_SOURCE_ROOT;
const jumpFractions = process.env.SERPENT_REAL_NAV_REPEAT_JUMPS === "1"
  ? [0.05, 0.55, 0.85, 0.25, 0.05, 0.55, 0.85, 0.25] : [0.05, 0.55, 0.85, 0.25];
test.skip(!source, "Set SERPENT_REAL_NAV_SOURCE_ROOT to a real media directory.");
test.setTimeout(600_000);

function cleanOwnedCatalog(root: string, workspace: string, child: ChildProcess | undefined, launchAttempted: boolean): void {
  if (launchAttempted && (!child || (child.exitCode === null && child.signalCode === null))) {
    throw new Error("Test process exit was not confirmed; its isolated catalog remains in use.");
  }
  if (path.dirname(realpathSync(root)) !== workspace || lstatSync(root).isSymbolicLink()) {
    throw new Error("Unexpected test cleanup root.");
  }
  const verify = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const entry = path.join(directory, name);
      const info = lstatSync(entry);
      if (info.isSymbolicLink()) throw new Error("Refusing to clean a reparse-point tree.");
      if (info.isDirectory()) verify(entry);
    }
  };
  verify(root);
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test("measures real linked media, random jumps and folder-create visibility", async () => {
  if (!source || !existsSync(source)) throw new Error("Real source directory is unavailable.");
  const workspace = realpathSync(process.cwd());
  const resolvedSource = realpathSync(source);
  const within = (parent: string, candidate: string) => {
    const relative = path.relative(parent, candidate);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  if (within(workspace, resolvedSource) || within(resolvedSource, workspace)) {
    throw new Error("The read-only source and test workspace must be separate trees.");
  }
  const disk = statfsSync(process.cwd());
  if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw new Error("Insufficient space for isolated navigation catalog.");
  const root = mkdtempSync(path.join(workspace, ".tmp-real-nav-"));
  let application: ElectronApplication | undefined;
  let child: ChildProcess | undefined;
  let launchAttempted = false;
  let rowPolicyOverride: JSHandle<HTMLStyleElement> | undefined;
  let nativeCapture: HiddenNativeSurfaceCapture | undefined;
  let viewportGeometry: ViewportReportGeometryProbe | undefined;
  let phase = "launching";
  const reportPhase = (value: string) => {
    phase = value;
    console.log("real linked navigation phase:", value);
  };
  try {
    launchAttempted = true;
    const launched = await launchBenchmarkApp({
      userDataPath: path.join(root, "profile"),
      extraEnv: {
        SERPENT_E2E_HIDE_WINDOW: "1",
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_LINKED_SOURCE: resolvedSource,
      },
    });
    application = launched.application;
    child = application.process();
    const readRenderingMode = () => application!.evaluate(async ({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const features = app.getGPUFeatureStatus();
      return {
        hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(),
        offscreen: window?.webContents.isOffscreen() ?? null,
        backgroundThrottling: window?.webContents.getBackgroundThrottling() ?? null,
        gpuCompositing: features.gpu_compositing,
        windowVisible: window?.isVisible() ?? null,
        documentVisibility: window
          ? await window.webContents.executeJavaScript("document.visibilityState")
          : null,
      };
    });
    let renderingMode = await readRenderingMode();
    if (process.env.SERPENT_E2E_RENDERING_MODE === "native-gpu") {
      let consecutiveEnabledSamples = 0;
      const gpuStatusStable = await expect.poll(async () => {
        renderingMode = await readRenderingMode();
        consecutiveEnabledSamples = renderingMode.gpuCompositing === "enabled"
          ? consecutiveEnabledSamples + 1
          : 0;
        return consecutiveEnabledSamples >= 3;
      }, { timeout: 15_000, intervals: [100, 250, 500] }).toBe(true).then(
        () => true,
        () => false,
      );
      console.log("native-gpu rendering mode:", JSON.stringify(renderingMode));
      expect(
        gpuStatusStable,
        `GPU compositing did not stabilize; last rendering mode: ${JSON.stringify(renderingMode)}`,
      ).toBe(true);
      expect(renderingMode.hardwareAccelerationEnabled, "native-gpu requires hardware acceleration").toBe(true);
      expect(renderingMode.offscreen, "native-gpu requires a native BrowserWindow surface").toBe(false);
      expect(renderingMode.backgroundThrottling, "native-gpu must disable background throttling").toBe(false);
      expect(renderingMode.gpuCompositing, "native-gpu requires GPU compositing").toBe("enabled");
      expect(renderingMode.windowVisible, "native-gpu measurement window must remain hidden").toBe(false);
    }
    const { window } = launched;
    let nativeCaptureControl: Record<string, unknown> | undefined;
    reportPhase("rendering-mode-ready");
    if (process.env.SERPENT_REAL_NAV_PROBE_FRAME_CLOCK === "1") {
      if (process.env.SERPENT_E2E_RENDERING_MODE !== "native-gpu") {
        throw new Error("Native frame-clock calibration requires native-gpu mode.");
      }
      const { probeHiddenNativeFrameClock } = await import("./hidden-native-frame-clock");
      console.log("real hidden renderer clock:", JSON.stringify({
        renderingMode,
        clock: await probeHiddenNativeFrameClock(application, window),
      }));
      return;
    }
    await window.setViewportSize({ width: 1440, height: 1000 });
    if (process.env.SERPENT_E2E_NATIVE_CAPTURE_KEEPALIVE === "1") {
      if (process.env.SERPENT_E2E_RENDERING_MODE !== "native-gpu") {
        throw new Error("Native capture calibration requires native-gpu mode.");
      }
      reportPhase("calibrating-native-capture");
      const { startHiddenNativeSurfaceCapture } = await import("./hidden-native-surface-capture");
      const { sampleRendererFrameClock } = await import("./hidden-native-frame-clock");
      nativeCapture = await startHiddenNativeSurfaceCapture(window, { everyNthFrame: 30 });
      const clock = await sampleRendererFrameClock(window, 1_200);
      renderingMode = await readRenderingMode();
      nativeCaptureControl = {
        measurement: "native-gpu-with-one-pixel-sparse-capture",
        everyNthFrame: 30,
        clock,
        renderingMode,
      };
      console.log("native-gpu capture calibration:", JSON.stringify(nativeCaptureControl));
      expect(renderingMode.windowVisible).toBe(false);
      expect(clock.frameIntervals, "The hidden measurement frame clock must be active").toBeGreaterThanOrEqual(5);
      expect(clock.frameP95Ms).not.toBeNull();
      expect(clock.firstFrameDelayMs).not.toBeNull();
      expect(clock.lastFrameAgeMs).not.toBeNull();
      expect(clock.frameP95Ms!).toBeLessThan(100);
      expect(clock.firstFrameDelayMs!).toBeLessThan(100);
      expect(clock.lastFrameAgeMs!).toBeLessThan(100);
    }
    reportPhase("creating-library");
    await window.getByRole("button", { name: "创建资源库", exact: true }).click();
    await window.getByRole("textbox", { name: "名称", exact: true }).fill("RealMediaNavigation");
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect.poll(() => existsSync(path.join(root, "RealMediaNavigation")), { timeout: 60_000 }).toBe(true);
    await expect(window.locator(".workspace-canvas")).toBeVisible({ timeout: 60_000 });
    reportPhase("importing-linked-source");
    const imported = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
      const opened = await api.listOpen();
      if (!opened.ok || !opened.value[0]) throw new Error("Missing isolated library.");
      const libraryId = opened.value[0].libraryId;
      const start = performance.now();
      const linked = await api.importFolderAsLinked({ libraryId, displayName: "RealSource" });
      if (!linked.ok) throw new Error(linked.error.code);
      return { libraryId, assets: linked.value.assetCount, importMs: performance.now() - start };
    });
    expect(imported.assets).toBeGreaterThan(10_000);
    reportPhase("source-imported");
    await window.getByRole("button", { name: "所有资产", exact: true }).click();
    await expect(window.locator(".asset-card").first()).toBeVisible({ timeout: 120_000 });
    let navigationFolderRows: number | undefined;
    if (process.env.SERPENT_REAL_NAV_WAIT_NAVIGATION === "1") {
      const linkedRows = window.locator('.navigation-pane button.nav-row[data-nav-folder-kind="linked"]');
      await expect(linkedRows.first()).toBeVisible({ timeout: 60_000 });
      navigationFolderRows = await linkedRows.count();
      expect(navigationFolderRows).toBeGreaterThan(0);
    }
    reportPhase("navigation-ready");
    const aiConnectionContention = process.env.SERPENT_REAL_NAV_PROBE_AI_CONTENTION === "1"
      ? await probeAiConnectionContention(window, imported.libraryId) : undefined;
    if (aiConnectionContention) {
      console.log("real AI probe contention:", JSON.stringify({ assets: imported.assets, aiConnectionContention }));
    }
    const compareRowPolicy = process.env.SERPENT_REAL_NAV_COMPARE_ROW_POLICY === "1";
    const navigationRowPolicy = process.env.SERPENT_REAL_NAV_FORCE_VISIBLE_ROWS === "1"
      ? "visible" : "auto";
    if (compareRowPolicy) {
      if (navigationRowPolicy === "visible") {
        rowPolicyOverride = await window.evaluateHandle(() => {
          const style = document.createElement("style");
          style.textContent = ".navigation-pane .nav-item-row { content-visibility: visible !important; }";
          document.head.append(style);
          return style;
        });
      }
      await window.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));
      const effectivePolicy = await window.locator('.navigation-pane .nav-item-row:not(:focus-within):not([data-insert-edge])')
        .first().evaluate((row) => getComputedStyle(row).contentVisibility);
      expect(effectivePolicy).toBe(navigationRowPolicy);
    }
    await installRendererProbe(window);
    const geometryProbeMode = process.env.SERPENT_REAL_NAV_REPORT_GEOMETRY;
    if (geometryProbeMode !== undefined && geometryProbeMode !== "off") {
      if (geometryProbeMode !== "counts" && geometryProbeMode !== "parity") {
        throw new Error("Unknown viewport geometry probe mode.");
      }
      const { installViewportReportGeometryProbe } = await import("./viewport-report-geometry-probe");
      viewportGeometry = await installViewportReportGeometryProbe(window, {
        compareDom: geometryProbeMode === "parity",
      });
    }
    const measureStyleSensitivity = async (browseHistory: "initial" | "after-random-jumps") => {
      reportPhase("style-sensitivity");
      const { probeCanvasStyleSensitivity } = await import("./canvas-style-sensitivity-probe");
      const sensitivity = await probeCanvasStyleSensitivity(window,
        process.env.SERPENT_REAL_NAV_STYLE_CANDIDATE === "rows-auto"
          ? { candidate: "rows-auto" }
          : process.env.SERPENT_REAL_NAV_STYLE_CANDIDATE === "layout-containment"
            ? { candidate: "layout-containment" } : undefined);
      if (nativeCapture) {
        const stats = await nativeCapture.stop();
        nativeCapture = undefined;
        nativeCaptureControl = { ...nativeCaptureControl, ...stats, captureStoppedBeforeCleanup: true };
        expect(stats.frameEvents).toBeGreaterThan(0);
        expect(stats.ackFailures).toBe(0);
      }
      renderingMode = await readRenderingMode();
      if (nativeCaptureControl) expect(renderingMode.windowVisible).toBe(false);
      console.log("real canvas style sensitivity:", JSON.stringify({
        assets: imported.assets, renderingMode, nativeCaptureControl, browseHistory, sensitivity,
      }));
    };
    if (process.env.SERPENT_REAL_NAV_PROBE_STYLE_SENSITIVITY === "1") {
      await measureStyleSensitivity("initial");
      return;
    }
    if (process.env.SERPENT_REAL_NAV_PROBE_VIEWPORT_LIFECYCLE === "1") {
      const { probeRealViewportLifecycle } = await import("./real-viewport-lifecycle-probe");
      const lifecycle = await probeRealViewportLifecycle(window, imported.libraryId);
      console.log("real viewport lifecycle:", JSON.stringify({ assets: imported.assets, lifecycle }));
      return;
    }
    if (process.env.SERPENT_REAL_NAV_PROBE_SIDEBAR_RENDERING === "1") {
      const { probeRealSidebarRendering } = await import("./real-sidebar-render-probe");
      const sidebar = await probeRealSidebarRendering(window, imported.libraryId);
      console.log("real sidebar rendering:", JSON.stringify({ assets: imported.assets, sidebar }));
      return;
    }
    if (process.env.SERPENT_REAL_NAV_PROBE_COVER_CHURN === "1") {
      const canvas = window.locator(".workspace-canvas");
      await expect.poll(async () => (await visibleImageStats(window)).coverage,
        { timeout: 60_000 }).toBeGreaterThanOrEqual(0.9);
      const extent = await canvas.evaluate((element) => Math.max(0, element.scrollHeight - element.clientHeight));
      expect(extent).toBeGreaterThan(1_600);
      const { installCanvasCoverMutationProbe } = await import("./canvas-cover-mutation-probe");
      const { installCanvasLayoutWorkProbe } = await import("./canvas-layout-work-probe");
      const { nativeScrollCanvasDown } = await import("./native-canvas-scroll");
      const session = await window.context().newCDPSession(window);
      let coverProbe: Awaited<ReturnType<typeof installCanvasCoverMutationProbe>> | undefined;
      let quietLayout: Awaited<ReturnType<typeof installCanvasLayoutWorkProbe>> | undefined;
      let scrollLayout: Awaited<ReturnType<typeof installCanvasLayoutWorkProbe>> | undefined;
      try {
        coverProbe = await installCanvasCoverMutationProbe(window);
        quietLayout = await installCanvasLayoutWorkProbe(window, session);
        await coverProbe.beginWindow("quiet");
        await window.evaluate(() => new Promise<void>((resolve) => globalThis.setTimeout(resolve, 2_000)));
        const quiet = await coverProbe.endWindow("quiet");
        const quietWork = await quietLayout.stop();
        await quietLayout.dispose();
        quietLayout = undefined;

        scrollLayout = await installCanvasLayoutWorkProbe(window, session);
        await coverProbe.beginWindow("native-scroll");
        const nativeScroll = await nativeScrollCanvasDown(window, session, canvas);
        const native = {
          status: nativeScroll.status,
          eventCount: nativeScroll.eventCount,
          observedMs: nativeScroll.observedMs,
          travelPx: nativeScroll.status === "completed" ? Math.round(nativeScroll.travelPx) : 0,
          legal: nativeScroll.legal,
        };
        const scrolling = await coverProbe.endWindow("native-scroll");
        const scrollWork = await scrollLayout.stop();
        expect(native.status).toBe("completed");
        expect(native.legal).toBe(true);
        expect(quiet.observedMs).toBeGreaterThanOrEqual(1_900);
        expect(scrolling.observedMs).toBeGreaterThanOrEqual(3_500);
        expect(quietWork.trace.status).toBe("complete");
        expect(scrollWork.trace.status).toBe("complete");
        expect(quietWork.trace.parsedEvents).toBeGreaterThan(0);
        expect(scrollWork.trace.parsedEvents).toBeGreaterThan(0);
        expect(quietWork.page.observedMs).toBeGreaterThanOrEqual(1_900);
        expect(scrollWork.page.observedMs).toBeGreaterThanOrEqual(3_500);
        await expect.poll(async () => (await visibleImageStats(window)).coverage,
          { timeout: 30_000 }).toBeGreaterThanOrEqual(0.9);
        const images = await visibleImageStats(window);
        expect(images.decodedImages).toBeGreaterThan(0);
        console.log("real canvas cover churn:", JSON.stringify({
          assets: imported.assets,
          quiet,
          quietLayout: { events: quietWork.trace.events, page: quietWork.page },
          native,
          scrolling,
          scrollLayout: { events: scrollWork.trace.events, page: scrollWork.page },
          images,
        }));
      } finally {
        try {
          await Promise.all([quietLayout?.dispose(), scrollLayout?.dispose()]);
        } finally {
          try {
            await coverProbe?.dispose();
          } finally {
            await session.detach();
          }
        }
      }
      return;
    }
    const styleDiagnostics = process.env.SERPENT_REAL_NAV_TRACE_STYLE === "invalidations"
      ? "invalidations" : process.env.SERPENT_REAL_NAV_TRACE_STYLE === "selectors"
        ? "selectors" : undefined;
    if (process.env.SERPENT_REAL_NAV_TRACE_CANVAS_LAYOUT === "1" || styleDiagnostics) {
      const canvas = window.locator(".workspace-canvas");
      if (styleDiagnostics) {
        await expect(window.locator('.navigation-pane button.nav-row[data-nav-folder-kind="linked"]').first())
          .toBeVisible({ timeout: 60_000 });
        const { scrollFromQuarterExtent } = await import("./canvas-style-sensitivity-probe");
        await scrollFromQuarterExtent(window);
      }
      await expect.poll(async () => (await visibleImageStats(window)).coverage,
        { timeout: 60_000 }).toBeGreaterThanOrEqual(0.9);
      const extent = await canvas.evaluate((element) => Math.max(0, element.scrollHeight - element.clientHeight));
      expect(extent).toBeGreaterThan(10_000);
      const session = await window.context().newCDPSession(window);
      const { installCanvasLayoutWorkProbe } = await import("./canvas-layout-work-probe");
      let probe: Awaited<ReturnType<typeof installCanvasLayoutWorkProbe>> | undefined;
      try {
        probe = await installCanvasLayoutWorkProbe(window, session,
          styleDiagnostics ? { styleDiagnostics } : undefined);
        await resetRendererCounters(window);
        // No remote locators, accessibility queries or geometry polling during
        // the trace: these can themselves force layout after a product write.
        const captureMs = styleDiagnostics === "invalidations" ? 200 : 2_000;
        await canvas.evaluate(async (element, { maxScroll, shortCapture, captureMs }) => {
          const waitFrames = (duration: number) => new Promise<void>((resolve) => {
            const start = performance.now();
            const frame = () => performance.now() - start >= duration
              ? resolve() : requestAnimationFrame(frame);
            requestAnimationFrame(frame);
          });
          if (!shortCapture) {
            performance.mark("serpent-layout:jump-start");
            for (const fraction of [0.05, 0.55, 0.85, 0.25]) {
              element.scrollTop = maxScroll * fraction;
              await waitFrames(1_500);
            }
          }
          const duration = shortCapture ? captureMs : 4_000;
          const base = shortCapture ? element.scrollTop : maxScroll * 0.25;
          performance.mark("serpent-layout:scroll-start");
          const start = performance.now();
          await new Promise<void>((resolve) => {
            const frame = () => {
              const elapsed = performance.now() - start;
              element.scrollTop = base + elapsed * 0.4;
              if (elapsed < duration) requestAnimationFrame(frame);
              else resolve();
            };
            requestAnimationFrame(frame);
          });
          performance.mark("serpent-layout:idle-start");
          if (!shortCapture) await waitFrames(1_000);
          performance.mark("serpent-layout:complete");
        }, { maxScroll: extent, shortCapture: Boolean(styleDiagnostics), captureMs });
        const layout = await probe.stop();
        if (layout.trace.status !== "complete") {
          console.log("real layout capture rejected:", JSON.stringify({
            mode: styleDiagnostics ?? "normal", status: layout.trace.status,
            bytesRead: layout.trace.bytesRead, events: layout.trace.parsedEvents,
            observedMs: layout.page.observedMs,
          }));
        }
        expect(layout.trace.status, "The diagnostic trace must be complete, without a byte cap or data loss")
          .toBe("complete");
        expect(layout.trace.parsedEvents, "The trace parser must observe actual browser events").toBeGreaterThan(0);
        expect(layout.trace.omittedEvents, "The event cap must not truncate this diagnostic").toBe(0);
        expect(layout.trace.invalidEvents, "Malformed trace events must not be treated as evidence").toBe(0);
        expect(layout.page.observedMs, "Renderer counters must cover the complete diagnostic gesture")
          .toBeGreaterThanOrEqual(styleDiagnostics ? captureMs : 10_000);
        await expect.poll(async () => (await visibleImageStats(window)).coverage,
          { timeout: 10_000 }).toBeGreaterThanOrEqual(0.9);
        const images = await visibleImageStats(window);
        expect(images.decodedImages).toBeGreaterThan(0);
        console.log("real canvas layout work:", JSON.stringify({ assets: imported.assets,
          layout, images, renderer: await readRendererProbe(window) }));
      } finally {
        try {
          await probe?.dispose();
        } finally {
          await session.detach();
        }
      }
      return;
    }
    if (process.env.SERPENT_REAL_NAV_PROBE_FOLDER_MUTATION_ACCEPTANCE === "1") {
      const { probeFolderMutationAcceptance } = await import("./folder-mutation-acceptance-probe");
      const acceptance = await probeFolderMutationAcceptance({ application, window,
        libraryId: imported.libraryId, ownedRoot: root, readOnlySourceRoot: resolvedSource });
      console.log("real folder mutation acceptance:", JSON.stringify({ assets: imported.assets, acceptance }));
      return;
    }
    if (process.env.SERPENT_REAL_NAV_PROBE_FOLDER_INTERACTIONS === "1") {
      const cpuSession = process.env.SERPENT_REAL_NAV_PROFILE_FOLDER_INTERACTIONS === "1"
        ? await window.context().newCDPSession(window) : undefined;
      await cpuSession?.send("Profiler.enable");
      await cpuSession?.send("Profiler.start");
      let interactions: Awaited<ReturnType<typeof probeFolderInteractions>>;
      let cpu: Array<{ name: string; source: string; line: number; column: number; samples: number }> | undefined;
      try {
        interactions = await probeFolderInteractions(window, { libraryId: imported.libraryId, repetitions: 3 });
        if (cpuSession) {
          const { profile } = await cpuSession.send("Profiler.stop");
          cpu = profile.nodes.map(node => ({ name: node.callFrame.functionName || "(anonymous)",
            source: node.callFrame.url.includes("/assets/") ? "bundle" : "runtime-or-probe",
            line: node.callFrame.lineNumber, column: node.callFrame.columnNumber, samples: node.hitCount ?? 0,
          })).sort((left, right) => right.samples - left.samples).slice(0, 20);
        }
      } finally { await cpuSession?.detach(); }
      const records = readSessionLog(path.join(root, "profile")).split(/\r?\n/).flatMap(line => {
        try {
          const record = JSON.parse(line) as { timestamp?: string; scope?: string; context?: Record<string, unknown> };
          if (record.scope !== "worker.cmd") return [];
          const context = record.context ?? {};
          if (!["folder.create", "browse.session.open", "library.navigation-summary", "folder.browse-entries"].includes(String(context.type))) return [];
          return [{ atMs: Date.parse(record.timestamp ?? ""), command: context.type,
            queueMs: context.queueMs, schedulerWaitMs: context.schedulerWaitMs, runMs: context.runMs, outcome: context.outcome }];
        } catch { return []; }
      });
      const worker = [...new Set(records.map(record => record.command))].map(command => {
        const rows = records.filter(record => record.command === command);
        const timings = (field: "queueMs" | "schedulerWaitMs" | "runMs") => summarizeTimings(rows
          .map(row => row[field]).filter((value): value is number => typeof value === "number"));
        return { command, count: rows.length, queue: timings("queueMs"), scheduler: timings("schedulerWaitMs"), run: timings("runMs") };
      });
      console.log("real folder interactions:", JSON.stringify({ assets: imported.assets,
        importMs: Math.round(imported.importMs), interactions, worker, cpu }));
      return;
    }
    const profiler = await window.context().newCDPSession(window);
    const stageProbe = process.env.SERPENT_REAL_NAV_TRACE_STAGES === "1"
      ? await installBrowseJumpStageProbe(window, profiler) : null;
    const canvas = window.locator(".workspace-canvas");
    const jumps: Array<Record<string, unknown>> = [];
    for (const fraction of jumpFractions) {
      reportPhase(`jump-${fraction}`);
      await resetRendererCounters(window);
      await stageProbe?.reset();
      const started = Date.now();
      await canvas.evaluate((el, ratio) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * ratio; }, fraction);
      let firstDecodedMs: number | null = null;
      let mostlyDecodedMs: number | null = null;
      // Read only viewport-intersecting cards. The fixed observation tail also
      // captures dimension/thumbnail churn after the first image arrives.
      while (Date.now() - started < 2000) {
        const stats = await visibleImageStats(window);
        if (stats.decodedImages > 0 && firstDecodedMs === null) firstDecodedMs = Date.now() - started;
        if (stats.imageCards > 0 && stats.coverage >= 0.9 && mostlyDecodedMs === null) mostlyDecodedMs = Date.now() - started;
        await window.waitForTimeout(40);
      }
      const images = await visibleImageStats(window);
      console.log("real jump observation:", JSON.stringify({ fraction,
        observedMs: Date.now() - started, firstDecodedMs, mostlyDecodedMs, images }));
      if (images.coverage < 0.9) {
        const missing = await sampleMissingPreviewCards(window, imported.libraryId, started);
        let mediaQueue: ReturnType<typeof collectLatePreviewQueueStages> = { assets: [] };
        let competingWork: ReturnType<typeof collectCompetingWorkStages> | null = null;
        if (missing.assetIds.length > 0) {
          const logText = readSessionLog(path.join(root, "profile"));
          const endedEpochMs = Date.now();
          mediaQueue = collectLatePreviewQueueStages({
            logText,
            libraryId: imported.libraryId,
            assetIds: missing.assetIds,
            startedEpochMs: started,
            endedEpochMs,
          });
          competingWork = collectCompetingWorkStages({
            logText,
            libraryId: imported.libraryId,
            targetAssetIds: missing.assetIds,
            startedEpochMs: started,
            endedEpochMs,
          });
        }
        const delayedCoverage = [];
        for (let observation = 0; observation < 10; observation += 1) {
          await window.waitForTimeout(500);
          const snapshot = await visibleImageStats(window);
          delayedCoverage.push({ atMs: Date.now() - started, decoded: snapshot.decodedImages,
            imageCards: snapshot.imageCards });
          if (snapshot.coverage >= 0.9) break;
        }
        console.log("real late decode diagnostic:", JSON.stringify({ fraction,
          missing: { queryStatus: missing.queryStatus, cards: missing.cards },
          queueSnapshot: missing.queueSnapshot, mediaQueue, competingWork, delayedCoverage,
          ...(stageProbe ? { stages: await stageProbe.read() } : {}) }));
      }
      expect(images.decodedImages, `jump ${fraction} must decode actual visible media`).toBeGreaterThan(0);
      const actualFraction = await canvas.evaluate(el => el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight));
      expect(Math.abs(actualFraction - fraction), `jump ${fraction} must reach its target`).toBeLessThan(0.01);
      expect(images.coverage, `jump ${fraction} must decode at least 90% of visible images`).toBeGreaterThanOrEqual(0.9);
      if (mostlyDecodedMs === null) mostlyDecodedMs = Date.now() - started;
      jumps.push({ fraction, observedMs: Date.now() - started,
        startedEpochMs: started,
        actualFraction, firstDecodedMs, mostlyDecodedMs,
        ...(stageProbe ? { stages: await stageProbe.read() } : {}),
        images, renderer: await readRendererProbe(window) });
    }
    if (process.env.SERPENT_REAL_NAV_PROBE_STYLE_SENSITIVITY_AFTER_JUMPS === "1") {
      await measureStyleSensitivity("after-random-jumps");
      await profiler.detach();
      return;
    }
    if (geometryProbeMode === "parity" && viewportGeometry) {
      reportPhase("viewport-geometry-parity");
      const checkpoints = [];
      for (const mode of ["平铺视图", "瀑布流视图"] as const) {
        const modeButton = window.getByRole("button", { name: mode, exact: true });
        await modeButton.click();
        await expect(modeButton).toHaveAttribute("aria-pressed", "true");
        for (const fraction of [0, 0.55, 0.999]) {
          reportPhase(`viewport-geometry-${mode === "平铺视图" ? "justified" : "masonry"}-${fraction}`);
          await canvas.evaluate((element, ratio) => {
            element.scrollTop = (element.scrollHeight - element.clientHeight) * ratio;
          }, fraction);
          await expect.poll(async () => (await visibleImageStats(window)).coverage,
            { timeout: 15_000 }).toBeGreaterThanOrEqual(0.9);
          // This is a correctness-only window. Let the 80ms report catch up;
          // reference DOM reads are deliberately outside ordinary FPS samples.
          await window.waitForTimeout(160);
          // The first poll may have observed decoded cards from the previous
          // mounted slice. Require decoding again after the window commits.
          await expect.poll(async () => (await visibleImageStats(window)).coverage,
            { timeout: 15_000 }).toBeGreaterThanOrEqual(0.9);
          const images = await visibleImageStats(window);
          const checkpoint = await viewportGeometry.checkpoint();
          checkpoints.push({ mode: mode === "平铺视图" ? "justified" : "masonry", fraction,
            visibleImages: images.imageCards, decoded: images.decodedImages, checkpoint });
          console.log("real viewport geometry checkpoint:", JSON.stringify({
            ...checkpoints.at(-1), comparisons: (await viewportGeometry.read()).comparisons,
          }));
          if (checkpoint.mismatches > 0 && process.env.SERPENT_REAL_NAV_DIAGNOSE_REPORT_REARM === "1") {
            const beforeTop = await canvas.evaluate(element => element.scrollTop);
            await canvas.evaluate(element => element.dispatchEvent(new Event("scroll")));
            await window.waitForTimeout(160);
            console.log("real viewport geometry checkpoint:", JSON.stringify({
              diagnostic: "notification-only-rearm", beforeTop,
              afterTop: await canvas.evaluate(element => element.scrollTop),
              checkpoint: await viewportGeometry.checkpoint(),
              comparisons: (await viewportGeometry.read()).comparisons,
            }));
            // Keep asserting the original checkpoint below. Rearming is a
            // diagnostic intervention, never a way to make correctness pass.
          }
          expect(images.imageCards).toBeGreaterThan(0);
          expect(images.coverage).toBeGreaterThanOrEqual(0.9);
          expect(checkpoint.checkpointCompared).toBe(1);
          expect(checkpoint.mismatches).toBe(0);
        }
      }
      const geometry = await viewportGeometry.read();
      if (nativeCapture) {
        const stats = await nativeCapture.stop();
        nativeCapture = undefined;
        nativeCaptureControl = { ...nativeCaptureControl, ...stats, captureStoppedBeforeCleanup: true };
        expect(stats.frameEvents).toBeGreaterThan(0);
        expect(stats.ackFailures).toBe(0);
      }
      const parityRenderingMode = await readRenderingMode();
      expect(parityRenderingMode.windowVisible).toBe(false);
      console.log("real viewport geometry parity:", JSON.stringify({ assets: imported.assets,
        renderingMode: parityRenderingMode, nativeCaptureControl, checkpoints, geometry }));
      expect(geometry.comparisons.events).toBeGreaterThan(0);
      expect(geometry.comparisons.mismatches).toBe(0);
      expect(geometry.pageErrors).toBe(0);
      await profiler.detach();
      return;
    }
    if (process.env.SERPENT_REAL_NAV_FRAME_IDLE_BASELINE === "1") {
      await resetRendererCounters(window);
      await window.evaluate(() => new Promise<void>(resolve => globalThis.setTimeout(resolve, 2_000)));
      console.log("real idle frame baseline:", JSON.stringify(await readRendererProbe(window)));
    }
    const countRenderCalls = process.env.SERPENT_REAL_NAV_COUNT_RENDER_CALLS === "1";
    const profileScroll = !countRenderCalls && process.env.SERPENT_REAL_NAV_PROFILE_SCROLL !== "0";
    if (profileScroll) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
    }
    const nativeLayout = process.env.SERPENT_REAL_NAV_TRACE_NATIVE_SCROLL === "1"
      ? await (await import("./canvas-layout-work-probe")).installCanvasLayoutWorkProbe(window, profiler)
      : undefined;
    const renderCallProbe = countRenderCalls ? await installRenderFunctionCallProbe(profiler) : undefined;
    // Profiler startup pauses the renderer. Start frame observations after it
    // so setup time cannot masquerade as a scrolling frame gap.
    let nativeScroll: NativeCanvasScrollResult | undefined;
    let nativeLayoutWork: CanvasLayoutWorkSummary | undefined;
    let scrollGeometry: ViewportGeometrySnapshot | undefined;
    let scrollRenderer: Awaited<ReturnType<typeof readRendererProbe>>;
    const profile = await (async () => {
      try {
        reportPhase("scrolling");
        await viewportGeometry?.reset();
        await resetRendererCounters(window);
        if (process.env.SERPENT_REAL_NAV_NATIVE_SCROLL === "1") {
          const { nativeScrollCanvasDown } = await import("./native-canvas-scroll");
          nativeScroll = await nativeScrollCanvasDown(window, profiler, canvas);
        } else {
          await canvas.evaluate(async el => {
            const started = performance.now();
            const top = el.scrollTop;
            await new Promise<void>(resolve => {
              const frame = () => {
                const elapsed = performance.now() - started;
                el.scrollTop = top + elapsed * 0.4;
                if (elapsed < 4000) requestAnimationFrame(frame);
                else resolve();
              };
              requestAnimationFrame(frame);
            });
          });
        }
        // Capture counters and stop CPU sampling before parsing the trace;
        // reporting work must not extend the observed scroll window.
        scrollRenderer = await readRendererProbe(window);
        scrollGeometry = await viewportGeometry?.read();
        return profileScroll ? (await profiler.send("Profiler.stop")).profile : undefined;
      } finally {
        try {
          if (renderCallProbe) {
            const calibrate = process.env.SERPENT_REAL_NAV_CALIBRATE_RENDER_CALLS === "1";
            if (calibrate) {
              // V8 can omit functions with no calls in this window. Mount one
              // owned folder glyph so an absent entry is not guessed as zero.
              await window.getByRole("button", { name: "添加文件夹", exact: true }).click();
              const markerInput = window.locator(".nav-inline-edit input");
              await expect(markerInput).toBeVisible();
              await markerInput.fill("RenderCallMarker");
              await markerInput.press("Enter");
              await expect(window.locator(".navigation-pane .nav-row-label")
                .filter({ hasText: /^RenderCallMarker$/ })).toBeVisible({ timeout: 10_000 });
            }
            console.log("real render calls:", JSON.stringify({
              scope: calibrate ? "native-scroll-plus-one-owned-folder" : "native-scroll",
              ...await renderCallProbe.stop(),
            }));
          }
          if (nativeLayout) {
            nativeLayoutWork = await nativeLayout.stop();
            console.log("real native scroll work:", JSON.stringify(nativeLayoutWork));
          }
        } finally {
          try { await renderCallProbe?.dispose(); }
          finally { await nativeLayout?.dispose(); }
        }
      }
    })();
    if (nativeLayoutWork) {
      expect(nativeLayoutWork.trace.status).toBe("complete");
      expect(nativeLayoutWork.trace.omittedEvents).toBe(0);
      expect(nativeLayoutWork.trace.invalidEvents).toBe(0);
      expect(nativeLayoutWork.page.observedMs).toBeGreaterThanOrEqual(3_500);
    }
    if (scrollGeometry) {
      expect(scrollGeometry.reads.total).toBeGreaterThan(0);
      expect(scrollGeometry.pageErrors).toBe(0);
    }
    const byFunction = new Map<string, { functionName: string; samples: number }>();
    for (const node of profile?.nodes ?? []) {
      const name = node.callFrame.functionName || "(anonymous)";
      const previous = byFunction.get(name);
      byFunction.set(name, { functionName: name, samples: (previous?.samples ?? 0) + (node.hitCount ?? 0) });
    }
    const scroll = { input: nativeScroll?.status === "completed"
      ? nativeScroll.input : nativeScroll?.status === "unsupported" ? nativeScroll.input : "javascript-scrollTop-rAF",
      ...(nativeScroll ? { native: nativeScroll } : {}),
      ...(scrollGeometry ? { viewportGeometry: scrollGeometry } : {}),
      renderer: scrollRenderer!, hasCpuProfiler: profileScroll,
      scriptSamples: profile ? profile.nodes.reduce((sum, node) =>
        sum + (["(idle)", "(program)"].includes(node.callFrame.functionName) ? 0 : node.hitCount ?? 0), 0) : null,
      ...(profile && process.env.SERPENT_REAL_NAV_PROFILE_DETAIL === "1"
        ? { cpuWork: summarizeCpuProfileWork(profile) } : {}),
      hotFunctions: [...byFunction.values()].sort((a, b) => b.samples - a.samples).slice(0, 15) };
    await profiler.detach();
    if (nativeScroll?.status === "unsupported") {
      throw new Error("Native canvas scroll is unsupported: " + nativeScroll.reason);
    }
    if (nativeScroll?.status === "completed") {
      expect(nativeScroll.legal, "The native scroll must remain within the canvas range and travel downward")
        .toBe(true);
      expect(nativeScroll.travelPx, "The native scroll must travel over 1000 pixels").toBeGreaterThan(1_000);
      expect(nativeScroll.observedMs, "The native scroll must be observed for at least 3000 ms")
        .toBeGreaterThanOrEqual(3_000);
    }
    await expect.poll(async () => (await visibleImageStats(window)).coverage,
      { timeout: 5000 }).toBeGreaterThanOrEqual(0.9);
    const scrollImages = await visibleImageStats(window);
    if (process.env.SERPENT_REAL_NAV_PROBE_PARTIAL_DECODE === "1" && scrollImages.coverage < 1) {
      const lastJumpEpoch = jumps.at(-1)?.startedEpochMs;
      const referenceEpoch = typeof lastJumpEpoch === "number" ? lastJumpEpoch : Date.now();
      const missing = await sampleMissingPreviewCards(window, imported.libraryId, referenceEpoch);
      console.log("real partial decode tail:", JSON.stringify({
        phase: "after-native-scroll",
        before: scrollImages,
        queryStatus: missing.queryStatus,
        timeBase: "last-jump",
        cards: missing.cards,
        queue: {
          queryStatus: missing.queueSnapshot.queryStatus,
          hasMore: missing.queueSnapshot.hasMore,
          targets: missing.queueSnapshot.targets.map(target => ({
            ordinal: target.ordinal,
            matchStatus: target.matchStatus,
            jobs: target.jobs.map(({ kind, status, attemptCount }) => ({ kind, status, attemptCount })),
          })),
        },
      }));
      await window.waitForTimeout(1_000);
      const targets = await window.evaluate(assetIds => assetIds.map((assetId, index) => {
        const card = [...document.querySelectorAll<HTMLElement>(".asset-card[data-asset-id]")]
          .find(candidate => candidate.dataset.assetId === assetId);
        const image = card?.querySelector<HTMLImageElement>("img.asset-thumbnail");
        return { ordinal: index + 1, mounted: Boolean(card),
          decoded: image?.complete === true && image.naturalWidth > 0 && image.naturalHeight > 0 };
      }), missing.assetIds);
      console.log("real partial decode settled:", JSON.stringify({
        images: await visibleImageStats(window), targets,
        jobs: collectLatePreviewQueueStages({ logText: readSessionLog(path.join(root, "profile")),
          assetIds: missing.assetIds, startedEpochMs: referenceEpoch, endedEpochMs: Date.now() }),
      }));
    }
    reportPhase("creating-folder");
    await window.getByRole("button", { name: "添加文件夹", exact: true }).click();
    const input = window.locator(".nav-inline-edit input");
    await expect(input).toBeVisible();
    await input.fill("CreatedDuringRealMediaWork");
    const started = Date.now();
    await input.press("Enter");
    await expect(window.locator(".navigation-pane .nav-row-label").filter({ hasText: /^CreatedDuringRealMediaWork$/ }))
      .toBeVisible({ timeout: 120_000 });
    const createVisibleMs = Date.now() - started;
    let burst: Record<string, unknown> | undefined;
    if (process.env.SERPENT_REAL_NAV_BURST_JUMPS === "1") {
      await resetRendererCounters(window);
      await stageProbe?.reset();
      burst = await probeBrowseBurst(window);
      if (stageProbe) burst.stages = await stageProbe.read();
      burst.renderer = await readRendererProbe(window);
    }
    if (stageProbe) {
      const records = readSessionLog(path.join(root, "profile")).split(/\r?\n/).flatMap(line => {
        try {
          const record = JSON.parse(line) as { timestamp?: string; scope?: string; context?: Record<string, unknown> };
          if (record.scope !== "worker.media-queue") return [];
          return [{ atMs: Date.parse(record.timestamp ?? ""), context: record.context ?? {} }];
        } catch { return []; }
      });
      for (const jump of [...jumps, ...(burst ? [burst] : [])]) {
        const started = jump.startedEpochMs as number;
        const within = records.filter(record => record.atMs >= started && record.atMs <= started + (jump.observedMs as number));
        const durations = (stage: string, field: string) => summarizeTimings(within
          .filter(record => record.context.mediaStage === stage && typeof record.context[field] === "number")
          .map(record => record.context[field] as number));
        jump.worker = {
          headerAdmission: durations("image-header-finish", "admissionMs"),
          headerRead: durations("image-header-finish", "readMs"),
          metadataFile: durations("image-dimensions-persisted", "fileMs"),
          metadataDatabase: durations("image-dimensions-persisted", "databaseMs"),
        };
      }
    }
    const duplicateDimensions = process.env.SERPENT_REAL_NAV_PROBE_DUPLICATE_DIMENSIONS === "1"
      ? await probeDuplicateDimensions(application, window, imported.libraryId) : undefined;
    if (nativeCapture) {
      const stats = await nativeCapture.stop();
      nativeCapture = undefined;
      renderingMode = await readRenderingMode();
      nativeCaptureControl = { ...nativeCaptureControl, ...stats, captureStoppedBeforeCleanup: true };
      expect(stats.frameEvents).toBeGreaterThan(0);
      expect(stats.ackFailures).toBe(0);
      expect(renderingMode.windowVisible).toBe(false);
    }
    console.log("real linked navigation:", JSON.stringify({
      assets: imported.assets, importMs: Math.round(imported.importMs),
      renderingMode,
      ...(nativeCaptureControl ? { nativeCaptureControl } : {}),
      createVisibleMs, jumps, scroll, scrollImages, duplicateDimensions, burst, navigationFolderRows,
      ...(aiConnectionContention ? { aiConnectionContention } : {}),
      ...(compareRowPolicy ? { navigationRowPolicy } : {}),
    }));
  } catch (error) {
    const page = application?.windows()[0];
    const viewport = await page?.evaluate(() => ({
      documentVisibility: document.visibilityState,
      hasLibraryIdentity: Boolean(document.querySelector(".library-switcher-name")?.textContent?.trim()),
      canvas: document.querySelector(".workspace-canvas") !== null,
      cards: document.querySelectorAll(".workspace-canvas .asset-card").length,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      confirmations: document.querySelectorAll("#local-confirmation-dialog").length,
    })).catch(() => null);
    const failure = error as { name?: unknown; message?: unknown; matcherResult?: { name?: unknown; actual?: unknown; expected?: unknown } };
    const primitive = (value: unknown) => typeof value === "boolean" || typeof value === "number" ? value : null;
    console.log("real linked navigation failure:", JSON.stringify({
      phase,
      errorName: typeof failure.name === "string" && /^[A-Za-z0-9_.-]{1,64}$/u.test(failure.name) ? failure.name : "unknown",
      timeout: typeof failure.message === "string" && /timeout/iu.test(failure.message),
      matcher: typeof failure.matcherResult?.name === "string" && /^\w{1,64}$/u.test(failure.matcherResult.name) ? failure.matcherResult.name : null,
      actual: primitive(failure.matcherResult?.actual),
      expected: primitive(failure.matcherResult?.expected),
      viewport: viewport ?? null,
    }));
    throw error;
  } finally {
    try {
      await viewportGeometry?.dispose();
    } catch (error) {
      expect.soft(error, "The viewport geometry probe must restore its method and listener.").toBeUndefined();
    }
    try {
      await nativeCapture?.stop();
    } catch (error) {
      expect.soft(error, "The test-owned native capture must stop before closing.").toBeUndefined();
    }
    try {
      await rowPolicyOverride?.evaluate((style) => style.remove());
      await rowPolicyOverride?.dispose();
    } catch (error) {
      expect.soft(error, "The test-owned row policy override must be released.").toBeUndefined();
    }
    try {
      await application?.close();
    } catch (error) {
      expect.soft(error, "The isolated application must close before cleanup.").toBeUndefined();
    }
    try {
      cleanOwnedCatalog(root, workspace, child, launchAttempted);
    } catch (error) {
      // Preserve the primary test failure while independently failing cleanup.
      expect.soft(error, "The test-owned catalog must be safely cleaned.").toBeUndefined();
    }
  }
});
