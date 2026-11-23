import { describe, expect, it } from "vitest";
import type { CDPSession } from "@playwright/test";
import {
  installRenderFunctionCallProbe,
  summarizeRenderFunctionCoverage,
} from "../e2e/render-function-call-probe";

type FakeCoverageRange = { startOffset: number; endOffset: number; count: number };
type FakeCoverageFunction = { functionName: string; ranges: FakeCoverageRange[] };
type FakeCoverageScript = {
  scriptId: string;
  url: string;
  functions: FakeCoverageFunction[];
};

const fixtureUrl = "https://example.invalid/assets/renderer-fixture.js";
const fixtureScriptId = "script-fixture-1";

function knownFunctionBodies() {
  return [
    {
      body: "function a(){return `nav-entity-glyph`+`nav-entity-glyph-emoji`+`nav-entity-glyph-badge`}",
      calls: 31,
    },
    {
      body: 'function b(){return {"aria-hidden":true,className:`icon`,viewBox:`0 0 24 24`,width:size,height:size,children:iconPaths[name]}}',
      calls: 47,
    },
    {
      body: "function c(i){const s=i.row*i.itemsPerRow;const n=Math.min(i.itemsPerRow,i.total-s);const entries=Array.from({length:n},(e,o)=>i.entryAt(s+o));const ratios=entries.map(e=>e.width/e.height);const usable=Math.max(1,i.availableWidth);const naturalWidth=ratios.reduce((total,ratio)=>total+ratio,0)*i.targetHeight;const scale=naturalWidth>0?usable/naturalWidth:1;const previewHeight=Math.max(1,Math.round(i.targetHeight*scale));const widths=ratios.map(ratio=>Math.max(1,Math.round(ratio*previewHeight)));const captionBand=Math.max(0,i.captionBand);return {previewHeight:previewHeight,bodyHeight:previewHeight+captionBand,captionBand:captionBand,widths:widths,offset:0}}",
      calls: 59,
    },
    {
      body: "function d(input){const t=input.total;const n=input.itemsPerRow;const w=input.availableWidth;const h=input.targetHeight;const c=input.captionBand;const e=input.entryAt;const rows=[];rows.push({...row,offset:offset});return rows}",
      calls: 61,
    },
    {
      body: "function e(){return `navigation-pane`+`navigation-scroll`}",
      calls: 73,
    },
  ];
}

function makeCoverage(source: string, calls: readonly number[] = []): {
  result: FakeCoverageScript[];
} {
  let cursor = 0;
  const functions = knownFunctionBodies().map(({ body, calls: defaultCalls }, functionIndex) => {
    const startOffset = source.indexOf(body, cursor);
    if (startOffset < 0) throw new Error("Test source is missing a function fixture.");
    const endOffset = startOffset + body.length;
    cursor = endOffset;
    return {
      functionName: `minified_${functionIndex}`,
      ranges: [{ startOffset, endOffset, count: calls[functionIndex] ?? defaultCalls }],
    };
  });
  return {
    result: [{ scriptId: fixtureScriptId, url: fixtureUrl, functions }],
  };
}

class FakeCDPSession {
  readonly calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  pendingCalls = 0;

  constructor(private readonly options: {
    source: string;
    coverage?: unknown;
    failCommand?: string;
    failGetSource?: boolean;
  }) {}

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
      if (method === this.options.failCommand) throw new Error("synthetic CDP failure");
      if (method === "Debugger.enable") {
        for (const listener of this.listeners.get("Debugger.scriptParsed") ?? []) {
          listener({ scriptId: fixtureScriptId, url: fixtureUrl });
          listener({ scriptId: "unrelated-script", url: "https://example.invalid/chunk.js" });
        }
        return {};
      }
      if (method === "Profiler.takePreciseCoverage") {
        return this.options.coverage ?? makeCoverage(this.options.source);
      }
      if (method === "Debugger.getScriptSource") {
        if (this.options.failGetSource) throw new Error("synthetic source failure");
        expect(params?.scriptId).toBe(fixtureScriptId);
        return { scriptSource: this.options.source };
      }
      return {};
    } finally {
      this.pendingCalls -= 1;
    }
  }
}

