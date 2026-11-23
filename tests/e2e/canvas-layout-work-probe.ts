import { Buffer } from "node:buffer";
import type { CDPSession, Page } from "@playwright/test";

const TRACE_BYTE_LIMIT = 64 * 1024 * 1024;
const TRACE_READ_CHUNK = 1024 * 1024;
const MAX_TRACE_EVENTS = 1_000_000;
const MAX_STACK_KEYS = 512;
const TRACE_EVENT_NAMES = [
  "Layout",
  "UpdateLayoutTree",
  "InvalidateLayout",
  "ScheduleStyleRecalculation",
  "LayoutInvalidationTracking",
  "PrePaint",
  "Paint",
  "Layerize",
  "CompositeLayers",
] as const;
const INVALIDATION_EVENT_NAMES = [
  "ScheduleStyleInvalidationTracking",
  "StyleInvalidatorInvalidationTracking",
  "StyleRecalcInvalidationTracking",
] as const;
const INVALIDATION_REASON_NAMES = [
  "class",
  "attribute",
  "id",
  "pseudo",
  "sibling",
  "nth",
  "style",
  "relational",
  "insertion",
  "subtree",
  "rule",
  "viewport",
  "other",
] as const;
const INVALIDATION_TRACE_CATEGORY = "disabled-by-default-devtools.timeline.invalidationTracking";
const SELECTOR_STATS_TRACE_CATEGORY = "disabled-by-default-blink.debug";
const SELECTOR_STATS_EVENT_NAME = "SelectorStats";
const MAX_SELECTOR_STATS_ENTRIES = 250_000;
const SELECTOR_STATS_CATEGORY_NAMES = [
  "app-shell-relational",
  "sidebar-row-relational",
  "asset-card-relational",
  "ordinary",
] as const;

type TraceEventName = (typeof TRACE_EVENT_NAMES)[number];
type InvalidationEventName = (typeof INVALIDATION_EVENT_NAMES)[number];
type InvalidationReasonName = (typeof INVALIDATION_REASON_NAMES)[number];
type SelectorStatsCategoryName = (typeof SELECTOR_STATS_CATEGORY_NAMES)[number];
type TraceMetric = { count: number; totalMs: number; p95Ms: number; maxMs: number };
export type CanvasLayoutWorkProbeOptions = {
  /** Adds high-overhead style invalidation events to this diagnostic capture. */
  styleDiagnostics?: "invalidations" | "selectors";
};
type InvalidationEventSummary = {
  count: number;
  reasons: Record<InvalidationReasonName, number>;
  missingReasonCount: number;
};
type StyleInvalidationSummary = {
  status: "collected" | "no-observations";
  events: Record<InvalidationEventName, InvalidationEventSummary>;
  updateLayoutTreeElementCount: {
    total: number | null;
    observations: number;
    missingCount: number;
    sourceCounts: { args: number; beginData: number; endData: number };
  };
};
type SelectorStatsBucket = {
  count: number;
  attempts: number | null;
  matches: number | null;
  fastRejects: number | null;
  elapsedUs: number | null;
  missingFields: { attempts: number; matches: number; fastRejects: number; elapsed: number };
};
type SelectorStatsSummary = {
  status: "collected" | "no-observations";
  selectorScope: "known-application-selector-markers";
  eventCount: number;
  selectorArrayMissingCount: number;
  entriesOmitted: number;
  unclassifiedCount: number;
  categories: Record<SelectorStatsCategoryName, SelectorStatsBucket>;
};
type TraceStackRow = {
  source: "bundle" | "runtime" | "other";
  functionName: string;
  line: number;
  count: number;
  totalMs: number;
};

export type CanvasLayoutWorkSummary = {
  trace: {
    status: "complete" | "byte-cap" | "data-loss" | "unavailable";
    bytesRead: number;
    dataLossOccurred: boolean;
    parsedEvents: number;
    omittedEvents: number;
    invalidEvents: number;
    stackRowsOmitted: number;
    events: Record<TraceEventName, TraceMetric>;
    topStacks: TraceStackRow[];
  };
  styleDiagnostics?:
    | { mode: "invalidations"; status: StyleInvalidationSummary["status"]; summary: StyleInvalidationSummary }
    | { mode: "selectors"; status: SelectorStatsSummary["status"]; summary: SelectorStatsSummary };
  page: {
    observedMs: number;
    target: "workspace-canvas + virtual masonry/justified grid";
    targetElementCapture: "install-time; replaced elements are not counted";
    targetElements: {
      canvasFound: number;
      virtualGridFound: number;
      canvasPatched: number;
      virtualGridPatched: number;
    };
    reads: {
      canvas: { clientHeight: number; clientWidth: number; scrollHeight: number; rect: number };
      virtualGrid: { clientHeight: number; clientWidth: number; scrollHeight: number; rect: number };
    };
    scrollToWrites: { canvas: number; virtualGrid: number };
    frames: {
      samples: number;
      dropped: number;
      repeatedReadFrames: number;
      maxReads: number;
      p95Reads: number;
      writesFrames: number;
    };
    observerInstrumentation: "not-patched; existing RO/MO callbacks are not observed";
  };
};

