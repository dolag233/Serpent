import type { Page } from "@playwright/test";

export type LibraryLifecyclePaintProbeSummary = {
  measurement: "DOM-ready-and-decoded-on-RAF";
  status: "observed" | "unobserved";
  targetIdentityReady: boolean;
  targetCardObserved: boolean;
  firstDecodedObserved: boolean;
  ninetyPercentDecodedObserved: boolean;
  identityReadyMs: number | null;
  firstTargetCardMs: number | null;
  firstDecodedMs: number | null;
  ninetyPercentDecodedMs: number | null;
  actionCompletedMs: number | null;
  sampleCount: number;
  visibleTargetCards: number | null;
  visibleImageCards: number | null;
  unexpectedVisibleImageCards: number | null;
  decodedImages: number | null;
  coverage: number | null;
};

type ProbeStartOptions = {
  targetLibraryName: string;
  expectedAssetIds: readonly string[];
};

export type LibraryLifecyclePaintProbe = {
  start(options: ProbeStartOptions): Promise<void>;
  markActionCompleted(): Promise<number | null>;
  read(): Promise<LibraryLifecyclePaintProbeSummary>;
  stop(): Promise<LibraryLifecyclePaintProbeSummary>;
};

type PageProbe = {
  start(options: ProbeStartOptions): void;
  markActionCompleted(): number | null;
  read(): LibraryLifecyclePaintProbeSummary;
  flushPendingSample(): Promise<void>;
  stop(): Promise<LibraryLifecyclePaintProbeSummary>;
  dispose(): void;
};

type ProbeHost = Window & { __serpentLibraryLifecyclePaintProbe?: PageProbe };

/** Install an event-driven renderer probe. It records DOM/decode observations, not compositor paint. */
export async function installLibraryLifecyclePaintProbe(page: Page): Promise<LibraryLifecyclePaintProbe> {
  await page.evaluate(installPageProbe);
  let stopped = false;
  return {
    async start(options) {
      if (stopped) throw new Error("Library lifecycle paint probe is stopped.");
      await page.evaluate((input) => {
        const probe = (window as ProbeHost).__serpentLibraryLifecyclePaintProbe;
        if (!probe) throw new Error("Library lifecycle paint probe is unavailable.");
        probe.start(input);
      }, { targetLibraryName: options.targetLibraryName, expectedAssetIds: [...options.expectedAssetIds] });
    },
    async markActionCompleted() {
      if (stopped) throw new Error("Library lifecycle paint probe is stopped.");
      return page.evaluate(() => {
        const probe = (window as ProbeHost).__serpentLibraryLifecyclePaintProbe;
        if (!probe) throw new Error("Library lifecycle paint probe is unavailable.");
        return probe.markActionCompleted();
      });
    },
    async read() {
      if (stopped) throw new Error("Library lifecycle paint probe is stopped.");
      return page.evaluate(async () => {
        const probe = (window as ProbeHost).__serpentLibraryLifecyclePaintProbe;
        if (!probe) throw new Error("Library lifecycle paint probe is unavailable.");
        await probe.flushPendingSample();
        return probe.read();
      });
    },
    async stop() {
      if (stopped) throw new Error("Library lifecycle paint probe is stopped.");
      stopped = true;
      return page.evaluate(async () => {
        const host = window as ProbeHost;
        const probe = host.__serpentLibraryLifecyclePaintProbe;
        if (!probe) throw new Error("Library lifecycle paint probe is unavailable.");
        const summary = await probe.stop();
        delete host.__serpentLibraryLifecyclePaintProbe;
        return summary;
      });
    },
  };
}

