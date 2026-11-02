import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

import {
  electronLaunchEnv,
  resolveElectronExecutablePath,
  resolveSessionLogPath,
} from "./electron-test-helpers";

/**
 * Shared instrumentation for the operator-run navigation benchmarks
 * (Serpent-217028). Everything here is measurement-only: the app under test is
 * launched exactly as `npm run test:e2e` launches it, and all extra detail
 * comes from log gates and in-page probes that already exist or are gated by
 * an environment variable, so a benchmark run never changes product behaviour.
 *
 * Library paths are always supplied through environment variables. Nothing in
 * this file (or its callers) stores a real path, library name or asset name.
 */

/** Log gates that turn the Worker/Main diagnostics into a measurable span set. */
export function benchmarkLogEnv(logDirectory: string): Record<string, string> {
  return {
    SERPENT_WORKER_CMD_LOG: "1",
    SERPENT_LAG_LOG: "1",
    SERPENT_MEDIA_QUEUE_LOG: "1",
    SERPENT_REFRESH_STAGE_LOG: "1",
    SERPENT_OPEN_STAGE_LOG: "1",
    SERPENT_CLOSE_TRACE: "1",
    SERPENT_VIEWER_TIMING_LOG: "1",
    // The preview cache is disabled under SERPENT_E2E unless forced. Default
    // benchmark runs exercise the production cache path, while an explicit
    // SERPENT_PREVIEW_CACHE_FORCE=0 lets cold-origin reads be profiled too.
    SERPENT_PREVIEW_CACHE_FORCE: process.env.SERPENT_PREVIEW_CACHE_FORCE ?? "1",
    SERPENT_PREVIEW_CACHE_LOG: "1",
    SERPENT_E2E_LIBRARY_TRACE: "1",
    SERPENT_LAG_LOG_DIR: logDirectory,
  };
}

export type BenchmarkApp = {
  application: ElectronApplication;
  window: Page;
};

/**
 * Seed the isolated profile's recent-library list so the UI can open and switch
 * libraries without driving a native directory dialog. `libraryId` is omitted on
 * purpose: the schema requires a UUID and a wrong one invalidates the whole file.
 */
export function seedRecentLibraries(
  userDataPath: string,
  libraryPaths: readonly string[],
  activePath: string,
): void {
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(
    path.join(userDataPath, "recent-library.json"),
    JSON.stringify({
      version: 2,
      activePath,
      libraries: libraryPaths.map((libraryPath) => ({
        path: libraryPath,
        name: path.basename(libraryPath),
        lastOpenedAt: new Date().toISOString(),
      })),
    }),
  );
}

export async function launchBenchmarkApp(options: {
  userDataPath: string;
  openLibraryPath?: string;
  extraEnv?: Record<string, string>;
}): Promise<BenchmarkApp> {
  mkdirSync(options.userDataPath, { recursive: true });
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: electronLaunchEnv({
      SERPENT_E2E: "1",
      SERPENT_E2E_PERF_OFFSCREEN: "1",
      SERPENT_E2E_RESTORE_RECENT: "1",
      SERPENT_E2E_USER_DATA_PATH: options.userDataPath,
      ...(options.openLibraryPath === undefined
        ? {}
        : { SERPENT_E2E_OPEN_LIBRARY_PATH: options.openLibraryPath }),
      ...benchmarkLogEnv(path.join(options.userDataPath, "logs")),
      ...(options.extraEnv ?? {}),
    }),
  });
  const window = await application.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  // Keep the busy-switch benchmark moving through the shared renderer decision.
  await window.addLocatorHandler(window.locator('#local-confirmation-dialog'), async () => {
    await window.locator('#local-confirmation-dialog .ui-button--primary').click();
  });
  return { application, window };
}