export type CanvasLayoutWorkProbe = {
  stop(): Promise<CanvasLayoutWorkSummary>;
  dispose(): Promise<void>;
};

type TraceCompletePayload = {
  dataLossOccurred: boolean;
  stream?: string;
  traceFormat?: string;
  streamCompression?: string;
};

/**
 * Starts a bounded, in-memory renderer layout trace and target-only getter
 * counters. The page hooks are diagnostic instrumentation and can perturb the
 * measured work; treat this as attribution evidence, not an A/B benchmark.
 */
export async function installCanvasLayoutWorkProbe(
  page: Page,
  session: CDPSession,
  options: CanvasLayoutWorkProbeOptions = {},
): Promise<CanvasLayoutWorkProbe> {
  await page.evaluate(installPageCanvasLayoutCounter);

  let tracingStarted = false;
  let completePayload: TraceCompletePayload | null = null;
  let resolveComplete!: (payload: TraceCompletePayload) => void;
  const complete = new Promise<TraceCompletePayload>((resolve) => {
    resolveComplete = resolve;
  });
  const onTracingComplete = (payload: TraceCompletePayload) => {
    completePayload = payload;
    resolveComplete(payload);
  };
  session.on("Tracing.tracingComplete", onTracingComplete);

  try {
    await session.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      streamFormat: "json",
      streamCompression: "none",
      traceConfig: {
        recordMode: "recordContinuously",
        traceBufferSizeInKb: TRACE_BYTE_LIMIT / 1024,
        includedCategories: [
          "devtools.timeline",
          ...(options.styleDiagnostics === "invalidations" ? [] : [
            "disabled-by-default-devtools.timeline",
            "disabled-by-default-devtools.timeline.stack",
          ]),
          "blink.user_timing",
          ...(options.styleDiagnostics === "invalidations" ? [INVALIDATION_TRACE_CATEGORY] : []),
          ...(options.styleDiagnostics === "selectors" ? [SELECTOR_STATS_TRACE_CATEGORY] : []),
        ],
      },
    });
    tracingStarted = true;
    await page.evaluate(() => {
      const probe = (window as Window & { __serpentCanvasLayoutWorkProbe?: PageCanvasLayoutCounter })
        .__serpentCanvasLayoutWorkProbe;
      if (!probe) throw new Error("Canvas layout counter is unavailable.");
      probe.begin();
    });
  } catch {
    if (tracingStarted) {
      await session.send("Tracing.end").catch(() => undefined);
      tracingStarted = false;
      const completed = completePayload ?? await withTimeout(complete, 30_000);
      if (completed?.stream) {
        await session.send("IO.close", { handle: completed.stream }).catch(() => undefined);
      }
    }
    session.off("Tracing.tracingComplete", onTracingComplete);
    await page.evaluate(() => {
      const probe = (window as Window & { __serpentCanvasLayoutWorkProbe?: PageCanvasLayoutCounter })
        .__serpentCanvasLayoutWorkProbe;
      probe?.dispose();
      delete (window as Window & { __serpentCanvasLayoutWorkProbe?: PageCanvasLayoutCounter })
        .__serpentCanvasLayoutWorkProbe;
    }).catch(() => undefined);
    throw new Error("Canvas layout tracing could not be started.");
  }

  let streamHandle: string | undefined;
  let stopPromise: Promise<CanvasLayoutWorkSummary> | null = null;
  let disposed = false;

  const closeStream = async () => {
    if (!streamHandle) return;
    const handle = streamHandle;
    streamHandle = undefined;
    await session.send("IO.close", { handle }).catch(() => undefined);
  };

  const stop = (): Promise<CanvasLayoutWorkSummary> => {
    stopPromise ??= stopAndSummarize();
    return stopPromise;
  };

  const stopAndSummarize = async (): Promise<CanvasLayoutWorkSummary> => {
    let pageSummary: PageCanvasLayoutSummary = emptyPageCanvasLayoutSummary();
    let traceStatus: CanvasLayoutWorkSummary["trace"]["status"] = "unavailable";
    let bytesRead = 0;
    let dataLossOccurred = false;
    const accumulator = createTraceAccumulator(options.styleDiagnostics);

    try {
      pageSummary = await page.evaluate(() => {
        const probe = (window as Window & { __serpentCanvasLayoutWorkProbe?: PageCanvasLayoutCounter })
          .__serpentCanvasLayoutWorkProbe;
        return probe
          ? probe.stop()
          : {
              observedMs: 0,
              target: "workspace-canvas + virtual masonry/justified grid" as const,
              targetElementCapture: "install-time; replaced elements are not counted" as const,
              targetElements: {
                canvasFound: 0,
                virtualGridFound: 0,
                canvasPatched: 0,
                virtualGridPatched: 0,
              },
              reads: {
                canvas: { clientHeight: 0, clientWidth: 0, scrollHeight: 0, rect: 0 },
                virtualGrid: { clientHeight: 0, clientWidth: 0, scrollHeight: 0, rect: 0 },
              },
              scrollToWrites: { canvas: 0, virtualGrid: 0 },
              frames: {
                samples: 0,
                dropped: 0,
                repeatedReadFrames: 0,
                maxReads: 0,
                p95Reads: 0,
                writesFrames: 0,
              },
              observerInstrumentation: "not-patched; existing RO/MO callbacks are not observed" as const,
            };
      });
    } catch {
      // The trace may still be useful if renderer-side instrumentation was removed.
    }

    try {
      if (tracingStarted) {
        await session.send("Tracing.end");
        tracingStarted = false;
        const completed = completePayload ?? await withTimeout(complete, 30_000);
        if (completed) {
          dataLossOccurred = completed.dataLossOccurred;
          streamHandle = completed.stream;
          if (streamHandle) {
            const readResult = await readTraceStream(session, streamHandle, accumulator);
            bytesRead = readResult.bytesRead;
            traceStatus = readResult.byteCap
              ? "byte-cap"
              : dataLossOccurred
                ? "data-loss"
                : "complete";
          }
        }
      }
    } catch {
      traceStatus = "unavailable";
    } finally {
      await closeStream();
      session.off("Tracing.tracingComplete", onTracingComplete);
      await page.evaluate(() => {
        const probe = (window as Window & { __serpentCanvasLayoutWorkProbe?: PageCanvasLayoutCounter })
          .__serpentCanvasLayoutWorkProbe;
        probe?.dispose();
        delete (window as Window & { __serpentCanvasLayoutWorkProbe?: PageCanvasLayoutCounter })
          .__serpentCanvasLayoutWorkProbe;
      }).catch(() => undefined);
      disposed = true;
    }

    const trace = accumulator.finish();
    if (traceStatus === "complete" && dataLossOccurred) traceStatus = "data-loss";
    return {
      trace: {
        status: traceStatus,
        bytesRead,
        dataLossOccurred,
        parsedEvents: trace.parsedEvents,
        omittedEvents: trace.omittedEvents,
        invalidEvents: trace.invalidEvents,
        stackRowsOmitted: trace.stackRowsOmitted,
        events: trace.events,
        topStacks: trace.topStacks,
      },
      page: pageSummary,
      ...(options.styleDiagnostics === "invalidations"
        ? { styleDiagnostics: { mode: "invalidations" as const, status: trace.styleInvalidations.status, summary: trace.styleInvalidations } }
        : options.styleDiagnostics === "selectors"
          ? { styleDiagnostics: { mode: "selectors" as const, status: trace.selectorStats.status, summary: trace.selectorStats } }
          : {}),
    };
  };

  const dispose = async () => {
    if (disposed) return;
    try {
      await stop();
    } catch {
      // Cleanup below is still required if tracing or stream parsing failed.
    }
    if (tracingStarted) {
      tracingStarted = false;
      await session.send("Tracing.end").catch(() => undefined);
    }
    await closeStream();
    session.off("Tracing.tracingComplete", onTracingComplete);
    await page.evaluate(() => {
      const probe = (window as Window & { __serpentCanvasLayoutWorkProbe?: PageCanvasLayoutCounter })
        .__serpentCanvasLayoutWorkProbe;
      probe?.dispose();
      delete (window as Window & { __serpentCanvasLayoutWorkProbe?: PageCanvasLayoutCounter })
        .__serpentCanvasLayoutWorkProbe;
    }).catch(() => undefined);
    disposed = true;
  };

  return { stop, dispose };
}

