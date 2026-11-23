import type { Page } from "@playwright/test";

export type ViewportGeometrySnapshot = {
  reads: {
    total: number;
    workspaceCanvas: number;
    grid: number;
    layoutSlot: number;
    card: number;
    other: number;
  };
  comparisons: {
    events: number;
    comparedIds: number;
    mismatches: number;
    missing: number;
    extra: number;
    orderOnly: number;
  };
  checkpoint: {
    referenceCount: number;
    reportedCount: number;
    checkpointCompared: number;
    comparedIds: number;
    mismatches: number;
    missing: number;
    extra: number;
    orderOnly: number;
  };
  pageErrors: number;
};

export type ViewportReportGeometryProbe = {
  reset(): Promise<void>;
  read(): Promise<ViewportGeometrySnapshot>;
  checkpoint(): Promise<ViewportGeometrySnapshot["checkpoint"]>;
  dispose(): Promise<void>;
};

type ProbeAction = "read" | "reset" | "checkpoint" | "dispose";

/** This function is serialized into the renderer by Playwright; keep it self-contained. */
export function installViewportReportGeometryProbeInPage(options: { compareDom?: boolean }): void {
  type ReadCounts = ViewportGeometrySnapshot["reads"];
  type ComparisonCounts = Omit<ViewportGeometrySnapshot["comparisons"], "events">;
  type CheckpointCounts = ViewportGeometrySnapshot["checkpoint"];
  type ProbeState = {
    originalDescriptor: PropertyDescriptor;
    originalMethod: (...args: unknown[]) => DOMRect;
    compareDom: boolean;
    reads: ReadCounts;
    comparisons: ViewportGeometrySnapshot["comparisons"];
    checkpoint: CheckpointCounts;
    lastReport: string[] | null;
    visibleWindowListener: EventListener;
  };
  type ProbeGlobal = typeof globalThis & {
    __serpentViewportReportGeometryProbe?: ProbeState;
  };

  const scope = globalThis as ProbeGlobal;
  if (scope.__serpentViewportReportGeometryProbe) {
    throw new Error("Viewport geometry probe is already installed.");
  }
  const originalDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
  if (typeof originalDescriptor?.value !== "function") {
    throw new Error("Element.getBoundingClientRect is unavailable.");
  }
  const originalMethod = originalDescriptor.value as (...args: unknown[]) => DOMRect;
  const state: ProbeState = {
    originalDescriptor,
    originalMethod,
    compareDom: options.compareDom === true,
    reads: { total: 0, workspaceCanvas: 0, grid: 0, layoutSlot: 0, card: 0, other: 0 },
    comparisons: { events: 0, comparedIds: 0, mismatches: 0, missing: 0, extra: 0, orderOnly: 0 },
    checkpoint: {
      referenceCount: 0, reportedCount: 0, checkpointCompared: 0, comparedIds: 0,
      mismatches: 0, missing: 0, extra: 0, orderOnly: 0,
    },
    lastReport: null,
    visibleWindowListener: () => undefined,
  };

  const collectDomReference = (): string[] => {
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!canvas) return [];
    const canvasRect = Reflect.apply(originalMethod, canvas, []) as DOMRect;
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const slot of canvas.querySelectorAll<HTMLElement>(
      ".asset-card[data-asset-id], [data-layout-asset-id]",
    )) {
      if (ids.length >= 300) break;
      const rect = Reflect.apply(originalMethod, slot, []) as DOMRect;
      if (rect.bottom <= canvasRect.top || rect.top >= canvasRect.bottom) continue;
      const assetId = slot.dataset.assetId ?? slot.dataset.layoutAssetId;
      if (!assetId || assetId.startsWith("__geometry__:") || seen.has(assetId)) continue;
      seen.add(assetId);
      ids.push(assetId);
    }
    return ids;
  };

  const addComparison = (counts: ComparisonCounts, expected: readonly string[], actual: readonly string[]) => {
    counts.comparedIds += Math.max(expected.length, actual.length);
    const expectedOccurrences = new Map<string, number>();
    const actualOccurrences = new Map<string, number>();
    let missing = 0;
    let extra = 0;
    for (const id of expected) expectedOccurrences.set(id, (expectedOccurrences.get(id) ?? 0) + 1);
    for (const id of actual) actualOccurrences.set(id, (actualOccurrences.get(id) ?? 0) + 1);
    for (const [id, count] of expectedOccurrences) {
      missing += Math.max(0, count - (actualOccurrences.get(id) ?? 0));
    }
    for (const [id, count] of actualOccurrences) {
      extra += Math.max(0, count - (expectedOccurrences.get(id) ?? 0));
    }
    counts.missing += missing;
    counts.extra += extra;
    const sameOrder = expected.length === actual.length
      && expected.every((id, index) => id === actual[index]);
    if (sameOrder) return;
    counts.mismatches += 1;
    if (missing === 0 && extra === 0) counts.orderOnly += 1;
  };

  const visibleWindowListener: EventListener = (event) => {
    if (!state.compareDom) return;
    const detail = (event as CustomEvent<{ visible?: unknown }>).detail;
    const actual: string[] = [];
    if (Array.isArray(detail?.visible)) {
      for (const id of detail.visible) {
        if (typeof id !== "string") continue;
        actual.push(id);
        if (actual.length >= 300) break;
      }
    }
    const expected = collectDomReference();
    state.comparisons.events += 1;
    addComparison(state.comparisons, expected, actual);
    state.lastReport = actual.slice();
  };
  state.visibleWindowListener = visibleWindowListener;

  const wrappedMethod = function (this: Element, ...args: unknown[]): DOMRect {
    const canvas = this.matches(".workspace-canvas") ? this : this.closest(".workspace-canvas");
    if (canvas && (canvas === this || canvas.contains(this))) {
      state.reads.total += 1;
      if (this.matches(".workspace-canvas")) state.reads.workspaceCanvas += 1;
      else if (this.matches(".masonry-columns, .justified-rows")) state.reads.grid += 1;
      else if (this.matches("[data-layout-asset-id]")) state.reads.layoutSlot += 1;
      else if (this.matches(".asset-card[data-asset-id]")) state.reads.card += 1;
      else state.reads.other += 1;
    }
    return Reflect.apply(originalMethod, this, args) as DOMRect;
  };

  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    ...originalDescriptor,
    value: wrappedMethod,
  });
  scope.__serpentViewportReportGeometryProbe = state;
  if (state.compareDom) addEventListener("serpent:e2e-visible-window", visibleWindowListener);
}