export function readSessionLog(userDataPath: string): string {
  try {
    return readFileSync(resolveSessionLogPath(path.join(userDataPath, "logs")), "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// statistics
// ---------------------------------------------------------------------------

export type TimingSummary = {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  meanMs: number;
  totalMs: number;
};

/** Nearest-rank percentiles, matching `summarizeTimingSamples` in the product. */
export function summarizeTimings(samplesMs: readonly number[]): TimingSummary {
  if (samplesMs.length === 0) {
    return { count: 0, minMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0, meanMs: 0, totalMs: 0 };
  }
  const ordered = [...samplesMs].sort((left, right) => left - right);
  const at = (fraction: number): number =>
    ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))]!;
  const totalMs = ordered.reduce((sum, value) => sum + value, 0);
  return {
    count: ordered.length,
    minMs: round(ordered[0]!),
    p50Ms: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(ordered[ordered.length - 1]!),
    meanMs: round(totalMs / ordered.length),
    totalMs: round(totalMs),
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

// ---------------------------------------------------------------------------
// renderer-side probe
// ---------------------------------------------------------------------------

export type RendererProbe = {
  longTaskCount: number;
  longTaskMaxMs: number;
  longTaskTotalMs: number;
  slotCreated: number;
  slotRemoved: number;
  /** Distinct observed element/src bindings, including initial attachment; not network requests. */
  mediaSrcWrites: number;
  maxSrcWritesOnOneElement: number;
  distinctMediaUrls: number;
  frameSamples: number;
  frameMaxMs: number;
  frameP95Ms: number;
  browseRequests: number;
  browseResults: number;
  browsePages: number;
};

/**
 * Install the in-page probes once per window: long tasks, card mount/move churn,
 * `src` reassignment churn, rAF frame deltas and the renderer's own browse-page
 * events (`serpent:e2e-browse-*`, emitted by `use-browse-pagination`).
 */
export async function installRendererProbe(window: Page): Promise<void> {
  await window.evaluate(() => {
    type ProbeState = {
      longTasks: number[];
      slotCreated: number;
      slotRemoved: number;
      mediaSrcWrites: number;
      srcWritesByElement: WeakMap<Element, number>;
      lastSrcByElement: WeakMap<Element, string>;
      maxSrcWritesOnOneElement: number;
      srcSet: Set<string>;
      frameDeltas: number[];
      browseRequests: number;
      browseResults: number;
      browsePages: number;
    };
    const probe: ProbeState = {
      longTasks: [],
      slotCreated: 0,
      slotRemoved: 0,
      mediaSrcWrites: 0,
      srcWritesByElement: new WeakMap(),
      lastSrcByElement: new WeakMap(),
      maxSrcWritesOnOneElement: 0,
      srcSet: new Set(),
      frameDeltas: [],
      browseRequests: 0,
      browseResults: 0,
      browsePages: 0,
    };
    (globalThis as unknown as { __perfBenchProbe: ProbeState }).__perfBenchProbe = probe;

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) probe.longTasks.push(entry.duration);
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // longtask is Chromium-only; a missing entry type must not fail the run.
    }

    const slotsIn = (node: Node): number => {
      if (!(node instanceof HTMLElement)) return 0;
      return (node.matches("[data-layout-index]") ? 1 : 0)
        + node.querySelectorAll("[data-layout-index]").length;
    };
    const recordSrc = (image: HTMLImageElement): void => {
      const src = image.getAttribute("src");
      if (!src || !src.startsWith("serpent://")) return;
      // An inserted image can be reported both by childList and by a src
      // attribute record in the same observer batch. Count one binding per
      // element/source pair, not two observer records for one DOM update.
      if (probe.lastSrcByElement.get(image) === src) return;
      probe.lastSrcByElement.set(image, src);
      probe.mediaSrcWrites += 1;
      probe.srcSet.add(src);
      const writes = (probe.srcWritesByElement.get(image) ?? 0) + 1;
      probe.srcWritesByElement.set(image, writes);
      probe.maxSrcWritesOnOneElement = Math.max(probe.maxSrcWritesOnOneElement, writes);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          probe.slotCreated += slotsIn(node);
          if (!(node instanceof HTMLElement)) continue;
          const images = node.matches("img.asset-thumbnail")
            ? [node as HTMLImageElement]
            : Array.from(node.querySelectorAll<HTMLImageElement>("img.asset-thumbnail"));
          for (const image of images) recordSrc(image);
        }
        for (const node of Array.from(record.removedNodes)) {
          probe.slotRemoved += slotsIn(node);
        }
        if (record.type === "attributes" && record.target instanceof HTMLImageElement) {
          recordSrc(record.target);
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });

    const tick = (): void => {
      const now = performance.now();
      const previous = (globalThis as unknown as { __perfBenchLastFrame?: number }).__perfBenchLastFrame;
      if (previous !== undefined) probe.frameDeltas.push(now - previous);
      (globalThis as unknown as { __perfBenchLastFrame?: number }).__perfBenchLastFrame = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    globalThis.addEventListener("serpent:e2e-browse-request", () => {
      probe.browseRequests += 1;
    });
    globalThis.addEventListener("serpent:e2e-browse-result", () => {
      probe.browseResults += 1;
    });
    globalThis.addEventListener("serpent:e2e-browse-page", () => {
      probe.browsePages += 1;
    });
  });
}