type PageCanvasLayoutCounter = {
  begin(): void;
  stop(): PageCanvasLayoutSummary;
  dispose(): void;
};

type PageFrameSample = {
  canvasReads: number;
  gridReads: number;
  canvasScrollTo: number;
  gridScrollTo: number;
};

type PageCanvasLayoutSummary = CanvasLayoutWorkSummary["page"];

function emptyPageCanvasLayoutSummary(): PageCanvasLayoutSummary {
  const emptyReads = () => ({ clientHeight: 0, clientWidth: 0, scrollHeight: 0, rect: 0 });
  return {
    observedMs: 0,
    target: "workspace-canvas + virtual masonry/justified grid",
    targetElementCapture: "install-time; replaced elements are not counted",
    targetElements: { canvasFound: 0, virtualGridFound: 0, canvasPatched: 0, virtualGridPatched: 0 },
    reads: { canvas: emptyReads(), virtualGrid: emptyReads() },
    scrollToWrites: { canvas: 0, virtualGrid: 0 },
    frames: {
      samples: 0,
      dropped: 0,
      repeatedReadFrames: 0,
      maxReads: 0,
      p95Reads: 0,
      writesFrames: 0,
    },
    observerInstrumentation: "not-patched; existing RO/MO callbacks are not observed",
  };
}

