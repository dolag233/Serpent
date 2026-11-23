import type { Page } from "@playwright/test";

export const COVER_MUTATION_CATEGORIES = ["source-direct", "preview", "other"] as const;
export type CoverMutationCategory = (typeof COVER_MUTATION_CATEGORIES)[number];
export type CoverMutationWindowName = "quiet" | "native-scroll";

export type CoverMutationCategoryCounts = Record<CoverMutationCategory, number>;
export type CoverMutationNodeSnapshot = {
  total: number;
  byCategory: CoverMutationCategoryCounts;
};
export type CoverMutationWindowSummary = {
  window: CoverMutationWindowName;
  observedMs: number;
  relevantMutationRecords: number;
  inserted: CoverMutationCategoryCounts;
  removed: CoverMutationCategoryCounts;
  srcChanged: CoverMutationCategoryCounts;
  nodes: {
    start: CoverMutationNodeSnapshot;
    peak: CoverMutationNodeSnapshot;
    end: CoverMutationNodeSnapshot;
  };
};

type RawCoverMutationWindow = {
  window: CoverMutationWindowName;
  observedMs: number;
  relevantMutationRecords: number;
  inserted: CoverMutationCategoryCounts;
  removed: CoverMutationCategoryCounts;
  srcChanged: CoverMutationCategoryCounts;
  nodes: {
    start: CoverMutationNodeSnapshot;
    peak: CoverMutationNodeSnapshot;
    end: CoverMutationNodeSnapshot;
  };
};

export type CanvasCoverMutationProbe = {
  beginWindow(window: CoverMutationWindowName): Promise<void>;
  endWindow(window: CoverMutationWindowName): Promise<CoverMutationWindowSummary>;
  dispose(): Promise<void>;
};

/** Classify locally; callers must never retain or report the URL. */
export function classifyCoverMutationUrl(url: string | null): CoverMutationCategory {
  if (url?.startsWith("serpent://source/")) return "source-direct";
  if (url?.startsWith("serpent://preview/")) return "preview";
  return "other";
}

