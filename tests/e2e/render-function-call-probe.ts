import type { CDPSession } from "@playwright/test";

const MAX_RENDERER_SCRIPTS = 256;
const MAX_COVERAGE_SCRIPTS = 2_048;
const MAX_SOURCE_CHARS = 16 * 1024 * 1024;
const MAX_SOURCE_CHARS_PER_SCRIPT = 8 * 1024 * 1024;
const MAX_COVERAGE_FUNCTIONS = 100_000;
const RENDERER_SCRIPT_EXTENSION = /\.(?:m?js)$/i;

export const RENDER_FUNCTION_CATEGORIES = [
  "AppearanceGlyph",
  "Icon",
  "buildJustifiedRowGeometry",
  "buildJustifiedGeometry",
  "NavigationSidebar",
] as const;

export type RenderFunctionCategory = (typeof RENDER_FUNCTION_CATEGORIES)[number];

export type RenderFunctionCategoryResult =
  | { status: "matched"; calls: number }
  | { status: "ambiguous" }
  | {
      status: "unmatched";
      reason:
        | "no-source-match"
        | "source-unavailable"
        | "source-scan-incomplete"
        | "coverage-unavailable";
    };

export type RenderFunctionCallSummary = {
  status: "complete" | "partial" | "unavailable";
  categories: Record<RenderFunctionCategory, RenderFunctionCategoryResult>;
};

export type RenderFunctionCallProbe = {
  stop(): Promise<RenderFunctionCallSummary>;
  dispose(): Promise<void>;
};

type CoverageRange = { startOffset: number; endOffset: number; count: number };
type FunctionCoverage = { ranges: CoverageRange[] };
type ScriptCoverage = {
  scriptId: string;
  url: string;
  functions: FunctionCoverage[];
};
type PreciseCoverage = { result: ScriptCoverage[]; invalidEntries: boolean };