/** Serialized into the renderer; all dependencies are local to this function. */
function installPageCanvasLayoutCounter(): void {
  type Scope = "canvas" | "virtualGrid";
  type ReadKey = "clientHeight" | "clientWidth" | "scrollHeight" | "rect";
  type ProbeState = PageCanvasLayoutCounter & { dispose(): void };
  type WindowWithProbe = Window & { __serpentCanvasLayoutWorkProbe?: ProbeState };

  const host = window as WindowWithProbe;
  host.__serpentCanvasLayoutWorkProbe?.dispose();
  const maxFrameSamples = 2048;
  const maxPatchedTargets = 64;
  const frameSamples: PageFrameSample[] = [];
  const totals = {
    canvas: { clientHeight: 0, clientWidth: 0, scrollHeight: 0, rect: 0 },
    virtualGrid: { clientHeight: 0, clientWidth: 0, scrollHeight: 0, rect: 0 },
  };
  const scrollToWrites = { canvas: 0, virtualGrid: 0 };
  const targetElements = {
    canvasFound: 0,
    virtualGridFound: 0,
    canvasPatched: 0,
    virtualGridPatched: 0,
  };
  let frameCounts: PageFrameSample = {
    canvasReads: 0,
    gridReads: 0,
    canvasScrollTo: 0,
    gridScrollTo: 0,
  };
  let droppedFrames = 0;
  let frameHandle: number | null = null;
  let startedAt = 0;
  let running = false;
  const patches: Array<() => void> = [];
  const targets: Array<{ element: HTMLElement; scope: Scope }> = [];

  const canvases = [...document.querySelectorAll<HTMLElement>(".workspace-canvas")];
  targetElements.canvasFound = canvases.length;
  for (const element of canvases.slice(0, maxPatchedTargets)) targets.push({ element, scope: "canvas" });
  const grids = [...document.querySelectorAll<HTMLElement>(
    ".workspace-canvas .masonry-columns, .workspace-canvas .justified-rows",
  )].filter((element) => element.querySelector("[data-layout-index]"));
  targetElements.virtualGridFound = grids.length;
  for (const element of grids.slice(0, maxPatchedTargets - targets.length)) {
    targets.push({ element, scope: "virtualGrid" });
  }

  const emptyFrame = (): PageFrameSample => ({
    canvasReads: 0,
    gridReads: 0,
    canvasScrollTo: 0,
    gridScrollTo: 0,
  });

  const recordRead = (scope: Scope, key: ReadKey) => {
    if (!running) return;
    totals[scope][key] += 1;
    if (scope === "canvas") frameCounts.canvasReads += 1;
    else frameCounts.gridReads += 1;
  };

  const recordScrollTo = (scope: Scope) => {
    if (!running) return;
    scrollToWrites[scope] += 1;
    if (scope === "canvas") frameCounts.canvasScrollTo += 1;
    else frameCounts.gridScrollTo += 1;
  };

  const flushFrame = () => {
    if (frameSamples.length < maxFrameSamples) frameSamples.push(frameCounts);
    else droppedFrames += 1;
    frameCounts = emptyFrame();
  };

  const tick = () => {
    frameHandle = null;
    if (!running) return;
    flushFrame();
    frameHandle = requestAnimationFrame(tick);
  };

  const findOwner = (start: object, key: PropertyKey): object | null => {
    let owner: object | null = start;
    while (owner) {
      if (Object.getOwnPropertyDescriptor(owner, key)) return owner;
      owner = Object.getPrototypeOf(owner);
    }
    return null;
  };

  const patchGetter = (element: HTMLElement, scope: Scope, key: ReadKey) => {
    const owner = findOwner(HTMLElement.prototype, key);
    if (!owner) return;
    const original = Object.getOwnPropertyDescriptor(owner, key);
    if (!original?.get || Object.getOwnPropertyDescriptor(element, key)) return;
    const getter = original.get;
    const wrapped = function (this: HTMLElement) {
      recordRead(scope, key);
      return getter.call(this);
    };
    Object.defineProperty(element, key, {
      configurable: true,
      enumerable: original.enumerable,
      get: wrapped,
    });
    patches.push(() => {
      if (Object.getOwnPropertyDescriptor(element, key)?.get === wrapped) {
        delete (element as unknown as Record<string, unknown>)[key];
      }
    });
  };

  const patchMethod = (
    element: HTMLElement,
    scope: Scope,
    key: "getBoundingClientRect" | "scrollTo",
  ) => {
    const owner = findOwner(Element.prototype, key);
    if (!owner || Object.getOwnPropertyDescriptor(element, key)) return false;
    const original = Object.getOwnPropertyDescriptor(owner, key);
    if (typeof original?.value !== "function") return false;
    const method = original.value as (this: HTMLElement, ...args: unknown[]) => unknown;
    const wrapped = function (this: HTMLElement, ...args: unknown[]) {
      if (key === "getBoundingClientRect") recordRead(scope, "rect");
      else recordScrollTo(scope);
      return method.apply(this, args);
    };
    Object.defineProperty(element, key, {
      configurable: true,
      enumerable: original.enumerable,
      writable: true,
      value: wrapped,
    });
    patches.push(() => {
      if (Object.getOwnPropertyDescriptor(element, key)?.value === wrapped) {
        delete (element as unknown as Record<string, unknown>)[key];
      }
    });
    return true;
  };

  for (const { element, scope } of targets) {
    patchGetter(element, scope, "clientHeight");
    patchGetter(element, scope, "clientWidth");
    patchGetter(element, scope, "scrollHeight");
    patchMethod(element, scope, "getBoundingClientRect");
    patchMethod(element, scope, "scrollTo");
    if (scope === "canvas") targetElements.canvasPatched += 1;
    else targetElements.virtualGridPatched += 1;
  }

  const summarizeFrames = () => {
    const reads = frameSamples.map((sample) => sample.canvasReads + sample.gridReads);
    const ordered = [...reads].sort((left, right) => left - right);
    const p95Reads = ordered.length === 0
      ? 0
      : ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)]!;
    return {
      samples: frameSamples.length,
      dropped: droppedFrames,
      repeatedReadFrames: reads.filter((count) => count > 1).length,
      maxReads: Math.max(0, ...reads),
      p95Reads,
      writesFrames: frameSamples.filter(
        (sample) => sample.canvasScrollTo + sample.gridScrollTo > 0,
      ).length,
    };
  };

  const snapshot = (): PageCanvasLayoutSummary => ({
    observedMs: startedAt > 0 ? Number((performance.now() - startedAt).toFixed(1)) : 0,
    target: "workspace-canvas + virtual masonry/justified grid",
    targetElementCapture: "install-time; replaced elements are not counted",
    targetElements: { ...targetElements },
    reads: {
      canvas: { ...totals.canvas },
      virtualGrid: { ...totals.virtualGrid },
    },
    scrollToWrites: { ...scrollToWrites },
    frames: summarizeFrames(),
    observerInstrumentation: "not-patched; existing RO/MO callbacks are not observed",
  });

  const state: ProbeState = {
    begin() {
      for (const scope of ["canvas", "virtualGrid"] as const) {
        totals[scope].clientHeight = 0;
        totals[scope].clientWidth = 0;
        totals[scope].scrollHeight = 0;
        totals[scope].rect = 0;
      }
      scrollToWrites.canvas = 0;
      scrollToWrites.virtualGrid = 0;
      frameSamples.length = 0;
      droppedFrames = 0;
      frameCounts = emptyFrame();
      startedAt = performance.now();
      running = true;
      performance.mark("canvas-layout-work-probe:start");
      frameHandle = requestAnimationFrame(tick);
    },
    stop() {
      if (running) {
        performance.mark("canvas-layout-work-probe:stop");
        running = false;
        if (frameHandle !== null) cancelAnimationFrame(frameHandle);
        frameHandle = null;
        flushFrame();
      }
      return snapshot();
    },
    dispose() {
      state.stop();
      for (const restore of patches.reverse()) restore();
      patches.length = 0;
    },
  };
  host.__serpentCanvasLayoutWorkProbe = state;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readTraceStream(
  session: CDPSession,
  handle: string,
  accumulator: ReturnType<typeof createTraceAccumulator>,
): Promise<{ bytesRead: number; byteCap: boolean }> {
  let bytesRead = 0;
  let byteCap = false;
  const decoder = new TextDecoder("utf-8");
  let eof = false;
  while (!eof && bytesRead < TRACE_BYTE_LIMIT) {
    const chunk = await session.send("IO.read", { handle, size: TRACE_READ_CHUNK });
    eof = chunk.eof;
    const raw = chunk.base64Encoded
      ? Buffer.from(chunk.data, "base64")
      : Buffer.from(chunk.data, "utf8");
    const remaining = TRACE_BYTE_LIMIT - bytesRead;
    const accepted = raw.byteLength > remaining ? raw.subarray(0, remaining) : raw;
    bytesRead += accepted.byteLength;
    accumulator.push(decoder.decode(accepted, { stream: !eof && accepted.byteLength === raw.byteLength }));
    if (accepted.byteLength < raw.byteLength) {
      byteCap = true;
      break;
    }
  }
  if (!eof && bytesRead >= TRACE_BYTE_LIMIT) byteCap = true;
  if (eof) accumulator.push(decoder.decode());
  return { bytesRead, byteCap };
}