/** Also self-contained so the same actions can be exercised in happy-dom tests. */
export function viewportReportGeometryProbeActionInPage(action: ProbeAction): ViewportGeometrySnapshot | null {
  type ProbeState = {
    originalDescriptor: PropertyDescriptor;
    reads: ViewportGeometrySnapshot["reads"];
    comparisons: ViewportGeometrySnapshot["comparisons"];
    checkpoint: ViewportGeometrySnapshot["checkpoint"];
    lastReport: string[] | null;
    compareDom: boolean;
    visibleWindowListener: EventListener;
  };
  type ProbeGlobal = typeof globalThis & {
    __serpentViewportReportGeometryProbe?: ProbeState;
  };
  const scope = globalThis as ProbeGlobal;
  const state = scope.__serpentViewportReportGeometryProbe;
  if (!state) throw new Error("Viewport geometry probe is not installed.");

  if (action === "dispose") {
    if (state.compareDom) removeEventListener("serpent:e2e-visible-window", state.visibleWindowListener);
    try {
      Object.defineProperty(Element.prototype, "getBoundingClientRect", state.originalDescriptor);
    } finally {
      delete scope.__serpentViewportReportGeometryProbe;
    }
    return null;
  }

  if (action === "reset") {
    Object.assign(state.reads, { total: 0, workspaceCanvas: 0, grid: 0, layoutSlot: 0, card: 0, other: 0 });
    Object.assign(state.comparisons, { events: 0, comparedIds: 0, mismatches: 0, missing: 0, extra: 0, orderOnly: 0 });
    Object.assign(state.checkpoint, {
      referenceCount: 0, reportedCount: 0, checkpointCompared: 0, comparedIds: 0,
      mismatches: 0, missing: 0, extra: 0, orderOnly: 0,
    });
    return null;
  }

  if (action === "checkpoint") {
    Object.assign(state.checkpoint, {
      referenceCount: 0, reportedCount: 0, checkpointCompared: 0, comparedIds: 0,
      mismatches: 0, missing: 0, extra: 0, orderOnly: 0,
    });
    if (state.compareDom && state.lastReport) {
      const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
      const reference: string[] = [];
      if (canvas) {
        const nativeDescriptor = state.originalDescriptor.value as (...args: unknown[]) => DOMRect;
        const nativeCanvasRect = Reflect.apply(nativeDescriptor, canvas, []) as DOMRect;
        const seen = new Set<string>();
        for (const slot of canvas.querySelectorAll<HTMLElement>(
          ".asset-card[data-asset-id], [data-layout-asset-id]",
        )) {
          if (reference.length >= 300) break;
          const rect = Reflect.apply(nativeDescriptor, slot, []) as DOMRect;
          if (rect.bottom <= nativeCanvasRect.top || rect.top >= nativeCanvasRect.bottom) continue;
          const assetId = slot.dataset.assetId ?? slot.dataset.layoutAssetId;
          if (!assetId || assetId.startsWith("__geometry__:") || seen.has(assetId)) continue;
          seen.add(assetId);
          reference.push(assetId);
        }
      }
      const expectedOccurrences = new Map<string, number>();
      const actualOccurrences = new Map<string, number>();
      let missing = 0;
      let extra = 0;
      for (const id of state.lastReport) actualOccurrences.set(id, (actualOccurrences.get(id) ?? 0) + 1);
      for (const id of reference) expectedOccurrences.set(id, (expectedOccurrences.get(id) ?? 0) + 1);
      state.checkpoint.referenceCount = reference.length;
      state.checkpoint.reportedCount = state.lastReport.length;
      state.checkpoint.checkpointCompared = 1;
      state.checkpoint.comparedIds = Math.max(reference.length, state.lastReport.length);
      for (const [id, count] of expectedOccurrences) {
        missing += Math.max(0, count - (actualOccurrences.get(id) ?? 0));
      }
      for (const [id, count] of actualOccurrences) {
        extra += Math.max(0, count - (expectedOccurrences.get(id) ?? 0));
      }
      state.checkpoint.missing = missing;
      state.checkpoint.extra = extra;
      const sameOrder = reference.length === state.lastReport.length
        && reference.every((id, index) => id === state.lastReport?.[index]);
      if (!sameOrder) {
        state.checkpoint.mismatches = 1;
        if (missing === 0 && extra === 0) state.checkpoint.orderOnly = 1;
      }
    }
    return {
      reads: { ...state.reads },
      comparisons: { ...state.comparisons },
      checkpoint: { ...state.checkpoint },
      pageErrors: 0,
    };
  }

  return {
    reads: { ...state.reads },
    comparisons: { ...state.comparisons },
    checkpoint: { ...state.checkpoint },
    pageErrors: 0,
  };
}

