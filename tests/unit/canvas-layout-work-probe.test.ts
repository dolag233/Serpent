import { describe, expect, it } from "vitest";
import type { CDPSession, Page } from "@playwright/test";
import { installCanvasLayoutWorkProbe } from "../e2e/canvas-layout-work-probe";

type CompletePayload = { dataLossOccurred: boolean; stream?: string };
type ReadChunk = { data: string; eof: boolean; base64Encoded?: boolean };

const pageSummary = {
  observedMs: 12,
  target: "workspace-canvas + virtual masonry/justified grid",
  targetElementCapture: "install-time; replaced elements are not counted",
  targetElements: {
    canvasFound: 1, virtualGridFound: 1, canvasPatched: 1, virtualGridPatched: 1,
  },
  reads: {
    canvas: { clientHeight: 1, clientWidth: 1, scrollHeight: 1, rect: 1 },
    virtualGrid: { clientHeight: 1, clientWidth: 1, scrollHeight: 1, rect: 1 },
  },
  scrollToWrites: { canvas: 0, virtualGrid: 0 },
  frames: {
    samples: 1, dropped: 0, repeatedReadFrames: 0,
    maxReads: 2, p95Reads: 2, writesFrames: 0,
  },
  observerInstrumentation: "not-patched; existing RO/MO callbacks are not observed",
};

class FakeCDPSession {
  readonly calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  pendingCalls = 0;

  constructor(
    private readonly options: {
      completePayload?: CompletePayload;
      chunks?: ReadChunk[];
      failRead?: boolean;
    } = {},
  ) {}