function createTraceAccumulator(mode: CanvasLayoutWorkProbeOptions["styleDiagnostics"]) {
  const maxHistogramIndex = 20_000;
  const eventMetrics = new Map<TraceEventName, {
    count: number;
    totalMs: number;
    maxMs: number;
    histogram: Uint32Array;
  }>(TRACE_EVENT_NAMES.map((name) => [name, {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    histogram: new Uint32Array(maxHistogramIndex + 1),
  }]));
  const stacks = new Map<string, {
    source: TraceStackRow["source"];
    functionName: string;
    line: number;
    count: number;
    totalMs: number;
  }>();
  const invalidationEvents = Object.fromEntries(INVALIDATION_EVENT_NAMES.map((name) => [
    name,
    { count: 0, reasons: zeroReasonCounts(), missingReasonCount: 0 },
  ])) as Record<InvalidationEventName, InvalidationEventSummary>;
  let updateLayoutTreeElementTotal = 0;
  let updateLayoutTreeElementObservations = 0;
  let updateLayoutTreeElementMissingCount = 0;
  const updateLayoutTreeElementSourceCounts = { args: 0, beginData: 0, endData: 0 };
  const selectorBuckets = Object.fromEntries(SELECTOR_STATS_CATEGORY_NAMES.map((name) => [
    name,
    {
      count: 0,
      attempts: 0,
      matches: 0,
      fastRejects: 0,
      elapsedUs: 0,
      missingFields: { attempts: 0, matches: 0, fastRejects: 0, elapsed: 0 },
      presentFields: { attempts: 0, matches: 0, fastRejects: 0, elapsed: 0 },
    },
  ])) as Record<SelectorStatsCategoryName, {
    count: number;
    attempts: number;
    matches: number;
    fastRejects: number;
    elapsedUs: number;
    missingFields: { attempts: number; matches: number; fastRejects: number; elapsed: number };
    presentFields: { attempts: number; matches: number; fastRejects: number; elapsed: number };
  }>;
  let parsedEvents = 0;
  let omittedEvents = 0;
  let invalidEvents = 0;
  let stackRowsOmitted = 0;
  let pending = "";
  let cursor = 0;
  let eventStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let foundEvents = false;
  let ended = false;
  let invalidationEventCount = 0;
  let selectorEventCount = 0;
  let selectorArrayMissingCount = 0;
  let selectorEntriesOmitted = 0;
  let selectorUnclassifiedCount = 0;
  let selectorEntriesParsed = 0;

  const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;

  const addEvent = (event: Record<string, unknown>) => {
    parsedEvents += 1;
    const name = event.name;
    if (typeof name !== "string") return;
    if (
      mode === "invalidations" &&
      INVALIDATION_EVENT_NAMES.includes(name as InvalidationEventName)
    ) {
      const invalidationName = name as InvalidationEventName;
      invalidationEventCount += 1;
      const summary = invalidationEvents[invalidationName];
      summary.count += 1;
      const reason = readInvalidationReason(event);
      if (reason === null) summary.missingReasonCount += 1;
      else summary.reasons[reason] += 1;
      return;
    }
    if (mode === "selectors" && name === SELECTOR_STATS_EVENT_NAME) {
      selectorEventCount += 1;
      const entries = readSelectorStatsEntries(event);
      if (!entries) {
        selectorArrayMissingCount += 1;
        return;
      }
      for (const entry of entries) {
        if (selectorEntriesParsed >= MAX_SELECTOR_STATS_ENTRIES) {
          selectorEntriesOmitted += 1;
          continue;
        }
        selectorEntriesParsed += 1;
        const selector = typeof entry.selector === "string" ? entry.selector : "";
        const category = classifyApplicationSelector(selector);
        if (!category) {
          selectorUnclassifiedCount += 1;
          continue;
        }
        addSelectorEntry(selectorBuckets[category], entry);
      }
      return;
    }
    if (!TRACE_EVENT_NAMES.includes(name as TraceEventName)) return;
    const metric = eventMetrics.get(name as TraceEventName)!;
    const rawDuration = typeof event.dur === "number" && Number.isFinite(event.dur)
      ? Math.max(0, event.dur / 1000)
      : 0;
    metric.count += 1;
    metric.totalMs += rawDuration;
    metric.maxMs = Math.max(metric.maxMs, rawDuration);
    metric.histogram[Math.min(maxHistogramIndex, Math.ceil(rawDuration * 2))]! += 1;
    if (mode === "invalidations" && name === "UpdateLayoutTree") {
      const elementCount = readUpdateLayoutTreeElementCount(event);
      if (elementCount === null) updateLayoutTreeElementMissingCount += 1;
      else {
        updateLayoutTreeElementTotal += elementCount.value;
        updateLayoutTreeElementObservations += 1;
        updateLayoutTreeElementSourceCounts[elementCount.source] += 1;
      }
    }
    if (name !== "Layout" && name !== "UpdateLayoutTree") return;
    const frames = traceStackFrames(event).slice(0, 5);
    for (const frame of frames) {
      const source = stackSource(frame.url);
      const functionName = sanitizeFunctionName(frame.functionName);
      const line = Number.isFinite(frame.lineNumber) ? Math.max(0, Math.trunc(frame.lineNumber)) : 0;
      const key = `${source}\u0000${functionName}\u0000${line}`;
      const row = stacks.get(key);
      if (row) {
        row.count += 1;
        row.totalMs += rawDuration;
      } else if (stacks.size < MAX_STACK_KEYS) {
        stacks.set(key, { source, functionName, line, count: 1, totalMs: rawDuration });
      } else {
        stackRowsOmitted += 1;
      }
    }
  };

  const consumeEvent = (raw: string) => {
    if (parsedEvents >= MAX_TRACE_EVENTS) {
      omittedEvents += 1;
      ended = true;
      pending = "";
      cursor = 0;
      return;
    }
    try {
      const parsed = object(JSON.parse(raw));
      if (parsed) addEvent(parsed);
      else invalidEvents += 1;
    } catch {
      invalidEvents += 1;
    }
  };

  const push = (chunk: string) => {
    if (ended || chunk.length === 0) return;
    pending += chunk;
    if (!foundEvents) {
      const marker = /"traceEvents"\s*:\s*\[/.exec(pending);
      if (!marker) {
        if (pending.length > 1024 * 1024) pending = pending.slice(-128);
        return;
      }
      pending = pending.slice(marker.index + marker[0].length);
      foundEvents = true;
      cursor = 0;
    }

    while (cursor < pending.length) {
      if (eventStart < 0) {
        while (cursor < pending.length && /[\s,]/u.test(pending[cursor]!)) cursor += 1;
        if (cursor >= pending.length) break;
        if (pending[cursor] === "]") {
          ended = true;
          pending = "";
          cursor = 0;
          return;
        }
        if (pending[cursor] !== "{") {
          cursor += 1;
          continue;
        }
        eventStart = cursor;
        depth = 1;
        inString = false;
        escaped = false;
        cursor += 1;
        continue;
      }

      const character = pending[cursor]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
      } else if (character === '"') {
        inString = true;
      } else if (character === "{" || character === "[") {
        depth += 1;
      } else if (character === "}" || character === "]") {
        depth -= 1;
        if (depth === 0) {
          consumeEvent(pending.slice(eventStart, cursor + 1));
          if (ended) return;
          pending = pending.slice(cursor + 1);
          cursor = 0;
          eventStart = -1;
          continue;
        }
      }
      cursor += 1;
    }

    if (eventStart < 0 && cursor > 0) {
      pending = pending.slice(cursor);
      cursor = 0;
    } else if (eventStart >= 0) {
      pending = pending.slice(eventStart);
      cursor -= eventStart;
      eventStart = 0;
    }
  };

  const finish = () => {
    pending = "";
    const events = Object.fromEntries(TRACE_EVENT_NAMES.map((name) => {
      const metric = eventMetrics.get(name)!;
      const targetRank = Math.ceil(metric.count * 0.95);
      let total = 0;
      let p95Ms = 0;
      if (targetRank > 0) {
        for (let index = 0; index <= maxHistogramIndex; index += 1) {
          total += metric.histogram[index]!;
          if (total >= targetRank) {
            p95Ms = index / 2;
            break;
          }
        }
      }
      return [name, {
        count: metric.count,
        totalMs: round(metric.totalMs),
        p95Ms: round(p95Ms),
        maxMs: round(metric.maxMs),
      }];
    })) as Record<TraceEventName, TraceMetric>;
    const topStacks = [...stacks.values()]
      .sort((left, right) => right.totalMs - left.totalMs || right.count - left.count)
      .slice(0, 20)
      .map((row) => ({ ...row, totalMs: round(row.totalMs) }));
    const styleInvalidations: StyleInvalidationSummary = {
      status: invalidationEventCount > 0 ? "collected" : "no-observations",
      events: invalidationEvents,
      updateLayoutTreeElementCount: {
        total: updateLayoutTreeElementObservations > 0 ? updateLayoutTreeElementTotal : null,
        observations: updateLayoutTreeElementObservations,
        missingCount: updateLayoutTreeElementMissingCount,
        sourceCounts: { ...updateLayoutTreeElementSourceCounts },
      },
    };
    const categories = Object.fromEntries(SELECTOR_STATS_CATEGORY_NAMES.map((name) => {
      const bucket = selectorBuckets[name];
      return [name, {
        count: bucket.count,
        attempts: bucket.presentFields.attempts > 0 ? bucket.attempts : null,
        matches: bucket.presentFields.matches > 0 ? bucket.matches : null,
        fastRejects: bucket.presentFields.fastRejects > 0 ? bucket.fastRejects : null,
        elapsedUs: bucket.presentFields.elapsed > 0 ? bucket.elapsedUs : null,
        missingFields: { ...bucket.missingFields },
      }];
    })) as Record<SelectorStatsCategoryName, SelectorStatsBucket>;
    const selectorStats: SelectorStatsSummary = {
      status: selectorEventCount > 0 && selectorEntriesParsed > 0 ? "collected" : "no-observations",
      selectorScope: "known-application-selector-markers",
      eventCount: selectorEventCount,
      selectorArrayMissingCount,
      entriesOmitted: selectorEntriesOmitted,
      unclassifiedCount: selectorUnclassifiedCount,
      categories,
    };
    return {
      parsedEvents,
      omittedEvents,
      invalidEvents,
      stackRowsOmitted,
      events,
      topStacks,
      styleInvalidations,
      selectorStats,
    };
  };

  return { push, finish };
}