export async function readRendererProbe(window: Page): Promise<RendererProbe> {
  return window.evaluate(() => {
    const probe = (globalThis as unknown as {
      __perfBenchProbe: {
        longTasks: number[];
        slotCreated: number;
        slotRemoved: number;
        mediaSrcWrites: number;
        maxSrcWritesOnOneElement: number;
        srcSet: Set<string>;
        frameDeltas: number[];
        browseRequests: number;
        browseResults: number;
        browsePages: number;
      };
    }).__perfBenchProbe;
    const frames = probe.frameDeltas.filter((value) => value > 0);
    const ordered = [...frames].sort((left, right) => left - right);
    const at = (fraction: number): number =>
      ordered.length === 0
        ? 0
        : ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))]!;
    return {
      longTaskCount: probe.longTasks.length,
      longTaskMaxMs: Number(Math.max(0, ...probe.longTasks).toFixed(2)),
      longTaskTotalMs: Number(probe.longTasks.reduce((sum, value) => sum + value, 0).toFixed(2)),
      slotCreated: probe.slotCreated,
      slotRemoved: probe.slotRemoved,
      mediaSrcWrites: probe.mediaSrcWrites,
      maxSrcWritesOnOneElement: probe.maxSrcWritesOnOneElement,
      distinctMediaUrls: probe.srcSet.size,
      frameSamples: frames.length,
      frameMaxMs: Number(Math.max(0, ...frames).toFixed(2)),
      frameP95Ms: Number(at(0.95).toFixed(2)),
      browseRequests: probe.browseRequests,
      browseResults: probe.browseResults,
      browsePages: probe.browsePages,
    };
  });
}

/** Reset the churn counters between benchmark phases without re-installing. */
export async function resetRendererCounters(window: Page): Promise<void> {
  await window.evaluate(() => {
    const probe = (globalThis as unknown as {
      __perfBenchProbe: {
        longTasks: number[];
        slotCreated: number;
        slotRemoved: number;
        mediaSrcWrites: number;
        srcWritesByElement: WeakMap<Element, number>;
        lastSrcByElement: WeakMap<Element, string>;
        maxSrcWritesOnOneElement: number;
        srcSet: Set<string>;
        frameDeltas: number[];
        browseRequests: number;
        browseResults: number;
        browsePages: number;
      };
    }).__perfBenchProbe;
    probe.longTasks = [];
    probe.slotCreated = 0;
    probe.slotRemoved = 0;
    probe.mediaSrcWrites = 0;
    probe.srcWritesByElement = new WeakMap();
    probe.lastSrcByElement = new WeakMap();
    probe.maxSrcWritesOnOneElement = 0;
    probe.srcSet = new Set();
    probe.frameDeltas = [];
    probe.browseRequests = 0;
    probe.browseResults = 0;
    probe.browsePages = 0;
  });
}

// ---------------------------------------------------------------------------
// visible-image coverage (the strict definition used by the 20k scroll gate)
// ---------------------------------------------------------------------------

export type VisibleImageStats = {
  visibleCards: number;
  imageCards: number;
  decodedImages: number;
  placeholders: number;
  defaultIcons: number;
  coverage: number;
  scrollTop: number;
  scrollHeight: number;
};

export async function visibleImageStats(window: Page): Promise<VisibleImageStats> {
  return window.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!canvas) {
      return {
        visibleCards: 0,
        imageCards: 0,
        decodedImages: 0,
        placeholders: 0,
        defaultIcons: 0,
        coverage: 0,
        scrollTop: 0,
        scrollHeight: 0,
      };
    }
    const canvasRect = canvas.getBoundingClientRect();
    const visible = [...document.querySelectorAll<HTMLElement>(".asset-card:not(.is-layout-preview)")]
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.bottom > canvasRect.top
          && rect.top < canvasRect.bottom
          && rect.right > canvasRect.left
          && rect.left < canvasRect.right;
      });
    const placeholders = visible.filter((card) =>
      card.classList.contains("is-browse-placeholder")
      || card.dataset.assetId?.startsWith("__pending:"),
    ).length;
    const imageCards = visible.filter((card) => card.dataset.mediaType === "image");
    const decodedImages = imageCards.filter((card) => {
      const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
      return image?.complete === true && image.naturalWidth > 0 && image.naturalHeight > 0;
    }).length;
    const defaultIcons = visible.filter((card) =>
      !card.classList.contains("is-browse-placeholder")
      && !card.querySelector("img.asset-thumbnail"),
    ).length;
    return {
      visibleCards: visible.length,
      imageCards: imageCards.length,
      decodedImages,
      placeholders,
      defaultIcons,
      coverage: imageCards.length === 0 ? 1 : decodedImages / imageCards.length,
      scrollTop: canvas.scrollTop,
      scrollHeight: canvas.scrollHeight,
    };
  });
}

/**
 * Wait until the visible image cards are decoded, returning elapsed ms.
 * `minRatio` of 0.8 is the "viewport mostly painted" budget; 1 is strict.
 */
