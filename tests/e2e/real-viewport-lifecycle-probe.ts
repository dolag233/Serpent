import { expect, type Page } from "@playwright/test";
import type { SerpentLibraryApi } from "../../src/shared/library-api";
import { visibleImageStats, type VisibleImageStats } from "./perf-bench-helpers";

// This probe asserts the still-image viewer surface. GIFs and sequences have
// dedicated canvas players and need their own decoder assertions.
const NATIVE_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png"]);
const PHASE_TIMEOUT_MS = 60_000;

type ViewMode = {
  label: "平铺视图" | "瀑布流视图";
  className: "is-grid" | "is-masonry";
};

type ImageCoverage = Pick<VisibleImageStats,
  "visibleCards" | "imageCards" | "decodedImages" | "coverage">;

function imageCoverage(stats: VisibleImageStats): ImageCoverage {
  return {
    visibleCards: stats.visibleCards,
    imageCards: stats.imageCards,
    decodedImages: stats.decodedImages,
    coverage: Number(stats.coverage.toFixed(3)),
  };
}

/**
 * Checks real bottom scrolling, preview decode/return, and card-size reflow in
 * the already isolated large-library catalog. Durations are Playwright
 * wall-clock upper bounds and include automation/tool overhead.
 */
export async function probeRealViewportLifecycle(page: Page, libraryId: string) {
  const probeStartedAt = Date.now();
  const readNativeCandidates = (assetIds: string[]) => page.evaluate(async ({ targetLibraryId, extensions, candidates }) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const result = await api.listAssets({ libraryId: targetLibraryId, recursive: true, assetIds: candidates });
    if (!result.ok) throw new Error(result.error.code);
    return result.value.flatMap((asset) => {
      const extension = asset.relativeFilePath.split(".").at(-1)?.toLowerCase();
      if (
        asset.availability !== "available" || asset.mediaType !== "image" || asset.sequence ||
        !extension || !extensions.includes(extension)
      ) return [];
      return [{ assetId: asset.assetId, displayName: asset.displayName, extension, sequence: !!asset.sequence }];
    });
  }, { targetLibraryId: libraryId, extensions: [...NATIVE_IMAGE_EXTENSIONS], candidates: assetIds });
  const nativeImages = new Map<string, { assetId: string; displayName: string; extension: string; sequence: boolean }>();
  const inspectedIds = new Set<string>();
  const canvas = page.locator(".workspace-canvas");
  await expect(canvas).toBeVisible({ timeout: PHASE_TIMEOUT_MS });

  const scrollToBottom = async () => canvas.evaluate((element) => {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = maxScrollTop;
    return {
      scrollTop: element.scrollTop,
      maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight),
      clientHeight: element.clientHeight,
    };
  });

  const atBottomWithDecodedImage = async () => {
    await scrollToBottom();
    const [position, stats] = await Promise.all([
      canvas.evaluate((element) => ({
        scrollTop: element.scrollTop,
        maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight),
        clientHeight: element.clientHeight,
      })),
      visibleImageStats(page),
    ]);
    return position.maxScrollTop - position.scrollTop <= Math.max(3, position.clientHeight * 0.02)
      && stats.visibleCards > 0
      && stats.imageCards > 0
      && stats.decodedImages > 0;
  };

  const waitForBottomAndDecode = async () => {
    await expect.poll(atBottomWithDecodedImage, {
      timeout: PHASE_TIMEOUT_MS,
      message: "The active browse view must reach its real bottom and decode a visible image.",
    }).toBe(true);
    const [position, stats] = await Promise.all([
      canvas.evaluate((element) => ({
        scrollTop: element.scrollTop,
        maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight),
        clientHeight: element.clientHeight,
      })),
      visibleImageStats(page),
    ]);
    return {
      atBottom: position.maxScrollTop - position.scrollTop <= Math.max(3, position.clientHeight * 0.02),
      ...imageCoverage(stats),
    };
  };

  const decodedImageIdsInViewport = async () => page.evaluate(() => {
    const canvasElement = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!canvasElement) return [];
    const canvasRect = canvasElement.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".asset-card[data-asset-id]")]
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
        return Boolean(
          card.dataset.mediaType === "image" && card.dataset.assetId &&
          rect.bottom > canvasRect.top && rect.top < canvasRect.bottom &&
          rect.right > canvasRect.left && rect.left < canvasRect.right &&
          image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
        );
      })
      .map((card) => card.dataset.assetId!);
  });

  const modes: ViewMode[] = [
    { label: "平铺视图", className: "is-grid" },
    { label: "瀑布流视图", className: "is-masonry" },
  ];
  const modeResults: Array<{
    mode: ViewMode["label"];
    bottom: { atBottom: boolean } & ImageCoverage;
    candidateScrollProgress: number;
    previewDecoded: boolean;
    returnedNearBottom: boolean;
    returned: ImageCoverage;
    wallClockMs: number;
  }> = [];

  for (const mode of modes) {
    const modeStartedAt = Date.now();
    const modeButton = page.getByRole("button", { name: mode.label, exact: true });
    await modeButton.click();
    await expect(modeButton).toHaveAttribute("aria-pressed", "true", { timeout: PHASE_TIMEOUT_MS });
    await expect(page.locator(".asset-grid")).toHaveClass(new RegExp(mode.className), {
      timeout: PHASE_TIMEOUT_MS,
    });
    const bottom = await waitForBottomAndDecode();
    let candidateId: string | undefined;
    let candidateScrollProgress = 0;
    for (let step = 0; step <= 8 && !candidateId; step += 1) {
      candidateScrollProgress = await canvas.evaluate((element, index) => {
        const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
        element.scrollTop = maxScrollTop * Math.max(0.98, 1 - index * 0.0025);
        const actualMaxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
        return actualMaxScrollTop <= 0 ? 1 : element.scrollTop / actualMaxScrollTop;
      }, step);
      if (candidateScrollProgress < 0.98) continue;
      try {
        await expect.poll(async () => {
          const decodedIds = await decodedImageIdsInViewport();
          const unknown = decodedIds.filter((id) => !inspectedIds.has(id));
          if (unknown.length > 0) {
            for (const asset of await readNativeCandidates(unknown)) nativeImages.set(asset.assetId, asset);
            for (const id of unknown) inspectedIds.add(id);
          }
          candidateId = decodedIds.find((assetId) => nativeImages.has(assetId));
          return Boolean(candidateId);
        }, {
          timeout: 5_000,
          message: "A decoded native raster card must appear in the bottom viewport band.",
        }).toBe(true);
        candidateScrollProgress = await canvas.evaluate((element) => {
          const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
          return maxScrollTop <= 0 ? 1 : element.scrollTop / maxScrollTop;
        });
        if (candidateScrollProgress < 0.98) candidateId = undefined;
      } catch {
        candidateId = undefined;
      }
    }
    if (!candidateId) {
      throw new Error(`No decoded native image card was visible at or below 98% scroll progress in ${mode.label}.`);
    }
    const candidate = nativeImages.get(candidateId);
    if (!candidate) throw new Error("The selected native image was not in the library snapshot.");

    const card = page.locator(`.asset-card[data-asset-id="${candidateId}"]`);
    await expect(card).toBeVisible({ timeout: PHASE_TIMEOUT_MS });
    await card.dblclick();
    const viewer = page.locator(".workspace-viewer:not(.is-preview-preloading)");
    await expect(viewer).toBeVisible({ timeout: PHASE_TIMEOUT_MS });
    let viewerState: Record<string, unknown> = {};
    await expect.poll(async () => {
      const label = await viewer.getAttribute("aria-label");
      const decoded = await viewer.locator("img.preview-image:not(.is-hidden)").evaluateAll((images) =>
        images.some((image) => {
          const element = image as HTMLImageElement;
          return element.complete && element.naturalWidth > 0 && element.naturalHeight > 0;
        }),
      );
      viewerState = { extension: candidate.extension, sequence: candidate.sequence,
        labelMatches: label?.includes(candidate.displayName) === true, decoded,
        imageCount: await viewer.locator("img.preview-image").count(),
        visibleImageCount: await viewer.locator("img.preview-image:not(.is-hidden)").count(),
        canvasCount: await viewer.locator("canvas").count(), videoCount: await viewer.locator("video").count() };
      return viewerState.labelMatches === true && decoded;
    }, {
      timeout: PHASE_TIMEOUT_MS,
      message: "The selected native image must open in the viewer and decode to nonzero pixels.",
    }).toBe(true).catch((error) => {
      console.log("viewport lifecycle viewer diagnostic:", JSON.stringify(viewerState));
      throw error;
    });
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0, { timeout: PHASE_TIMEOUT_MS });

    const returnedNearBottom = async () => page.evaluate((expectedModeClass) => {
      const canvasElement = document.querySelector<HTMLElement>(".workspace-canvas");
      const grid = document.querySelector<HTMLElement>(".asset-grid");
      if (!canvasElement || !grid?.classList.contains(expectedModeClass)) return false;
      const maxScrollTop = Math.max(0, canvasElement.scrollHeight - canvasElement.clientHeight);
      const progress = maxScrollTop <= 0 ? 1 : canvasElement.scrollTop / maxScrollTop;
      return progress >= 0.98;
    }, mode.className);
    await expect.poll(async () => {
      const [nearBottom, stats] = await Promise.all([
        returnedNearBottom(),
        visibleImageStats(page),
      ]);
      return nearBottom && stats.visibleCards > 0 && stats.imageCards > 0 &&
        stats.decodedImages > 0 && stats.coverage >= 0.9;
    }, {
      timeout: PHASE_TIMEOUT_MS,
      message: "Closing the viewer must restore the bottom viewport with decoded visible cards.",
    }).toBe(true);
    const [returnedNearBottomValue, returnedStats] = await Promise.all([
      returnedNearBottom(),
      visibleImageStats(page),
    ]);
    const returned = imageCoverage(returnedStats);
    modeResults.push({
      mode: mode.label,
      bottom,
      candidateScrollProgress: Number(candidateScrollProgress.toFixed(4)),
      previewDecoded: true,
      returnedNearBottom: returnedNearBottomValue,
      returned,
      wallClockMs: Date.now() - modeStartedAt,
    });
  }

  const sizeControl = page.getByLabel("资产缩略图大小");
  const min = Number(await sizeControl.getAttribute("min"));
  const max = Number(await sizeControl.getAttribute("max"));
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    throw new Error("The real thumbnail-size control does not expose two distinct valid stops.");
  }
  await sizeControl.fill(String(max));
  await expect(sizeControl).toHaveValue(String(max), { timeout: PHASE_TIMEOUT_MS });
  await expect(canvas).not.toHaveClass(/is-reflow-restoring/, { timeout: PHASE_TIMEOUT_MS });
  await expect.poll(atBottomWithDecodedImage, {
    timeout: PHASE_TIMEOUT_MS,
    message: "The large-card view must reach bottom before measuring its extent.",
  }).toBe(true);
  const extentBefore = await canvas.evaluate((element) => ({
    extent: Math.max(0, element.scrollHeight - element.clientHeight),
    viewport: element.clientHeight,
  }));
  if (extentBefore.extent <= extentBefore.viewport || extentBefore.extent <= 10_000) {
    throw new Error("The large-library canvas extent is too small for this lifecycle check.");
  }

  const resizeStartedAt = Date.now();
  await sizeControl.fill(String(min));
  await expect(sizeControl).toHaveValue(String(min), { timeout: PHASE_TIMEOUT_MS });
  await expect(canvas).not.toHaveClass(/is-reflow-restoring/, { timeout: PHASE_TIMEOUT_MS });
  await expect.poll(async () => canvas.evaluate((element) =>
    Math.max(0, element.scrollHeight - element.clientHeight)), {
    timeout: PHASE_TIMEOUT_MS,
    message: "Reducing the card size must shorten the real canvas extent.",
  }).toBeLessThan(extentBefore.extent);
  const extentAfter = await canvas.evaluate((element) => ({
    scrollTop: element.scrollTop,
    extent: Math.max(0, element.scrollHeight - element.clientHeight),
    viewport: element.clientHeight,
  }));
  expect(extentAfter.extent).toBeGreaterThan(extentAfter.viewport);
  expect(extentAfter.extent).toBeGreaterThan(10_000);
  expect(extentAfter.scrollTop).toBeGreaterThanOrEqual(0);
  expect(extentAfter.scrollTop).toBeLessThanOrEqual(extentAfter.extent + 1);
  // Observe the position reached by the product's restore, before any test
  // scroll can conceal a stale virtual window or an unwanted return to top.
  await expect.poll(async () => {
    const stats = await visibleImageStats(page);
    return stats.visibleCards > 0 && stats.imageCards > 0 && stats.decodedImages > 0 && stats.coverage >= 0.9;
  }, { timeout: PHASE_TIMEOUT_MS, message: "Card-size reflow must reveal its natural viewport without a test scroll." }).toBe(true);
  const naturalProgress = await canvas.evaluate((element) =>
    element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight));
  expect(naturalProgress).toBeGreaterThanOrEqual(0.98);
  const resizedBottom = { atBottom: naturalProgress >= 0.98, ...imageCoverage(await visibleImageStats(page)) };
  const resize = {
    fromIndex: max,
    toIndex: min,
    extentBeforePx: extentBefore.extent,
    extentAfterPx: extentAfter.extent,
    scrollTopLegal: true,
    bottom: resizedBottom,
    wallClockMs: Date.now() - resizeStartedAt,
  };

  return {
    modes: modeResults,
    resize,
    wallClockMs: Date.now() - probeStartedAt,
  };
}