/** Serialized into the renderer. Do not add references to module-level helpers here. */
function installPageProbe(): void {
  type Summary = LibraryLifecyclePaintProbeSummary;
  type StartOptions = ProbeStartOptions;
  type Probe = PageProbe;
  type Host = ProbeHost;
  const host = window as Host;
  host.__serpentLibraryLifecyclePaintProbe?.dispose();

  let targetLibraryName = "";
  let expectedAssetIds = new Set<string>();
  let startedAt: number | null = null;
  let actionCompletedMs: number | null = null;
  let identityReadyMs: number | null = null;
  let firstTargetCardMs: number | null = null;
  let firstDecodedMs: number | null = null;
  let ninetyPercentDecodedMs: number | null = null;
  let sampleCount = 0;
  let visibleTargetCards: number | null = null;
  let visibleImageCards: number | null = null;
  let unexpectedVisibleImageCards: number | null = null;
  let decodedImages: number | null = null;
  let coverage: number | null = null;
  let observer: MutationObserver | null = null;
  let pendingFrame: number | null = null;
  let cleanupTimer: number | null = null;
  let started = false;
  let disposed = false;
  let finalSummary: Summary | null = null;

  const summary = (): Summary => ({
    measurement: "DOM-ready-and-decoded-on-RAF",
    status: identityReadyMs === null ? "unobserved" : "observed",
    targetIdentityReady: identityReadyMs !== null,
    targetCardObserved: firstTargetCardMs !== null,
    firstDecodedObserved: firstDecodedMs !== null,
    ninetyPercentDecodedObserved: ninetyPercentDecodedMs !== null,
    identityReadyMs,
    firstTargetCardMs,
    firstDecodedMs,
    ninetyPercentDecodedMs,
    actionCompletedMs,
    sampleCount,
    visibleTargetCards,
    visibleImageCards,
    unexpectedVisibleImageCards,
    decodedImages,
    coverage,
  });
  const elapsed = (): number | null => startedAt === null
    ? null
    : Math.max(0, Number((performance.now() - startedAt).toFixed(2)));
  const targetIdentityIsReady = (): boolean => {
    const trigger = document.querySelector<HTMLElement>(".library-switcher-trigger");
    const name = trigger?.querySelector<HTMLElement>(".library-switcher-name")?.textContent?.trim();
    return name === targetLibraryName;
  };
  const sample = (): void => {
    if (!started || disposed || startedAt === null) return;
    sampleCount += 1;
    const now = elapsed();
    if (now === null) return;
    const identityReady = targetIdentityIsReady();
    if (identityReady && identityReadyMs === null) identityReadyMs = now;
    if (!identityReady) return;

    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!canvas) return;
    const allCards = [...canvas.querySelectorAll<HTMLElement>(
      ".asset-card[data-asset-id]:not(.is-layout-preview)",
    )];
    const targetCards = allCards.filter((card) => expectedAssetIds.has(card.dataset.assetId ?? ""));
    if (targetCards.length > 0 && firstTargetCardMs === null) firstTargetCardMs = now;

    const canvasRect = canvas.getBoundingClientRect();
    const visibleCards = allCards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.bottom > canvasRect.top
        && rect.top < canvasRect.bottom
        && rect.right > canvasRect.left
        && rect.left < canvasRect.right;
    });
    const imageCards = visibleCards.filter((card) => card.dataset.mediaType === "image");
    const targetImageCards = imageCards.filter((card) => expectedAssetIds.has(card.dataset.assetId ?? ""));
    const unexpectedImageCount = imageCards.length - targetImageCards.length;
    const decodedCount = targetImageCards.filter((card) => {
      const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
      return image?.complete === true && image.naturalWidth > 0 && image.naturalHeight > 0;
    }).length;
    visibleTargetCards = visibleCards.filter((card) => expectedAssetIds.has(card.dataset.assetId ?? "")).length;
    visibleImageCards = imageCards.length;
    unexpectedVisibleImageCards = unexpectedImageCount;
    decodedImages = decodedCount;
    coverage = imageCards.length === 0 || unexpectedImageCount > 0 ? null : decodedCount / imageCards.length;
    if (decodedCount > 0 && firstDecodedMs === null) firstDecodedMs = now;
    if (imageCards.length > 0 && unexpectedImageCount === 0
      && decodedCount / imageCards.length >= 0.9 && ninetyPercentDecodedMs === null) {
      ninetyPercentDecodedMs = now;
    }
  };
  const scheduleSample = (): void => {
    if (!started || disposed || pendingFrame !== null) return;
    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = null;
      sample();
    });
  };
  const onImageLoadOrError = (event: Event): void => {
    if (event.target instanceof HTMLImageElement && event.target.matches("img.asset-thumbnail")) {
      scheduleSample();
    }
  };
  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    observer = null;
    document.removeEventListener("load", onImageLoadOrError, true);
    document.removeEventListener("error", onImageLoadOrError, true);
    if (pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
    if (cleanupTimer !== null) {
      window.clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    expectedAssetIds.clear();
  };
  const probe: Probe = {
    start(input: StartOptions) {
      if (started || disposed) throw new Error("Library lifecycle paint probe cannot be restarted.");
      targetLibraryName = input.targetLibraryName;
      expectedAssetIds = new Set(input.expectedAssetIds);
      started = true;
      // All measurements use this renderer-local marker; no Node/browser clock subtraction.
      startedAt = performance.now();
      observer = new MutationObserver(() => scheduleSample());
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "src", "data-asset-id", "data-media-type"],
      });
      document.addEventListener("load", onImageLoadOrError, true);
      document.addEventListener("error", onImageLoadOrError, true);
      // A timeout exists only to guarantee observer/listener cleanup; it never samples.
      cleanupTimer = window.setTimeout(cleanup, 70_000);
      sample();
    },
    markActionCompleted() {
      if (!started || disposed || startedAt === null) return null;
      actionCompletedMs ??= elapsed();
      return actionCompletedMs;
    },
    read() {
      return finalSummary ?? summary();
    },
    async flushPendingSample() {
      if (pendingFrame === null || disposed) return;
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    },
    async stop() {
      if (finalSummary !== null) return finalSummary;
      await probe.flushPendingSample();
      finalSummary = summary();
      cleanup();
      return finalSummary;
    },
    dispose() {
      cleanup();
    },
  };
  host.__serpentLibraryLifecyclePaintProbe = probe;
}