export async function waitForVisibleDecoded(
  window: Page,
  minRatio: number,
  timeoutMs: number,
): Promise<{ elapsedMs: number; stats: VisibleImageStats; timedOut: boolean }> {
  const startedAt = Date.now();
  let stats = await visibleImageStats(window);
  while (Date.now() - startedAt < timeoutMs) {
    if (stats.imageCards > 0 && stats.coverage >= minRatio) {
      return { elapsedMs: Date.now() - startedAt, stats, timedOut: false };
    }
    await window.waitForTimeout(50);
    stats = await visibleImageStats(window);
  }
  return { elapsedMs: Date.now() - startedAt, stats, timedOut: true };
}

// ---------------------------------------------------------------------------
// navigation scopes (folders / collections in the sidebar)
// ---------------------------------------------------------------------------

export type NavScope = { rowIndex: number; kind: "folder" | "collection" | "other"; title: string };

export async function listNavScopes(window: Page): Promise<NavScope[]> {
  return window.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".navigation-pane button.nav-row")].map((row, index) => {
      const label = row.querySelector<HTMLElement>(".nav-row-label")?.textContent?.trim() ?? "";
      return {
        rowIndex: index,
        kind: row.dataset.navFolderKind !== undefined
          ? "folder" as const
          : row.dataset.navCollectionId !== undefined
            ? "collection" as const
            : "other" as const,
        title: label,
      };
    }),
  );
}

/** Click a sidebar scope row by index and wait for the active state to land. */
export async function clickNavScope(window: Page, rowIndex: number): Promise<void> {
  await window.evaluate((index) => {
    const rows = [...document.querySelectorAll<HTMLElement>(".navigation-pane button.nav-row")];
    rows[index]?.click();
  }, rowIndex);
}

// ---------------------------------------------------------------------------
// log parsing
// ---------------------------------------------------------------------------

type CommandAggregate = {
  commandType: string;
  count: number;
  queueMs: TimingSummary;
  schedulerWaitMs: TimingSummary;
  runMs: TimingSummary;
  roundTripMs: TimingSummary;
};

/**
 * One end-to-end browse navigation, assembled from the `performance.navigation`
 * spans Main already emits plus the Worker's `worker.cmd` line for the same
 * navigation id. Serpent-217028 asks for exactly this chain:
 * click -> Main -> Worker browse -> Main post-processing -> IPC/commit.
 *
 * The raw navigation id never reaches the report: entries carry an ordinal
 * `label` (`nav-1`, ...) and the epoch of the Main entry point, which is what
 * the harness needs to join a recorded click to its navigation.
 */
export type NavigationStageRecord = {
  label: string;
  mainEnteredAtEpochMs: number | null;
  /** Epoch of the Main `main-return` line: the last Main-side stage. */
  mainReturnedAtEpochMs: number | null;
  /** Click/press -> Main receipt, as stamped by the renderer's own clock. */
  rendererToMainMs: number | null;
  /** Main -> Worker -> Main round trip for the browse command. */
  workerRoundTripMs: number | null;
  /** Worker admission wait for that same command (queue + scheduler). */
  workerSchedulerWaitMs: number | null;
  workerQueueMs: number | null;
  workerRunMs: number | null;
  mainElapsedMs: number | null;
  /** Worker returned -> response ready: Main's own post-processing. */
  mainPostProcessMs: number | null;
  /** Worker returned -> IPC return. */
  mainToIpcReturnMs: number | null;
  mainTotalMs: number | null;
};

export type NavigationSummary = {
  count: number;
  stages: NavigationStageRecord[];
  aggregates: {
    rendererToMainMs: TimingSummary;
    workerRoundTripMs: TimingSummary;
    workerSchedulerWaitMs: TimingSummary;
    workerRunMs: TimingSummary;
    mainElapsedMs: TimingSummary;
    mainPostProcessMs: TimingSummary;
    mainToIpcReturnMs: TimingSummary;
    mainTotalMs: TimingSummary;
  };
};

export type BenchLogSummary = {
  commands: CommandAggregate[];
  navigations: NavigationSummary;
  /**
   * Serpent-e97c00: how often the media job status summary was served from
   * cache versus recomputed. A browsing journey with the task panel closed
   * should show hits/stale-hits and very few rebuilds.
   */
  jobSummary: {
    hits: number;
    staleHits: number;
    misses: number;
    rebuilds: number;
    lastTotalJobs: number;
  };
  /**
   * Serpent-288cd9: RAW metadata backfill admission. `drainedProbes` counts
   * probes that found nothing left to do — after the first one the gate must
   * stop rescanning until the validation token changes.
   */
  rawMetadataAdmission: {
    probes: number;
    drainedProbes: number;
    cappedProbes: number;
    admitted: number;
    exhaustedSkips: number;
  };
  unmatchedRoundTripCount: number;
  lagEvents: { count: number; maxDriftMs: number; activities: Record<string, number> };
  mainLagEvents: { count: number; maxDriftMs: number };
  schedulerStalls: { count: number; maxWaitMs: number; owners: Record<string, number> };
  mediaWaves: {
    waves: number;
    jobs: number;
    startedJobs: number;
    maxWaveMs: number;
    maxJobMs: number;
    kinds: Record<string, number>;
  };
  reconcileStages: Array<{ stage: string; count: number; maxMs: number; totalMs: number }>;
  openStages: Array<{ stage: string; count: number; maxMs: number; totalMs: number }>;
  previewCache: Record<string, number>;
  viewerSpans: Array<{ stage: string; count: number; maxMs: number }>;
};