function zeroReasonCounts(): Record<InvalidationReasonName, number> {
  return Object.fromEntries(INVALIDATION_REASON_NAMES.map((name) => [name, 0])) as
    Record<InvalidationReasonName, number>;
}

function readInvalidationReason(event: Record<string, unknown>): InvalidationReasonName | null {
  const args = objectValue(event.args);
  const data = objectValue(args?.data);
  const beginData = objectValue(args?.beginData);
  const endData = objectValue(args?.endData);
  const value = data?.reason ?? beginData?.reason ?? endData?.reason ?? args?.reason;
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized.includes(":has(") || normalized.includes("relational")) return "relational";
  if (normalized.includes("insert")) return "insertion";
  if (normalized.includes("subtree")) return "subtree";
  if (normalized.includes("viewport")) return "viewport";
  if (normalized.includes("rule")) return "rule";
  if (normalized.includes("style")) return "style";
  return INVALIDATION_REASON_NAMES.includes(normalized as InvalidationReasonName)
    ? normalized as InvalidationReasonName
    : "other";
}

function readUpdateLayoutTreeElementCount(
  event: Record<string, unknown>,
): { value: number; source: "args" | "beginData" | "endData" } | null {
  const args = objectValue(event.args);
  const beginData = objectValue(args?.beginData);
  const endData = objectValue(args?.endData);
  const candidates = [
    { value: args?.elementCount, source: "args" as const },
    { value: beginData?.elementCount, source: "beginData" as const },
    { value: endData?.elementCount, source: "endData" as const },
  ];
  const candidate = candidates.find(({ value }) =>
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0,
  );
  return candidate
    ? { value: candidate.value as number, source: candidate.source }
    : null;
}