function fixtureSource(): string {
  return knownFunctionBodies().map(({ body }) => body).join("\n");
}

function callCount(session: FakeCDPSession, method: string): number {
  return session.calls.filter((call) => call.method === method).length;
}

describe("render function call probe", () => {
  it("maps source-marked function bodies without relying on minified names", () => {
    const source = fixtureSource();
    const coverage = makeCoverage(source);
    coverage.result[0]!.functions.forEach((entry, index) => {
      entry.functionName = `x${index}`;
    });

    const summary = summarizeRenderFunctionCoverage({
      coverage,
      sourceByScriptId: new Map([[fixtureScriptId, source]]),
    });

    expect(summary).toEqual({
      status: "complete",
      categories: {
        AppearanceGlyph: { status: "matched", calls: 31 },
        Icon: { status: "matched", calls: 47 },
        buildJustifiedRowGeometry: { status: "matched", calls: 59 },
        buildJustifiedGeometry: { status: "matched", calls: 61 },
        NavigationSidebar: { status: "matched", calls: 73 },
      },
    });
  });

  it("reports ambiguous and missing evidence instead of a guessed zero", () => {
    const duplicatedAppearance = [
      "function a(){return `nav-entity-glyph`+`nav-entity-glyph-emoji`+`nav-entity-glyph-badge`}",
      "function b(){return `nav-entity-glyph`+`nav-entity-glyph-emoji`+`nav-entity-glyph-badge`}",
    ].join("\n");
    const body = duplicatedAppearance.slice(0, duplicatedAppearance.indexOf("\n"));
    const secondBody = duplicatedAppearance.slice(duplicatedAppearance.indexOf("\n") + 1);
    const coverage = {
      result: [{
        scriptId: fixtureScriptId,
        url: fixtureUrl,
        functions: [body, secondBody].map((sourceBody, index) => {
          const startOffset = duplicatedAppearance.indexOf(sourceBody);
          return {
            functionName: `minified_${index}`,
            ranges: [{ startOffset, endOffset: startOffset + sourceBody.length, count: 9 }],
          };
        }),
      }],
    };

    const summary = summarizeRenderFunctionCoverage({
      coverage,
      sourceByScriptId: new Map([[fixtureScriptId, duplicatedAppearance]]),
    });

    expect(summary.status).toBe("partial");
    expect(summary.categories.AppearanceGlyph).toEqual({ status: "ambiguous" });
    expect(summary.categories.Icon).toEqual({ status: "unmatched", reason: "no-source-match" });
    expect(summary.categories.Icon).not.toHaveProperty("calls", 0);

    const missing = summarizeRenderFunctionCoverage({
      coverage: makeCoverage(fixtureSource()),
      sourceByScriptId: new Map(),
    });
    expect(missing.categories.AppearanceGlyph).toEqual({
      status: "unmatched", reason: "source-unavailable",
    });
  });

  it("does not claim uniqueness when the bounded source scan is incomplete", () => {
    const source = fixtureSource();
    const summary = summarizeRenderFunctionCoverage({
      coverage: makeCoverage(source),
      sourceByScriptId: new Map([[fixtureScriptId, source]]),
      sourceScanComplete: false,
    });

    expect(summary.status).toBe("partial");
    expect(summary.categories.AppearanceGlyph).toEqual({
      status: "unmatched", reason: "source-scan-incomplete",
    });
  });

  it("separates the row builder from an unrelated row-shaped fallback literal", () => {
    const fallback = "function f(){return {previewHeight:1,bodyHeight:1,captionBand:0,widths:[],offset:1}}";
    const rowBuilder = knownFunctionBodies()[2]!.body;
    const source = `${fallback}\n${rowBuilder}`;
    const makeRange = (body: string, count: number) => {
      const startOffset = source.indexOf(body);
      return { startOffset, endOffset: startOffset + body.length, count };
    };
    const coverage = {
      result: [{
        scriptId: fixtureScriptId,
        url: fixtureUrl,
        functions: [
          { functionName: "f", ranges: [makeRange(fallback, 5)] },
          { functionName: "r", ranges: [makeRange(rowBuilder, 19)] },
        ],
      }],
    };

    const summary = summarizeRenderFunctionCoverage({
      coverage,
      sourceByScriptId: new Map([[fixtureScriptId, source]]),
    });

    expect(summary.categories.buildJustifiedRowGeometry).toEqual({ status: "matched", calls: 19 });
  });

  it("uses precise call-count coverage, then stops and removes listeners on stop/dispose", async () => {
    const source = fixtureSource();
    const session = new FakeCDPSession({ source });
    const probe = await installRenderFunctionCallProbe(session as unknown as CDPSession);

    const firstStop = probe.stop();
    const secondStop = probe.stop();
    expect(secondStop).toBe(firstStop);
    const [summary] = await Promise.all([firstStop, probe.dispose(), probe.dispose()]);

    expect(summary.categories.AppearanceGlyph).toEqual({ status: "matched", calls: 31 });
    expect(session.calls.find((call) => call.method === "Profiler.startPreciseCoverage")?.params)
      .toEqual({ callCount: true, detailed: false });
    const methods = session.calls.map((call) => call.method);
    expect(methods.indexOf("Profiler.startPreciseCoverage"))
      .toBeLessThan(methods.indexOf("Profiler.takePreciseCoverage"));
    expect(methods.indexOf("Profiler.takePreciseCoverage"))
      .toBeLessThan(methods.indexOf("Profiler.stopPreciseCoverage"));
    expect(callCount(session, "Profiler.stopPreciseCoverage")).toBe(1);
    expect(callCount(session, "Debugger.disable")).toBe(1);
    expect(callCount(session, "Profiler.disable")).toBe(1);
    expect(session.listenerCount("Debugger.scriptParsed")).toBe(0);
    expect(session.pendingCalls).toBe(0);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(fixtureUrl);
    expect(serialized).not.toContain(fixtureScriptId);
    expect(serialized).not.toContain("minified_");
    expect(serialized).not.toContain("nav-entity-glyph");
  });

  it("settles coverage and listener cleanup when source lookup or collection fails", async () => {
    const sourceFailure = new FakeCDPSession({ source: fixtureSource(), failGetSource: true });
    const sourceProbe = await installRenderFunctionCallProbe(sourceFailure as unknown as CDPSession);
    const sourceSummary = await sourceProbe.stop();
    expect(sourceSummary.categories.AppearanceGlyph).toEqual({
      status: "unmatched", reason: "source-unavailable",
    });
    expect(sourceFailure.listenerCount("Debugger.scriptParsed")).toBe(0);
    expect(sourceFailure.pendingCalls).toBe(0);

    const collectionFailure = new FakeCDPSession({
      source: fixtureSource(), failCommand: "Profiler.takePreciseCoverage",
    });
    const collectionProbe = await installRenderFunctionCallProbe(collectionFailure as unknown as CDPSession);
    const unavailable = await collectionProbe.stop();
    expect(unavailable.status).toBe("unavailable");
    expect(unavailable.categories.AppearanceGlyph).toEqual({
      status: "unmatched", reason: "coverage-unavailable",
    });
    expect(callCount(collectionFailure, "Profiler.stopPreciseCoverage")).toBe(1);
    expect(collectionFailure.listenerCount("Debugger.scriptParsed")).toBe(0);
    expect(collectionFailure.pendingCalls).toBe(0);
  });

  it("stops an attempted precise-coverage start and disables domains after start failure", async () => {
    const session = new FakeCDPSession({
      source: fixtureSource(), failCommand: "Profiler.startPreciseCoverage",
    });

    await expect(
      installRenderFunctionCallProbe(session as unknown as CDPSession),
    ).rejects.toThrow("Renderer function coverage could not be started.");

    expect(callCount(session, "Profiler.stopPreciseCoverage")).toBe(1);
    expect(callCount(session, "Debugger.disable")).toBe(1);
    expect(callCount(session, "Profiler.disable")).toBe(1);
    expect(session.listenerCount("Debugger.scriptParsed")).toBe(0);
    expect(session.pendingCalls).toBe(0);
  });
});