  on(event: string, listener: (payload: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  off(event: string, listener: (payload: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    this.pendingCalls += 1;
    try {
      if (method === "Tracing.tracingComplete") return {};
      if (method === "Tracing.end") {
        const payload = this.options.completePayload ?? {
          dataLossOccurred: false,
          stream: "trace-stream",
        };
        for (const listener of this.listeners.get("Tracing.tracingComplete") ?? []) {
          listener(payload);
        }
        return {};
      }
      if (method === "IO.read") {
        if (this.options.failRead) throw new Error("synthetic read failure");
        return this.options.chunks?.shift() ?? { data: "", eof: true };
      }
      return {};
    } finally {
      this.pendingCalls -= 1;
    }
  }
}

function makePage(options: { failBegin?: boolean } = {}) {
  let evaluateCalls = 0;
  let pendingCalls = 0;
  const evaluate = async (): Promise<unknown> => {
    evaluateCalls += 1;
    pendingCalls += 1;
    try {
      if (options.failBegin && evaluateCalls === 2) {
        throw new Error("synthetic begin failure");
      }
      // Calls 1 and 2 install/begin the page probe; the first later call is stop().
      if (!options.failBegin && evaluateCalls === 3) return pageSummary;
      return undefined;
    } finally {
      pendingCalls -= 1;
    }
  };
  return {
    page: { evaluate } as unknown as Page,
    get evaluateCalls() { return evaluateCalls; },
    get pendingCalls() { return pendingCalls; },
  };
}

function fragmentedTrace(raw: string): ReadChunk[] {
  const escapedQuote = raw.indexOf("\\\"");
  const splitPoints = [
    3,
    Math.min(19, raw.length),
    escapedQuote >= 0 ? escapedQuote + 1 : Math.min(37, raw.length),
    Math.min(71, raw.length),
    raw.length,
  ]
    .filter((point, index, points) => point > 0 && point <= raw.length && points.indexOf(point) === index)
    .sort((left, right) => left - right);
  const chunks: ReadChunk[] = [];
  let start = 0;
  for (const end of splitPoints) {
    if (end <= start) continue;
    chunks.push({ data: raw.slice(start, end), eof: false });
    start = end;
  }
  if (start < raw.length) chunks.push({ data: raw.slice(start), eof: false });
  const last = chunks.at(-1);
  if (last) last.eof = true;
  else chunks.push({ data: "", eof: true });
  return chunks;
}

function countCalls(session: FakeCDPSession, method: string): number {
  return session.calls.filter((call) => call.method === method).length;
}

describe("canvas layout work probe", () => {
  it("aggregates fragmented trace JSON into normalized, path-free layout summaries", async () => {
    const trace = JSON.stringify({ traceEvents: [
      {
        name: "Layout", dur: 1000,
        args: { beginData: { stackTrace: [{
          functionName: "draw (frame)", url: "renderer.js", lineNumber: 7,
        }] } },
      },
      {
        name: "Layout", dur: 3000,
        args: { data: { stackTrace: [{
          functionName: "draw (frame)", url: "renderer.js", lineNumber: 7,
        }] } },
      },
      {
        name: "UpdateLayoutTree", dur: 500,
        args: { stackTrace: [{
          functionName: 'quote "frame"', url: "node:synthetic-runtime", lineNumber: 9,
        }] },
      },
      { name: "OtherEvent", dur: 250 },
      { name: "Paint", dur: 7500 },
      { name: "Layerize", dur: 2500 },
      { name: "CompositeLayers", dur: 1250 },
    ] });
    const page = makePage();
    const session = new FakeCDPSession({ chunks: fragmentedTrace(trace) });
    const probe = await installCanvasLayoutWorkProbe(page.page, session as unknown as CDPSession);

    const summary = await probe.stop();

    expect(summary.trace).toMatchObject({
      status: "complete",
      dataLossOccurred: false,
      parsedEvents: 7,
      events: {
        Layout: { count: 2, totalMs: 4, p95Ms: 3, maxMs: 3 },
        UpdateLayoutTree: { count: 1, totalMs: 0.5, p95Ms: 0.5, maxMs: 0.5 },
        Paint: { count: 1, totalMs: 7.5, p95Ms: 7.5, maxMs: 7.5 },
        Layerize: { count: 1, totalMs: 2.5, p95Ms: 2.5, maxMs: 2.5 },
        // Trace percentiles use an existing half-millisecond histogram bucket.
        CompositeLayers: { count: 1, totalMs: 1.25, p95Ms: 1.5, maxMs: 1.25 },
      },
      topStacks: [
        { source: "bundle", functionName: "draw__frame_", line: 7, count: 2, totalMs: 4 },
        { source: "runtime", functionName: "quote__frame_", line: 9, count: 1, totalMs: 0.5 },
      ],
    });
    expect(summary.page).toEqual(pageSummary);
    expect(summary.styleDiagnostics).toBeUndefined();
    const defaultCategories = session.calls.find((call) => call.method === "Tracing.start")
      ?.params?.traceConfig as { includedCategories: string[] };
    expect(defaultCategories.includedCategories).not.toContain(
      "disabled-by-default-devtools.timeline.invalidationTracking",
    );
    expect(defaultCategories.includedCategories).not.toContain("disabled-by-default-blink.debug");
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("renderer.js");
    expect(serialized).not.toContain("node:synthetic-runtime");
    expect(countCalls(session, "IO.read")).toBeGreaterThan(1);
    expect(countCalls(session, "IO.close")).toBe(1);
    expect(session.listenerCount("Tracing.tracingComplete")).toBe(0);
  });

  it("reports data loss instead of claiming a complete trace", async () => {
    const page = makePage();
    const session = new FakeCDPSession({
      completePayload: { dataLossOccurred: true, stream: "trace-stream" },
      chunks: fragmentedTrace('{"traceEvents":[]}'),
    });
    const probe = await installCanvasLayoutWorkProbe(page.page, session as unknown as CDPSession);

    const summary = await probe.stop();

    expect(summary.trace.status).toBe("data-loss");
    expect(summary.trace.dataLossOccurred).toBe(true);
  });

  it("closes the stream and removes the completion listener after IO.read fails", async () => {
    const page = makePage();
    const session = new FakeCDPSession({
      completePayload: { dataLossOccurred: false, stream: "trace-stream" },
      failRead: true,
    });
    const probe = await installCanvasLayoutWorkProbe(page.page, session as unknown as CDPSession);

    const summary = await probe.stop();

    expect(summary.trace.status).toBe("unavailable");
    expect(countCalls(session, "IO.close")).toBe(1);
    expect(session.listenerCount("Tracing.tracingComplete")).toBe(0);
    expect(session.pendingCalls).toBe(0);
    expect(page.pendingCalls).toBe(0);
  });

  it("cleans up tracing and listeners when page.begin fails after Tracing.start", async () => {
    const page = makePage({ failBegin: true });
    const session = new FakeCDPSession({
      completePayload: { dataLossOccurred: false, stream: "trace-stream" },
    });

    await expect(
      installCanvasLayoutWorkProbe(page.page, session as unknown as CDPSession),
    ).rejects.toThrow("Canvas layout tracing could not be started.");

    expect(countCalls(session, "Tracing.start")).toBe(1);
    expect(countCalls(session, "Tracing.end")).toBe(1);
    expect(countCalls(session, "IO.close")).toBe(1);
    expect(session.listenerCount("Tracing.tracingComplete")).toBe(0);
    expect(session.pendingCalls).toBe(0);
    expect(page.pendingCalls).toBe(0);
  });

  it("shares stop work across repeated stop/dispose calls and settles all pending operations", async () => {
    const page = makePage();
    const session = new FakeCDPSession({ chunks: fragmentedTrace('{"traceEvents":[]}') });
    const probe = await installCanvasLayoutWorkProbe(page.page, session as unknown as CDPSession);

    const firstStop = probe.stop();
    const secondStop = probe.stop();
    expect(secondStop).toBe(firstStop);
    const [summary] = await Promise.all([
      firstStop,
      probe.dispose(),
      probe.dispose(),
    ]);
    await probe.dispose();
    const repeatedStop = await probe.stop();

    expect(repeatedStop).toBe(summary);
    expect(countCalls(session, "Tracing.end")).toBe(1);
    expect(countCalls(session, "IO.close")).toBe(1);
    expect(session.listenerCount("Tracing.tracingComplete")).toBe(0);
    expect(session.pendingCalls).toBe(0);
    expect(page.pendingCalls).toBe(0);
  });

  it("collects fixed-key invalidation reasons and reports missing element counts without leaking raw fields", async () => {
    const trace = JSON.stringify({ traceEvents: [
      {
        name: "UpdateLayoutTree",
        args: { endData: { elementCount: 0, nodeId: 9281, selector: ".private-name" } },
      },
      {
        name: "UpdateLayoutTree",
        args: { data: { url: "fixtures/private/source.css", selector: ".private-name" } },
      },
      {
        name: "UpdateLayoutTree",
        args: { elementCount: 6, endData: { elementCount: 600 } },
      },
      {
        name: "ScheduleStyleInvalidationTracking",
        args: { data: { reason: "class", nodeId: 13, selector: ".private-name" } },
      },
      {
        name: "StyleInvalidatorInvalidationTracking",
        args: { data: { reason: "fixtures/private/source.css?fixture=never-export", nodeId: 14 } },
      },
      {
        name: "StyleRecalcInvalidationTracking",
        args: { data: { reason: null, nodeId: 15, changedAttribute: "private" } },
      },
      ...["inline style change", "relational :has()", "node inserted", "subtree changed", "rule changed", "viewport"]
        .map((reason, index) => ({
          name: "StyleRecalcInvalidationTracking",
          args: { data: { reason, nodeId: 100 + index, selector: ".private-name" } },
        })),
    ] });
    const page = makePage();
    const session = new FakeCDPSession({ chunks: fragmentedTrace(trace) });
    const probe = await installCanvasLayoutWorkProbe(
      page.page,
      session as unknown as CDPSession,
      { styleDiagnostics: "invalidations" },
    );

    const summary = await probe.stop();

    expect(summary.styleDiagnostics).toMatchObject({
      mode: "invalidations",
      status: "collected",
      summary: {
        events: {
          ScheduleStyleInvalidationTracking: {
            count: 1, reasons: { class: 1 }, missingReasonCount: 0,
          },
          StyleInvalidatorInvalidationTracking: {
            count: 1, reasons: { other: 1 }, missingReasonCount: 0,
          },
          StyleRecalcInvalidationTracking: {
            count: 7,
            reasons: {
              style: 1, relational: 1, insertion: 1, subtree: 1, rule: 1, viewport: 1, other: 0,
            },
            missingReasonCount: 1,
          },
        },
        updateLayoutTreeElementCount: {
          total: 6,
          observations: 2,
          missingCount: 1,
          sourceCounts: { args: 1, beginData: 0, endData: 1 },
        },
      },
    });
    expect(JSON.stringify(summary)).not.toContain("private");
    expect(JSON.stringify(summary)).not.toContain("9281");
    const categories = session.calls.find((call) => call.method === "Tracing.start")
      ?.params?.traceConfig as { includedCategories: string[] };
    expect(categories.includedCategories).toContain(
      "disabled-by-default-devtools.timeline.invalidationTracking",
    );
    expect(categories.includedCategories).not.toContain("disabled-by-default-blink.debug");
    expect(categories.includedCategories).not.toContain("disabled-by-default-devtools.timeline.stack");
  });

  it("aggregates only fixed application selector categories and omits raw selectors and stylesheet IDs", async () => {
    const trace = JSON.stringify({ traceEvents: [{
      name: "SelectorStats",
      args: { selector_stats: { selector_timings: [
        {
          selector: ".app-shell:has(.workspace-tabs) /* fixtures/private/secret.css */",
          style_sheet_id: "private-sheet-id",
          "elapsed (us)": 10,
          elapsed: 9999,
          match_attempts: 7,
          fast_reject_count: 2,
          match_count: 3,
        },
        {
          selector: '.app-shell[data-shell-layout="islands"] .nav-tree-row:has(> .nav-row.is-active)',
          style_sheet_id: "private-sheet-id-2",
          "elapsed (us)": 20,
          match_attempts: 9,
          fast_reject_count: 4,
          match_count: 5,
        },
        {
          selector: '.app-shell[data-shell-layout="islands"] .asset-card:has(.asset-sync-status)',
          style_sheet_id: "private-sheet-id-3",
          "elapsed (us)": 30,
          match_attempts: 11,
          fast_reject_count: 6,
          match_count: 7,
        },
        {
          selector: ".asset-card",
          style_sheet_id: "private-sheet-id-4",
          "elapsed (us)": 40,
          match_attempts: 13,
          fast_reject_count: 8,
          match_count: 9,
        },
        {
          selector: ".foreign-secret-selector",
          style_sheet_id: "private-sheet-id-5",
          "elapsed (us)": 1000,
          match_attempts: 1000,
          fast_reject_count: 1000,
          match_count: 1000,
        },
        {
          selector: ".workspace-canvas",
          style_sheet_id: "private-sheet-id-6",
          "elapsed (us)": "fixtures/private/not-a-number",
          match_attempts: 1,
          fast_reject_count: null,
        },
      ] } },
    }] });
    const page = makePage();
    const session = new FakeCDPSession({ chunks: fragmentedTrace(trace) });
    const probe = await installCanvasLayoutWorkProbe(
      page.page,
      session as unknown as CDPSession,
      { styleDiagnostics: "selectors" },
    );

    const summary = await probe.stop();

    expect(summary.styleDiagnostics).toMatchObject({
      mode: "selectors",
      status: "collected",
      summary: {
        eventCount: 1,
        selectorArrayMissingCount: 0,
        unclassifiedCount: 1,
        categories: {
          "app-shell-relational": {
            count: 1, attempts: 7, matches: 3, fastRejects: 2, elapsedUs: 10,
          },
          "sidebar-row-relational": {
            count: 1, attempts: 9, matches: 5, fastRejects: 4, elapsedUs: 20,
          },
          "asset-card-relational": {
            count: 1, attempts: 11, matches: 7, fastRejects: 6, elapsedUs: 30,
          },
          ordinary: {
            count: 2,
            attempts: 14,
            matches: 9,
            fastRejects: 8,
            elapsedUs: 40,
            missingFields: { elapsed: 1 },
          },
        },
      },
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("secret.css");
    expect(serialized).not.toContain("private-sheet-id");
    expect(serialized).not.toContain("foreign-secret-selector");
    const categories = session.calls.find((call) => call.method === "Tracing.start")
      ?.params?.traceConfig as { includedCategories: string[] };
    expect(categories.includedCategories).toContain("disabled-by-default-blink.debug");
    expect(categories.includedCategories).not.toContain(
      "disabled-by-default-devtools.timeline.invalidationTracking",
    );
  });

  it("reports the selector schema as missing instead of fabricating observations", async () => {
    const trace = JSON.stringify({ traceEvents: [{
      name: "SelectorStats",
      args: { selector_timings: [{ selector: ".app-shell", match_count: 0 }] },
    }] });
    const page = makePage();
    const session = new FakeCDPSession({ chunks: fragmentedTrace(trace) });
    const probe = await installCanvasLayoutWorkProbe(
      page.page,
      session as unknown as CDPSession,
      { styleDiagnostics: "selectors" },
    );

    const summary = await probe.stop();

    expect(summary.styleDiagnostics).toMatchObject({
      mode: "selectors",
      status: "no-observations",
      summary: {
        eventCount: 1,
        selectorArrayMissingCount: 1,
        categories: {
          "app-shell-relational": { count: 0, attempts: null, matches: null },
          "sidebar-row-relational": { count: 0, attempts: null, matches: null },
          "asset-card-relational": { count: 0, attempts: null, matches: null },
          ordinary: { count: 0, attempts: null, matches: null },
        },
      },
    });
  });
});