export type MediaQueueWindowSummary = {
  elapsedMs: number;
  finishedJobs: number;
  jobsPerMinute: number;
  jobKinds: Record<string, number>;
  jobElapsedMs: TimingSummary;
  startedWaves: number;
  finishedWaves: number;
};

function parsedLogLines(logText: string): Array<Record<string, unknown>> {
  const lines: Array<Record<string, unknown>> = [];
  for (const line of logText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      lines.push(parsed);
    } catch {
      // Native logs and stack traces are not structured lines.
    }
  }
  return lines;
}

function collectStageTimings(
  lines: Array<Record<string, unknown>>,
  scope: string,
): Array<{ stage: string; count: number; maxMs: number; totalMs: number }> {
  const byStage = new Map<string, { count: number; maxMs: number; totalMs: number }>();
  for (const line of lines) {
    if (line.scope !== scope) continue;
    const context = (line.context ?? {}) as Record<string, unknown>;
    const stage = String(context.stage ?? context.mediaStage ?? "unknown");
    const elapsed = Number(context.elapsedMs ?? context.ms ?? context.durationMs ?? 0);
    const entry = byStage.get(stage) ?? { count: 0, maxMs: 0, totalMs: 0 };
    entry.count += 1;
    entry.maxMs = Math.max(entry.maxMs, elapsed);
    entry.totalMs += elapsed;
    byStage.set(stage, entry);
  }
  return [...byStage.entries()]
    .map(([stage, entry]) => ({
      stage,
      count: entry.count,
      maxMs: Number(entry.maxMs.toFixed(2)),
      totalMs: Number(entry.totalMs.toFixed(2)),
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

/** Count only media work that finished inside the explicitly profiled window. */
export function summarizeMediaQueueWindow(
  logText: string,
  startedAtEpochMs: number,
  endedAtEpochMs: number,
): MediaQueueWindowSummary {
  const elapsedMs = Math.max(0, endedAtEpochMs - startedAtEpochMs);
  const windowEvents = parsedLogLines(logText).filter((line) => {
    if (line.scope !== "worker.media-queue") return false;
    const context = (line.context ?? {}) as Record<string, unknown>;
    const timestamp = Date.parse(String(context.timestamp ?? line.timestamp ?? ""));
    return Number.isFinite(timestamp) && timestamp >= startedAtEpochMs && timestamp <= endedAtEpochMs;
  });
  const eventStage = (line: Record<string, unknown>): string =>
    String((line.context as Record<string, unknown> | undefined)?.mediaStage ?? "unknown");
  const finished = windowEvents.filter((line) => eventStage(line) === "job-finish");
  const jobKinds: Record<string, number> = {};
  const durations: number[] = [];
  for (const line of finished) {
    const context = (line.context ?? {}) as Record<string, unknown>;
    const kind = String(context.kind ?? "unknown");
    jobKinds[kind] = (jobKinds[kind] ?? 0) + 1;
    const duration = Number(context.elapsedMs);
    if (Number.isFinite(duration) && duration >= 0) durations.push(duration);
  }
  return {
    elapsedMs,
    finishedJobs: finished.length,
    jobsPerMinute: elapsedMs > 0 ? Number((finished.length * 60_000 / elapsedMs).toFixed(2)) : 0,
    jobKinds,
    jobElapsedMs: summarizeTimings(durations),
    startedWaves: windowEvents.filter((line) => eventStage(line) === "wave-start").length,
    finishedWaves: windowEvents.filter((line) => eventStage(line) === "wave-finish").length,
  };
}

function stableDiagnosticLabel(value: unknown): string {
  return String(value ?? "unknown")
    .replace(/:[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "")
    .replace(/[^a-zA-Z0-9._:-]/g, "")
    .slice(0, 96) || "unknown";
}

/**
 * Count how the media job status summary was served: cache hit, bounded stale
 * hit (validated token changed but inside the stale window) or a rebuild that
 * re-scanned the job history. Serpent-e97c00's acceptance needs this because
 * the latency of `media.list-jobs` only proves the symptom, not the algorithm.
 */
function summarizeJobSummary(lines: Array<Record<string, unknown>>): BenchLogSummary["jobSummary"] {
  const summary = { hits: 0, staleHits: 0, misses: 0, rebuilds: 0, lastTotalJobs: 0 };
  for (const line of lines) {
    if (line.scope !== "media.job-summary") continue;
    const context = (line.context ?? {}) as Record<string, unknown>;
    const source = String(context.source ?? "");
    if (source === "hit") summary.hits += 1;
    else if (source === "stale-hit") summary.staleHits += 1;
    else if (source === "miss") summary.misses += 1;
    else if (source === "rebuild") summary.rebuilds += 1;
    const totalJobs = finiteNumber(context.totalJobs);
    if (totalJobs !== null) summary.lastTotalJobs = totalJobs;
  }
  return summary;
}

function summarizeRawMetadataAdmission(
  lines: Array<Record<string, unknown>>,
): BenchLogSummary["rawMetadataAdmission"] {
  const summary = { probes: 0, drainedProbes: 0, cappedProbes: 0, admitted: 0, exhaustedSkips: 0 };
  for (const line of lines) {
    if (line.scope !== "raw-metadata.admission") continue;
    const context = (line.context ?? {}) as Record<string, unknown>;
    summary.probes += 1;
    if (context.budgetCapped === true) summary.cappedProbes += 1;
    else summary.drainedProbes += 1;
    const admitted = finiteNumber(context.admitted);
    if (admitted !== null) summary.admitted += admitted;
    const exhaustedSkips = finiteNumber(context.exhaustedSkips);
    if (exhaustedSkips !== null) summary.exhaustedSkips = Math.max(summary.exhaustedSkips, exhaustedSkips);
  }
  return summary;
}

function epochMsOf(line: Record<string, unknown>): number | null {
  const context = (line.context ?? {}) as Record<string, unknown>;
  const parsed = Date.parse(String(context.timestamp ?? line.timestamp ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type PartialNavigation = {
  mainEnteredAtEpochMs: number | null;
  mainReturnedAtEpochMs: number | null;
  rendererToMainMs: number | null;
  workerRoundTripMs: number | null;
  workerSchedulerWaitMs: number | null;
  workerQueueMs: number | null;
  workerRunMs: number | null;
  mainElapsedMs: number | null;
  mainPostProcessMs: number | null;
  mainToIpcReturnMs: number | null;
  mainTotalMs: number | null;
};

function emptyPartialNavigation(): PartialNavigation {
  return {
    mainEnteredAtEpochMs: null,
    mainReturnedAtEpochMs: null,
    rendererToMainMs: null,
    workerRoundTripMs: null,
    workerSchedulerWaitMs: null,
    workerQueueMs: null,
    workerRunMs: null,
    mainElapsedMs: null,
    mainPostProcessMs: null,
    mainToIpcReturnMs: null,
    mainTotalMs: null,
  };
}

/**
 * Assemble the click -> Main -> Worker -> Main post-processing chain per
 * navigation. Main emits `performance.navigation` stages (`main-enter`,
 * `worker-returned`, `main-response-ready`, `main-return`) and the Worker echoes
 * the same navigation id on its `worker.cmd` line; joining on that id is what
 * removes the previous "correlate by time window" guesswork.
 *
 * Raw ids stay out of the output: records are labelled `nav-<n>` in log order.
 */
export function summarizeNavigations(lines: Array<Record<string, unknown>>): NavigationSummary {
  const byNavigationId = new Map<string, PartialNavigation>();
  const order: string[] = [];
  const entryFor = (navigationId: string): PartialNavigation => {
    const existing = byNavigationId.get(navigationId);
    if (existing) return existing;
    const created = emptyPartialNavigation();
    byNavigationId.set(navigationId, created);
    order.push(navigationId);
    return created;
  };

  for (const line of lines) {
    const context = (line.context ?? {}) as Record<string, unknown>;
    if (line.scope === "performance.navigation") {
      const navigationId = typeof context.navigationId === "string" ? context.navigationId : "";
      if (!navigationId) continue;
      const entry = entryFor(navigationId);
      const stage = String(context.stage ?? "");
      if (stage === "main-enter") {
        entry.mainEnteredAtEpochMs ??= epochMsOf(line);
        entry.rendererToMainMs ??= finiteNumber(context.rendererToMainMs);
      } else if (stage === "worker-returned") {
        entry.workerRoundTripMs ??= finiteNumber(context.workerRoundTripMs);
        entry.mainElapsedMs ??= finiteNumber(context.mainElapsedMs);
      } else if (stage === "main-response-ready") {
        entry.mainPostProcessMs ??= finiteNumber(context.mainPostProcessMs);
        entry.mainTotalMs ??= finiteNumber(context.mainTotalMs);
      } else if (stage === "main-return") {
        entry.mainToIpcReturnMs ??= finiteNumber(context.mainToIpcReturnMs);
        entry.mainReturnedAtEpochMs ??= epochMsOf(line);
      }
    } else if (line.scope === "worker.cmd") {
      const navigationId = typeof context.navigationId === "string" ? context.navigationId : "";
      if (!navigationId) continue;
      // Main logs `main-enter` before it dispatches the command, so this only
      // creates an entry when a log was truncated mid-navigation.
      const entry = entryFor(navigationId);
      entry.workerSchedulerWaitMs ??= finiteNumber(context.schedulerWaitMs);
      entry.workerQueueMs ??= finiteNumber(context.queueMs);
      entry.workerRunMs ??= finiteNumber(context.runMs);
    }
  }

  const stages: NavigationStageRecord[] = order.map((navigationId, index) => ({
    label: `nav-${index + 1}`,
    ...byNavigationId.get(navigationId)!,
  }));
  const collect = (pick: (stage: NavigationStageRecord) => number | null): TimingSummary =>
    summarizeTimings(stages.map(pick).filter((value): value is number => value !== null));

  return {
    count: stages.length,
    stages,
    aggregates: {
      rendererToMainMs: collect((stage) => stage.rendererToMainMs),
      workerRoundTripMs: collect((stage) => stage.workerRoundTripMs),
      workerSchedulerWaitMs: collect((stage) => stage.workerSchedulerWaitMs),
      workerRunMs: collect((stage) => stage.workerRunMs),
      mainElapsedMs: collect((stage) => stage.mainElapsedMs),
      mainPostProcessMs: collect((stage) => stage.mainPostProcessMs),
      mainToIpcReturnMs: collect((stage) => stage.mainToIpcReturnMs),
      mainTotalMs: collect((stage) => stage.mainTotalMs),
    },
  };
}

/**
 * Aggregate the gated diagnostics into the spans Serpent-217028 asks for.
 * `queueMs` is time to receipt, `schedulerWaitMs` is receipt to admission
 * (permission wait), `runMs` is handler time (DB + file I/O) and `roundTripMs`
 * is the Main-observed total, so the four separate "where did it wait" cases.
 */
export function summarizeBenchLog(logText: string): BenchLogSummary {
  const lines = parsedLogLines(logText);
  const commandByRequestId = new Map<string, {
    commandType: string;
    queueMs: number;
    schedulerWaitMs: number;
    runMs: number;
    roundTripMs?: number;
  }>();
  const roundTripByRequestId = new Map<string, { commandType: string; roundTripMs: number }>();
  for (const line of lines) {
    const context = (line.context ?? {}) as Record<string, unknown>;
    if (line.scope === "worker.cmd") {
      const requestId = String(context.requestId ?? line.requestId ?? "");
      if (!requestId || commandByRequestId.has(requestId)) continue;
      commandByRequestId.set(requestId, {
        commandType: String(context.type ?? context.commandType ?? line.type ?? "unknown"),
        queueMs: Number(context.queueMs ?? line.queueMs ?? 0),
        schedulerWaitMs: Number(context.schedulerWaitMs ?? line.schedulerWaitMs ?? 0),
        runMs: Number(context.runMs ?? line.runMs ?? 0),
      });
    } else if (line.scope === "worker.cmd.roundtrip") {
      const requestId = String(context.requestId ?? line.requestId ?? "");
      if (!requestId || roundTripByRequestId.has(requestId)) continue;
      roundTripByRequestId.set(requestId, {
        commandType: String(context.commandType ?? context.type ?? "unknown"),
        roundTripMs: Number(context.roundTripMs ?? context.totalMs ?? 0),
      });
    }
  }
  for (const [requestId, roundTrip] of roundTripByRequestId) {
    const command = commandByRequestId.get(requestId);
    if (command) command.roundTripMs = roundTrip.roundTripMs;
  }
  const byCommand = new Map<string, {
    queue: number[];
    schedulerWait: number[];
    run: number[];
    roundTrip: number[];
  }>();
  for (const command of commandByRequestId.values()) {
    const entry = byCommand.get(command.commandType)
      ?? { queue: [], schedulerWait: [], run: [], roundTrip: [] };
    entry.queue.push(command.queueMs);
    entry.schedulerWait.push(command.schedulerWaitMs);
    entry.run.push(command.runMs);
    if (command.roundTripMs !== undefined) entry.roundTrip.push(command.roundTripMs);
    byCommand.set(command.commandType, entry);
  }
  const commands: CommandAggregate[] = [...byCommand.entries()]
    .map(([commandType, samples]) => ({
      commandType,
      count: samples.run.length,
      queueMs: summarizeTimings(samples.queue),
      schedulerWaitMs: summarizeTimings(samples.schedulerWait),
      runMs: summarizeTimings(samples.run),
      roundTripMs: summarizeTimings(samples.roundTrip),
    }))
    .sort((left, right) => right.roundTripMs.totalMs - left.roundTripMs.totalMs);

  const lagEvents = lines.filter((line) => line.scope === "worker.eventLoop.lag");
  const lagActivities: Record<string, number> = {};
  let maxDriftMs = 0;
  for (const event of lagEvents) {
    const context = (event.context ?? {}) as Record<string, unknown>;
    const activity = stableDiagnosticLabel(context.activity ?? event.activity);
    lagActivities[activity] = (lagActivities[activity] ?? 0) + 1;
    maxDriftMs = Math.max(maxDriftMs, Number(context.driftMs ?? event.driftMs ?? 0));
  }
  const mainLagEvents = lines.filter((line) => line.scope === "main.eventLoop.lag");

  const stalls = lines.filter((line) => line.scope === "worker.scheduler.stall");
  const stallOwners: Record<string, number> = {};
  let maxStallWaitMs = 0;
  for (const stall of stalls) {
    const context = (stall.context ?? {}) as Record<string, unknown>;
    const active = Array.isArray(context.active)
      ? context.active as Array<Record<string, unknown>>
      : [];
    if (active.length === 0) {
      const owner = stableDiagnosticLabel(context.owner ?? context.activity);
      stallOwners[owner] = (stallOwners[owner] ?? 0) + 1;
    }
    for (const entry of active) {
      const owner = `${stableDiagnosticLabel(entry.lane)}:${stableDiagnosticLabel(entry.label)}`;
      stallOwners[owner] = (stallOwners[owner] ?? 0) + 1;
    }
    maxStallWaitMs = Math.max(maxStallWaitMs, Number(context.waitedMs ?? context.waitMs ?? context.stallMs ?? 0));
  }

  const waveStarts = lines.filter((line) => line.scope === "worker.media-queue"
    && (line.context as Record<string, unknown> | undefined)?.mediaStage === "wave-start");
  const jobStarts = lines.filter((line) => line.scope === "worker.media-queue"
    && (line.context as Record<string, unknown> | undefined)?.mediaStage === "job-start");
  const jobFinish = lines.filter((line) => line.scope === "worker.media-queue"
    && (line.context as Record<string, unknown> | undefined)?.mediaStage === "job-finish");
  const waveFinish = lines.filter((line) => line.scope === "worker.media-queue"
    && (line.context as Record<string, unknown> | undefined)?.mediaStage === "wave-finish");
  const mediaKinds: Record<string, number> = {};
  let maxJobMs = 0;
  for (const event of jobFinish) {
    const context = (event.context ?? {}) as Record<string, unknown>;
    const kind = String(context.kind ?? "unknown");
    mediaKinds[kind] = (mediaKinds[kind] ?? 0) + 1;
    maxJobMs = Math.max(maxJobMs, Number(context.elapsedMs ?? 0));
  }
  const maxWaveMs = Math.max(0, ...waveFinish.map((event) => {
    const context = (event.context ?? {}) as Record<string, unknown>;
    return Number(context.elapsedMs ?? 0);
  }));

  const previewCache: Record<string, number> = {};
  for (const line of lines) {
    // AppLogger stores the PreviewCache event kind in its message ("hit <ids>",
    // "miss <ids>", ...) rather than a structured context field. Keep only the
    // first token so diagnostics never copy library or artifact identifiers
    // into the benchmark report.
    if (line.scope !== "preview-cache") continue;
    const event = String(line.message ?? "unknown").trim().split(/\s+/u)[0] || "unknown";
    previewCache[event] = (previewCache[event] ?? 0) + 1;
  }

  return {
    commands,
    navigations: summarizeNavigations(lines),
    jobSummary: summarizeJobSummary(lines),
    rawMetadataAdmission: summarizeRawMetadataAdmission(lines),
    unmatchedRoundTripCount: [...roundTripByRequestId.keys()]
      .filter((requestId) => !commandByRequestId.has(requestId)).length,
    lagEvents: { count: lagEvents.length, maxDriftMs, activities: lagActivities },
    mainLagEvents: {
      count: mainLagEvents.length,
      maxDriftMs: Math.max(0, ...mainLagEvents.map((line) => {
        const context = (line.context ?? {}) as Record<string, unknown>;
        return Number(context.driftMs ?? line.driftMs ?? 0);
      })),
    },
    schedulerStalls: { count: stalls.length, maxWaitMs: maxStallWaitMs, owners: stallOwners },
    mediaWaves: {
      waves: waveStarts.length,
      jobs: jobFinish.length,
      startedJobs: jobStarts.length,
      maxWaveMs,
      maxJobMs,
      kinds: mediaKinds,
    },
    reconcileStages: collectStageTimings(lines, "open.refresh-managed-assets.stage"),
    openStages: collectStageTimings(lines, "library.open.stage"),
    previewCache,
    viewerSpans: collectStageTimings(lines, "viewer.timing"),
  };
}

export function writeBenchReport(reportPath: string | undefined, report: unknown): void {
  if (!reportPath) return;
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