function readSelectorStatsEntries(event: Record<string, unknown>): Record<string, unknown>[] | null {
  const args = objectValue(event.args);
  const selectorStats = objectValue(args?.selector_stats);
  const timings = selectorStats?.selector_timings;
  if (!Array.isArray(timings)) return null;
  return timings.map(objectValue).filter((entry): entry is Record<string, unknown> => entry !== null);
}

function classifyApplicationSelector(selector: string): SelectorStatsCategoryName | null {
  if (!selector) return null;
  const normalized = selector.toLowerCase();
  // Classify the compound that owns :has(), not a shell prefix or an element
  // inside its argument. This is a marker heuristic, not stylesheet identity.
  const hasIndex = normalized.indexOf(":has(");
  const subject = hasIndex < 0 ? "" : normalized.slice(0, hasIndex).split(/[\s>+~]/).at(-1) ?? "";
  if (subject.includes(".app-shell")) return "app-shell-relational";
  if (
    subject.includes(".nav-tree-row") || subject.includes(".nav-row")
  ) return "sidebar-row-relational";
  if (
    subject.includes(".asset-card") || subject.includes(".workspace-canvas")
  ) return "asset-card-relational";

  const knownApplicationSelector = [
    ".app-shell",
    ".workspace-canvas",
    ".asset-card",
    ".nav-tree-row",
    ".nav-row",
    ".masonry-columns",
    ".justified-rows",
    ".workspace-tabs",
    ".toolbar-workspace",
    ".navigation-pane",
    ".inspector-pane",
  ].some((marker) => normalized.includes(marker));
  return knownApplicationSelector ? "ordinary" : null;
}