/** Counts only; the probe never returns asset IDs, paths, names, content, or URLs. */
export async function installViewportReportGeometryProbe(
  page: Page,
  options: { compareDom?: boolean } = {},
): Promise<ViewportReportGeometryProbe> {
  let pageErrors = 0;
  let disposed = false;
  const onPageError = () => { pageErrors += 1; };
  page.on("pageerror", onPageError);
  try {
    await page.evaluate(installViewportReportGeometryProbeInPage, options);
  } catch (error) {
    page.off("pageerror", onPageError);
    throw error;
  }

  const assertActive = () => {
    if (disposed) throw new Error("Viewport geometry probe has been disposed.");
  };
  const runAction = async (action: ProbeAction) => {
    assertActive();
    return page.evaluate(viewportReportGeometryProbeActionInPage, action);
  };
  return {
    async reset(): Promise<void> {
      await runAction("reset");
    },
    async read(): Promise<ViewportGeometrySnapshot> {
      const snapshot = await runAction("read");
      if (!snapshot) throw new Error("Viewport geometry probe returned no snapshot.");
      return { ...snapshot, pageErrors };
    },
    async checkpoint(): Promise<ViewportGeometrySnapshot["checkpoint"]> {
      const snapshot = await runAction("checkpoint");
      if (!snapshot) throw new Error("Viewport geometry checkpoint returned no snapshot.");
      return snapshot.checkpoint;
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      try {
        await page.evaluate<ViewportGeometrySnapshot | null, ProbeAction>(viewportReportGeometryProbeActionInPage, "dispose");
      } finally {
        page.off("pageerror", onPageError);
        disposed = true;
      }
      if (pageErrors > 0) {
        throw new Error(`Viewport geometry probe observed ${pageErrors} renderer page error(s).`);
      }
    },
  };
}