/** Project page data onto an allowlisted numeric summary, dropping extra fields. */
export function summarizeCoverMutationWindow(
  input: RawCoverMutationWindow,
): CoverMutationWindowSummary {
  const count = (value: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const categories = (value: CoverMutationCategoryCounts): CoverMutationCategoryCounts => ({
    "source-direct": count(value["source-direct"]),
    preview: count(value.preview),
    other: count(value.other),
  });
  const nodes = (value: CoverMutationNodeSnapshot): CoverMutationNodeSnapshot => {
    const byCategory = categories(value.byCategory);
    return {
      total: byCategory["source-direct"] + byCategory.preview + byCategory.other,
      byCategory,
    };
  };
  return {
    window: input.window,
    observedMs: count(input.observedMs),
    relevantMutationRecords: count(input.relevantMutationRecords),
    inserted: categories(input.inserted),
    removed: categories(input.removed),
    srcChanged: categories(input.srcChanged),
    nodes: {
      start: nodes(input.nodes.start),
      peak: nodes(input.nodes.peak),
      end: nodes(input.nodes.end),
    },
  };
}

/** Observe static cover-image churn without reading geometry or retaining URLs. */
export async function installCanvasCoverMutationProbe(page: Page): Promise<CanvasCoverMutationProbe> {
  await page.evaluate(installPageCanvasCoverMutationProbe);
  let disposed = false;

  return {
    async beginWindow(windowName) {
      if (disposed) throw new Error("Canvas cover mutation probe is disposed.");
      await page.evaluate((name) => {
        const probe = (window as Window & {
          __serpentCanvasCoverMutationProbe?: PageCoverMutationProbe;
        }).__serpentCanvasCoverMutationProbe;
        if (!probe) throw new Error("Canvas cover mutation probe is unavailable.");
        probe.begin(name);
      }, windowName);
    },
    async endWindow(windowName) {
      if (disposed) throw new Error("Canvas cover mutation probe is disposed.");
      const raw = await page.evaluate((name) => {
        const probe = (window as Window & {
          __serpentCanvasCoverMutationProbe?: PageCoverMutationProbe;
        }).__serpentCanvasCoverMutationProbe;
        if (!probe) throw new Error("Canvas cover mutation probe is unavailable.");
        return probe.end(name);
      }, windowName);
      return summarizeCoverMutationWindow(raw);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await page.evaluate(() => {
        const host = window as Window & {
          __serpentCanvasCoverMutationProbe?: PageCoverMutationProbe;
        };
        host.__serpentCanvasCoverMutationProbe?.dispose();
        delete host.__serpentCanvasCoverMutationProbe;
      }).catch(() => undefined);
    },
  };
}

type PageCoverMutationProbe = {
  begin(windowName: CoverMutationWindowName): void;
  end(windowName: CoverMutationWindowName): RawCoverMutationWindow;
  dispose(): void;
};

/** Serialized into the renderer; every dependency is declared inside this function. */
function installPageCanvasCoverMutationProbe(): void {
  type Category = "source-direct" | "preview" | "other";
  type CategoryCounts = Record<Category, number>;
  type NodeSnapshot = { total: number; byCategory: CategoryCounts };
  type WindowName = "quiet" | "native-scroll";
  type MutableWindow = {
    window: WindowName;
    startedAt: number;
    relevantMutationRecords: number;
    inserted: CategoryCounts;
    removed: CategoryCounts;
    srcChanged: CategoryCounts;
    start: NodeSnapshot;
    peak: NodeSnapshot;
  };
  type RawWindow = {
    window: WindowName;
    observedMs: number;
    relevantMutationRecords: number;
    inserted: CategoryCounts;
    removed: CategoryCounts;
    srcChanged: CategoryCounts;
    nodes: { start: NodeSnapshot; peak: NodeSnapshot; end: NodeSnapshot };
  };
  type Probe = PageCoverMutationProbe;
  type Host = Window & { __serpentCanvasCoverMutationProbe?: Probe };

  const host = window as Host;
  host.__serpentCanvasCoverMutationProbe?.dispose();
  const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
  if (!canvas) throw new Error("Workspace canvas was not found.");
  const categories = (): CategoryCounts => ({ "source-direct": 0, preview: 0, other: 0 });
  const copyCounts = (value: CategoryCounts): CategoryCounts => ({
    "source-direct": value["source-direct"], preview: value.preview, other: value.other,
  });
  const total = (value: CategoryCounts) =>
    value["source-direct"] + value.preview + value.other;
  const snapshot = (value: CategoryCounts): NodeSnapshot => ({
    total: total(value), byCategory: copyCounts(value),
  });
  const classify = (url: string | null): Category => {
    if (url?.startsWith("serpent://source/")) return "source-direct";
    if (url?.startsWith("serpent://preview/")) return "preview";
    return "other";
  };
  const isStaticCover = (image: HTMLImageElement) =>
    image.classList.contains("asset-thumbnail")
    && !image.classList.contains("asset-card-media-live")
    && image.closest(".asset-card") !== null;
  const activeImages = new WeakSet<HTMLImageElement>();
  const imageCategories = new WeakMap<HTMLImageElement, Category>();
  const activeCounts = categories();
  let currentWindow: MutableWindow | null = null;
  const completed = new Set<WindowName>();
  let disposed = false;

  const notePeak = () => {
    if (!currentWindow) return;
    const next = snapshot(activeCounts);
    if (next.total > currentWindow.peak.total) currentWindow.peak = next;
  };
  const collectImages = (node: Node): HTMLImageElement[] => {
    if (!(node instanceof Element)) return [];
    const result: HTMLImageElement[] = [];
    // A removed image has already lost its card ancestor. Membership in the
    // tracked WeakSet, rather than closest(), identifies it in the removal path.
    if (node instanceof HTMLImageElement && node.matches("img.asset-thumbnail:not(.asset-card-media-live)")) {
      result.push(node);
    }
    for (const image of node.querySelectorAll<HTMLImageElement>(
      "img.asset-thumbnail:not(.asset-card-media-live)",
    )) {
      result.push(image);
    }
    return result;
  };
  const record = (key: "inserted" | "removed" | "srcChanged", category: Category) => {
    if (!currentWindow) return;
    currentWindow[key][category] += 1;
  };
  const processRecords = (records: MutationRecord[]) => {
    for (const mutation of records) {
      let relevant = false;
      if (mutation.type === "childList") {
        for (const node of mutation.removedNodes) {
          for (const image of collectImages(node)) {
            if (!activeImages.has(image)) continue;
            const category = imageCategories.get(image) ?? classify(image.getAttribute("src"));
            activeImages.delete(image);
            activeCounts[category] = Math.max(0, activeCounts[category] - 1);
            record("removed", category);
            relevant = true;
          }
        }
        for (const node of mutation.addedNodes) {
          for (const image of collectImages(node)) {
            if (activeImages.has(image) || !canvas.contains(image) || !isStaticCover(image)) continue;
            const category = classify(image.getAttribute("src"));
            activeImages.add(image);
            imageCategories.set(image, category);
            activeCounts[category] += 1;
            record("inserted", category);
            relevant = true;
            notePeak();
          }
        }
      } else if (
        mutation.type === "attributes"
        && mutation.attributeName === "src"
        && mutation.target instanceof HTMLImageElement
        && activeImages.has(mutation.target)
      ) {
        const image = mutation.target;
        const previous = imageCategories.get(image) ?? classify(mutation.oldValue);
        const next = classify(image.getAttribute("src"));
        if (previous !== next) {
          activeCounts[previous] = Math.max(0, activeCounts[previous] - 1);
          activeCounts[next] += 1;
          imageCategories.set(image, next);
        }
        record("srcChanged", next);
        relevant = true;
        notePeak();
      }
      if (relevant && currentWindow) currentWindow.relevantMutationRecords += 1;
    }
  };

  for (const image of canvas.querySelectorAll<HTMLImageElement>(
    "img.asset-thumbnail:not(.asset-card-media-live)",
  )) {
    if (!isStaticCover(image)) continue;
    const category = classify(image.getAttribute("src"));
    activeImages.add(image);
    imageCategories.set(image, category);
    activeCounts[category] += 1;
  }

  const observer = new MutationObserver(processRecords);
  observer.observe(canvas, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["src"],
    attributeOldValue: true,
  });

  const probe: Probe = {
    begin(windowName) {
      if (disposed) throw new Error("Canvas cover mutation probe is disposed.");
      if (currentWindow) throw new Error("A cover mutation window is already active.");
      if (completed.has(windowName)) throw new Error("A cover mutation window cannot be reused.");
      processRecords(observer.takeRecords());
      const start = snapshot(activeCounts);
      currentWindow = {
        window: windowName,
        startedAt: performance.now(),
        relevantMutationRecords: 0,
        inserted: categories(),
        removed: categories(),
        srcChanged: categories(),
        start,
        peak: start,
      };
    },
    end(windowName) {
      if (!currentWindow || currentWindow.window !== windowName) {
        throw new Error("No matching cover mutation window is active.");
      }
      processRecords(observer.takeRecords());
      const observed = categories();
      for (const image of canvas.querySelectorAll<HTMLImageElement>("img.asset-thumbnail:not(.asset-card-media-live)")) {
        if (isStaticCover(image)) observed[classify(image.getAttribute("src"))] += 1;
      }
      if (Object.keys(observed).some(category =>
        observed[category as Category] !== activeCounts[category as Category])) {
        throw new Error("Cover mutation counts diverged from the actual mounted image nodes.");
      }
      const active = currentWindow;
      currentWindow = null;
      completed.add(windowName);
      const end = snapshot(activeCounts);
      const raw: RawWindow = {
        window: active.window,
        observedMs: performance.now() - active.startedAt,
        relevantMutationRecords: active.relevantMutationRecords,
        inserted: active.inserted,
        removed: active.removed,
        srcChanged: active.srcChanged,
        nodes: { start: active.start, peak: active.peak, end },
      };
      return raw;
    },
    dispose() {
      if (disposed) return;
      processRecords(observer.takeRecords());
      currentWindow = null;
      disposed = true;
      observer.disconnect();
    },
  };
  host.__serpentCanvasCoverMutationProbe = probe;
}