function addSelectorEntry(
  bucket: {
    count: number;
    attempts: number;
    matches: number;
    fastRejects: number;
    elapsedUs: number;
    missingFields: { attempts: number; matches: number; fastRejects: number; elapsed: number };
    presentFields: { attempts: number; matches: number; fastRejects: number; elapsed: number };
  },
  entry: Record<string, unknown>,
): void {
  bucket.count += 1;
  const fields = [
    { key: "match_attempts", name: "attempts" as const, target: "attempts" as const },
    { key: "match_count", name: "matches" as const, target: "matches" as const },
    { key: "fast_reject_count", name: "fastRejects" as const, target: "fastRejects" as const },
    { key: "elapsed (us)", name: "elapsed" as const, target: "elapsedUs" as const },
  ];
  for (const field of fields) {
    const value = entry[field.key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      bucket.missingFields[field.name] += 1;
      continue;
    }
    bucket.presentFields[field.name] += 1;
    bucket[field.target] += value;
  }
}

function traceStackFrames(event: Record<string, unknown>): Array<{
  functionName: string;
  url: string;
  lineNumber: number;
}> {
  const args = event.args as Record<string, unknown> | undefined;
  const beginData = args?.beginData as Record<string, unknown> | undefined;
  const data = args?.data as Record<string, unknown> | undefined;
  const candidates = [beginData?.stackTrace, data?.stackTrace, args?.stackTrace, event.stackTrace];
  for (const candidate of candidates) {
    const frames = Array.isArray(candidate)
      ? candidate
      : objectValue(candidate)?.callFrames;
    if (!Array.isArray(frames)) continue;
    return frames.flatMap((value) => {
      const frame = objectValue(value);
      if (!frame) return [];
      return [{
        functionName: typeof frame.functionName === "string" ? frame.functionName : "(anonymous)",
        url: typeof frame.url === "string" ? frame.url : "",
        lineNumber: typeof frame.lineNumber === "number" ? frame.lineNumber : 0,
      }];
    });
  }
  return [];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stackSource(url: string): TraceStackRow["source"] {
  const normalized = url.toLowerCase();
  if (
    normalized.includes("node_modules") ||
    normalized.includes("electron") ||
    normalized.includes("react-dom") ||
    normalized.startsWith("node:")
  ) return "runtime";
  if (
    normalized.includes(".vite") ||
    normalized.includes("/assets/") ||
    normalized.endsWith(".js") ||
    normalized.endsWith(".tsx") ||
    normalized.endsWith(".ts")
  ) return "bundle";
  return "other";
}

function sanitizeFunctionName(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_$<>.-]/gu, "_").slice(0, 64);
  return safe || "(anonymous)";
}

function round(value: number): number {
  return Number(value.toFixed(2));
}