const bodyMatches: Record<RenderFunctionCategory, (body: string) => boolean> = {
  AppearanceGlyph: (body) => hasAllLiterals(body, [
    "nav-entity-glyph",
    "nav-entity-glyph-emoji",
    "nav-entity-glyph-badge",
  ]),
  Icon: (body) => hasAll(body, [
    "aria-hidden",
    "className",
    "viewBox",
    "width",
    "height",
    "size",
  ]) && hasAllLiterals(body, ["icon", "0 0 24 24"])
    && /children\s*:\s*[\w$]+\[[\w$]+\]/.test(body),
  buildJustifiedRowGeometry: (body) => hasAllProperties(body, [
    "previewHeight",
    "bodyHeight",
    "captionBand",
    "widths",
    "offset",
  ]) && /\.entryAt\s*\(/.test(body)
    && /\.itemsPerRow\b/.test(body)
    && /\.reduce\s*\(/.test(body)
    && /Math\.round\s*\(/.test(body),
  buildJustifiedGeometry: (body) => hasAll(body, [
    ".total",
    ".itemsPerRow",
    ".availableWidth",
    ".targetHeight",
    ".captionBand",
    ".entryAt",
  ]) && /\.push\(\{\.\.\.[\w$]+,\s*offset\s*:\s*[\w$]+\}\)/.test(body.replace(/\s+/g, "")),
  NavigationSidebar: (body) => hasAllLiterals(body, ["navigation-pane", "navigation-scroll"]),
};

function hasAll(value: string, markers: readonly string[]): boolean {
  return markers.every((marker) => value.includes(marker));
}

function hasAllLiterals(value: string, literals: readonly string[]): boolean {
  return literals.every((literal) => {
    const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("[\\\"'`]" + escaped + "[\\\"'`]").test(value);
  });
}

function hasAllProperties(value: string, keys: readonly string[]): boolean {
  return keys.every((key) => new RegExp(`(?:^|[,{])\\s*["']?${key}["']?\\s*:`).test(value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isRendererAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:" && url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const pathSegments = url.pathname.split("/").filter(Boolean);
    return pathSegments.some((segment) => segment.toLowerCase() === "assets")
      && RENDERER_SCRIPT_EXTENSION.test(pathSegments.at(-1) ?? "");
  } catch {
    return false;
  }
}

function coverageResponse(value: unknown): PreciseCoverage | null {
  const root = record(value);
  if (!root || !Array.isArray(root.result)) return null;
  const result: ScriptCoverage[] = [];
  let invalidEntries = false;
  let functionsTotal = 0;
  for (const rawScript of root.result) {
    if (result.length >= MAX_COVERAGE_SCRIPTS) {
      invalidEntries = true;
      break;
    }
    const script = record(rawScript);
    if (typeof script?.scriptId !== "string" || typeof script.url !== "string"
      || !Array.isArray(script.functions)) {
      invalidEntries = true;
      continue;
    }
    const functions: FunctionCoverage[] = [];
    for (const rawFunction of script.functions) {
      if (functionsTotal >= MAX_COVERAGE_FUNCTIONS) {
        invalidEntries = true;
        break;
      }
      const functionEntry = record(rawFunction);
      if (!Array.isArray(functionEntry?.ranges)) {
        invalidEntries = true;
        continue;
      }
      const ranges: CoverageRange[] = [];
      for (const rawRange of functionEntry.ranges) {
        const range = record(rawRange);
        if (!range || !Number.isSafeInteger(range.startOffset) || !Number.isSafeInteger(range.endOffset)
          || !Number.isSafeInteger(range?.count)) {
          invalidEntries = true;
          continue;
        }
        ranges.push({
          startOffset: range.startOffset as number,
          endOffset: range.endOffset as number,
          count: range.count as number,
        });
      }
      if (ranges.length === 0) invalidEntries = true;
      if (ranges.length > 0) {
        functions.push({ ranges });
        functionsTotal += 1;
      }
    }
    result.push({ scriptId: script.scriptId, url: script.url, functions });
    if (functionsTotal >= MAX_COVERAGE_FUNCTIONS) {
      invalidEntries = true;
      break;
    }
  }
  return { result, invalidEntries };
}

function emptyCategories(
  reason: Extract<RenderFunctionCategoryResult, { status: "unmatched" }>["reason"],
): Record<RenderFunctionCategory, RenderFunctionCategoryResult> {
  return Object.fromEntries(RENDER_FUNCTION_CATEGORIES.map((category) => [
    category,
    { status: "unmatched", reason },
  ])) as Record<RenderFunctionCategory, RenderFunctionCategoryResult>;
}

/**
 * Classify V8's non-detailed function coverage from source bodies, not minified
 * function names. The source map is keyed by opaque script id and is never
 * copied into the returned summary.
 */
export function summarizeRenderFunctionCoverage(input: {
  coverage: unknown;
  sourceByScriptId: ReadonlyMap<string, string>;
  sourceScanComplete?: boolean;
}): RenderFunctionCallSummary {
  const coverage = coverageResponse(input.coverage);
  if (!coverage) {
    return {
      status: "unavailable",
      categories: emptyCategories("coverage-unavailable"),
    };
  }

  const candidates = new Map<RenderFunctionCategory, number[]>(
    RENDER_FUNCTION_CATEGORIES.map((category) => [category, []]),
  );
  let functionCount = 0;
  let sourceUnavailable = false;
  let scanComplete = input.sourceScanComplete !== false && !coverage.invalidEntries;

  for (const script of coverage.result) {
    if (!isRendererAssetUrl(script.url)) continue;
    const source = input.sourceByScriptId.get(script.scriptId);
    if (source === undefined) {
      sourceUnavailable = true;
      scanComplete = false;
      continue;
    }
    for (const functionCoverage of script.functions) {
      functionCount += 1;
      if (functionCount > MAX_COVERAGE_FUNCTIONS) {
        scanComplete = false;
        break;
      }
      const outerRange = functionCoverage.ranges.reduce<CoverageRange | undefined>(
        (largest, range) => !largest || range.endOffset - range.startOffset
          > largest.endOffset - largest.startOffset ? range : largest,
        undefined,
      );
      if (!outerRange || outerRange.startOffset < 0 || outerRange.endOffset > source.length
        || outerRange.endOffset <= outerRange.startOffset || outerRange.count < 0) {
        scanComplete = false;
        continue;
      }
      const body = source.slice(outerRange.startOffset, outerRange.endOffset);
      for (const category of RENDER_FUNCTION_CATEGORIES) {
        if (bodyMatches[category](body)) candidates.get(category)!.push(outerRange.count);
      }
    }
    if (functionCount > MAX_COVERAGE_FUNCTIONS) break;
  }

  const categories = Object.fromEntries(RENDER_FUNCTION_CATEGORIES.map((category) => {
    const found = candidates.get(category)!;
    if (found.length > 1) return [category, { status: "ambiguous" }];
    if (found.length === 1 && scanComplete) {
      return [category, { status: "matched", calls: found[0]! }];
    }
    return [category, {
      status: "unmatched",
      reason: sourceUnavailable
        ? "source-unavailable"
        : scanComplete ? "no-source-match" : "source-scan-incomplete",
    }];
  })) as Record<RenderFunctionCategory, RenderFunctionCategoryResult>;
  const status = RENDER_FUNCTION_CATEGORIES.every((category) => categories[category].status === "matched")
    && scanComplete
    ? "complete"
    : "partial";
  return { status, categories };
}

/**
 * Counts selected renderer function bodies during a bounded scroll interval.
 * Precise coverage disables optimized code, so call totals are diagnostic
 * counts and must never be treated as an uninstrumented A/B timing result.
 */
export async function installRenderFunctionCallProbe(
  session: CDPSession,
): Promise<RenderFunctionCallProbe> {
  const rendererScriptUrls = new Map<string, string>();
  let scriptInventoryTruncated = false;
  let debuggerEnableAttempted = false;
  let profilerEnableAttempted = false;
  let coverageStartAttempted = false;
  let listenerAttached = false;
  let debuggerDisabled = false;
  let profilerDisabled = false;

  const onScriptParsed = (payload: unknown) => {
    const event = record(payload);
    if (typeof event?.scriptId !== "string" || typeof event.url !== "string"
      || !isRendererAssetUrl(event.url) || rendererScriptUrls.has(event.scriptId)) return;
    if (rendererScriptUrls.size >= MAX_RENDERER_SCRIPTS) {
      scriptInventoryTruncated = true;
      return;
    }
    rendererScriptUrls.set(event.scriptId, event.url);
  };

  const cleanup = async () => {
    if (coverageStartAttempted) {
      coverageStartAttempted = false;
      await session.send("Profiler.stopPreciseCoverage").catch(() => undefined);
    }
    if (listenerAttached) {
      listenerAttached = false;
      session.off("Debugger.scriptParsed", onScriptParsed);
    }
    if (debuggerEnableAttempted && !debuggerDisabled) {
      debuggerDisabled = true;
      await session.send("Debugger.disable").catch(() => undefined);
    }
    if (profilerEnableAttempted && !profilerDisabled) {
      profilerDisabled = true;
      await session.send("Profiler.disable").catch(() => undefined);
    }
  };

  try {
    session.on("Debugger.scriptParsed", onScriptParsed);
    listenerAttached = true;
    debuggerEnableAttempted = true;
    await session.send("Debugger.enable");
    profilerEnableAttempted = true;
    await session.send("Profiler.enable");
    coverageStartAttempted = true;
    await session.send("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  } catch {
    await cleanup();
    throw new Error("Renderer function coverage could not be started.");
  }

  let stopPromise: Promise<RenderFunctionCallSummary> | undefined;
  let disposePromise: Promise<void> | undefined;

  const stopAndSummarize = async (): Promise<RenderFunctionCallSummary> => {
    try {
    let rawCoverage: unknown;
    let coverageAvailable = false;
    try {
      rawCoverage = await session.send("Profiler.takePreciseCoverage");
      coverageAvailable = true;
    } catch {
      // Stop and disable the domains below; the result will state that the
      // coverage data was unavailable instead of turning missing evidence
      // into zero calls.
    } finally {
      if (coverageStartAttempted) {
        coverageStartAttempted = false;
        await session.send("Profiler.stopPreciseCoverage").catch(() => undefined);
      }
    }

    const sources = new Map<string, string>();
    let sourceScanComplete = !scriptInventoryTruncated;
    let sourceChars = 0;
    const parsedCoverage = coverageAvailable ? coverageResponse(rawCoverage) : null;
    if (parsedCoverage?.invalidEntries) sourceScanComplete = false;
    if (parsedCoverage) {
      const seen = new Set<string>();
      for (const script of parsedCoverage.result) {
        if (!isRendererAssetUrl(script.url) || seen.has(script.scriptId)) continue;
        seen.add(script.scriptId);
        if (rendererScriptUrls.get(script.scriptId) !== script.url) {
          sourceScanComplete = false;
          continue;
        }
        if (seen.size > MAX_RENDERER_SCRIPTS) {
          sourceScanComplete = false;
          break;
        }
        try {
          const response = record(await session.send("Debugger.getScriptSource", {
            scriptId: script.scriptId,
          }));
          const source = typeof response?.scriptSource === "string" ? response.scriptSource : undefined;
          if (source === undefined) {
            sourceScanComplete = false;
            continue;
          }
          if (source.length > MAX_SOURCE_CHARS_PER_SCRIPT
            || sourceChars + source.length > MAX_SOURCE_CHARS) {
            sourceScanComplete = false;
            break;
          }
          sourceChars += source.length;
          sources.set(script.scriptId, source);
        } catch {
          sourceScanComplete = false;
        }
      }
    }

    await cleanup();
    if (!coverageAvailable) {
      return {
        status: "unavailable",
        categories: emptyCategories("coverage-unavailable"),
      };
    }
    if (!parsedCoverage) {
      return {
        status: "unavailable",
        categories: emptyCategories("coverage-unavailable"),
      };
    }
    return summarizeRenderFunctionCoverage({
      coverage: rawCoverage,
      sourceByScriptId: sources,
      sourceScanComplete,
    });
  } finally {
    await cleanup();
    rendererScriptUrls.clear();
  }
  };

  const stop = (): Promise<RenderFunctionCallSummary> => {
    stopPromise ??= stopAndSummarize();
    return stopPromise;
  };

  const dispose = (): Promise<void> => {
    disposePromise ??= stop().then(() => undefined, async () => {
      await cleanup();
    });
    return disposePromise;
  };

  return { stop, dispose };
}
