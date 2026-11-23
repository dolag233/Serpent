import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import type { SerpentLibraryApi } from "../../src/shared/library-api";
import {
  installLocalInteractionClock,
  type LocalInteractionClock,
  type LocalInteractionMeasurement,
  type LocalInteractionMode,
  type LocalInteractionTarget,
} from "./folder-interaction-clock";
import {
  readRendererProbe,
  resetRendererCounters,
  visibleImageStats,
} from "./perf-bench-helpers";

const ALL_ASSETS_LABEL = "所有资产";
const CREATE_FOLDER_LABEL = "添加文件夹";
const DECODE_TIMEOUT_MS = 120_000;
const TAIL_OBSERVATION_MS = 3_000;
const MAX_REPETITIONS = 6;

type QueueSummary = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  paused: number;
  cancelled: number;
  queuePaused?: boolean;
};

export type FolderInteractionProbeRound = {
  submitEpochMs: number;
  createVisibleMs: number;
  folderClickEpochMs: number;
  folderActiveMs: number;
  emptyCanvasMs: number;
  emptyAssetNodes: number;
  allAssetsClickEpochMs: number;
  allAssetsActiveMs: number;
  firstDecodedMs: number;
  ninetyPercentDecodedMs: number;
  tail: {
    observedMs: number;
    samples: number;
    minimumCoverage: number;
    minimumImageCards: number;
    maximumDecodedImages: number;
  };
  visibleImagesAfterTail: Awaited<ReturnType<typeof visibleImageStats>>;
  queueBefore: QueueSummary;
  queueAfter: QueueSummary;
  rendererTiming: {
    createEventSeen: boolean;
    inputToDomMs: number | null;
    inputToPaintMs: number | null;
    folderClickEventSeen: boolean;
    folderClickToActiveDomMs: number | null;
    folderClickToActivePaintMs: number | null;
    folderClickToEmptyDomMs: number | null;
    folderClickToEmptyPaintMs: number | null;
    allAssetsClickEventSeen: boolean;
    allAssetsClickToActiveDomMs: number | null;
    allAssetsClickToActivePaintMs: number | null;
    allAssetsClickToFirstDecodedMs: number | null;
    allAssetsClickToNinetyPercentDecodedMs: number | null;
  };
  renderer: {
    create: Awaited<ReturnType<typeof readRendererProbe>>;
    folderBrowse: Awaited<ReturnType<typeof readRendererProbe>>;
    allAssetsBrowse: Awaited<ReturnType<typeof readRendererProbe>>;
  };
};

export type FolderInteractionProbeResult = {
  repetitions: number;
  rounds: FolderInteractionProbeRound[];
};

/**
 * Measures managed-folder creation and navigation while linked-media jobs
 * continue normally. The empty folder is a scope barrier: its active row and
 * empty canvas are observed before returning to the populated asset scope, so
 * decoded images from a previous view cannot satisfy the next round.
 */
export async function probeFolderInteractions(
  page: Page,
  options: { libraryId: string; repetitions?: number },
): Promise<FolderInteractionProbeResult> {
  const requested = Number.isFinite(options.repetitions)
    ? Math.trunc(options.repetitions ?? 3)
    : 3;
  const repetitions = Math.max(3, Math.min(MAX_REPETITIONS, requested));
  const rounds: FolderInteractionProbeRound[] = [];

  await page.evaluate(installLocalInteractionClock);
  try {
    for (let index = 0; index < repetitions; index += 1) {
      const queueBefore = await readQueueSummary(page, options.libraryId);
      const allAssetsRow = page.getByRole("button", {
        name: ALL_ASSETS_LABEL,
        exact: true,
      });
      await expect(allAssetsRow).toBeVisible({ timeout: 30_000 });
      await allAssetsRow.click();
      await waitForAllAssetsActive(page);

      await resetRendererCounters(page);
      await page
        .getByRole("button", { name: CREATE_FOLDER_LABEL, exact: true })
        .click();
      const input = page.locator(".nav-inline-edit input");
      await expect(input).toBeVisible({ timeout: 10_000 });
      const folderName = `__nav_interaction_probe_${randomUUID().slice(0, 12)}_${index + 1}`;
      await input.fill(folderName);
      const createMarker = await armLocalMarker(page, "create", { folderName });

      const submitEpochMs = Date.now();
      await input.press("Enter");
      const folderRow = page
        .locator(
          '.navigation-pane button.nav-row[data-nav-folder-kind="managed"]',
        )
        .filter({ hasText: folderName });
      const folderLabel = folderRow.locator(".nav-row-label");
      await expect(folderRow).toHaveCount(1, { timeout: DECODE_TIMEOUT_MS });
      await expect(folderLabel).toBeVisible({ timeout: DECODE_TIMEOUT_MS });
      await expect(folderLabel).toHaveText(folderName);
      const folderId = await folderRow.getAttribute("data-nav-folder-id");
      if (!folderId)
        throw new Error(
          "The created managed folder has no navigation identity.",
        );
      const createVisibleMs = Date.now() - submitEpochMs;
      const createLocal = await readLocalMarker(page, createMarker);
      const createRenderer = await readRendererProbe(page);

      await resetRendererCounters(page);
      const folderMarker = await armLocalMarker(page, "folder", { folderId });
      const folderClickEpochMs = Date.now();
      await folderRow.click();
      await expect(folderRow).toHaveClass(/\bis-active\b/, { timeout: 30_000 });
      const folderActiveMs = Date.now() - folderClickEpochMs;
      await expect(
        page.locator(".workspace-canvas .empty-library"),
      ).toBeVisible({
        timeout: DECODE_TIMEOUT_MS,
      });
      const assetNodes = page.locator(".workspace-canvas [data-asset-id]");
      await expect(assetNodes).toHaveCount(0, { timeout: DECODE_TIMEOUT_MS });
      const emptyAssetNodes = await assetNodes.count();
      const emptyCanvasMs = Date.now() - folderClickEpochMs;
      const folderLocal = await readLocalMarker(page, folderMarker);
      const folderBrowseRenderer = await readRendererProbe(page);

      await resetRendererCounters(page);
      const allAssetsMarker = await armLocalMarker(page, "all-assets", {});
      const allAssetsClickEpochMs = Date.now();
      await allAssetsRow.click();
      await waitForAllAssetsActive(page);
      const allAssetsActiveMs = Date.now() - allAssetsClickEpochMs;

      let firstDecodedMs: number | null = null;
      let ninetyPercentDecodedMs: number | null = null;
      let visible = await visibleImageStats(page);
      while (
        Date.now() - allAssetsClickEpochMs < DECODE_TIMEOUT_MS &&
        (firstDecodedMs === null || ninetyPercentDecodedMs === null)
      ) {
        const elapsedMs = Date.now() - allAssetsClickEpochMs;
        if (firstDecodedMs === null && visible.decodedImages > 0) {
          firstDecodedMs = elapsedMs;
        }
        if (
          ninetyPercentDecodedMs === null &&
          visible.imageCards > 0 &&
          visible.coverage >= 0.9
        ) {
          ninetyPercentDecodedMs = elapsedMs;
        }
        if (firstDecodedMs !== null && ninetyPercentDecodedMs !== null) break;
        await page.waitForTimeout(50);
        visible = await visibleImageStats(page);
      }

      expect(
        firstDecodedMs,
        "The current All Assets viewport must decode at least one image.",
      ).not.toBeNull();
      expect(
        ninetyPercentDecodedMs,
        "The current All Assets viewport must reach 90% decoded image coverage.",
      ).not.toBeNull();

      const tailStartedAt = Date.now();
      const tailDeadline = tailStartedAt + TAIL_OBSERVATION_MS;
      let tailSamples = 0;
      let minimumCoverage = 1;
      let minimumImageCards = Number.POSITIVE_INFINITY;
      let maximumDecodedImages = 0;
      while (Date.now() < tailDeadline) {
        visible = await visibleImageStats(page);
        tailSamples += 1;
        minimumCoverage = Math.min(minimumCoverage, visible.coverage);
        minimumImageCards = Math.min(minimumImageCards, visible.imageCards);
        maximumDecodedImages = Math.max(
          maximumDecodedImages,
          visible.decodedImages,
        );
        const remainingMs = tailDeadline - Date.now();
        if (remainingMs > 0)
          await page.waitForTimeout(Math.min(100, remainingMs));
      }
      const tailObservedMs = Date.now() - tailStartedAt;
      const visibleImagesAfterTail = await visibleImageStats(page);
      const allAssetsLocal = await readLocalMarker(page, allAssetsMarker);
      const allAssetsBrowseRenderer = await readRendererProbe(page);
      const queueAfter = await readQueueSummary(page, options.libraryId);

      rounds.push({
        submitEpochMs,
        createVisibleMs,
        folderClickEpochMs,
        folderActiveMs,
        emptyCanvasMs,
        emptyAssetNodes,
        allAssetsClickEpochMs,
        allAssetsActiveMs,
        firstDecodedMs: firstDecodedMs!,
        ninetyPercentDecodedMs: ninetyPercentDecodedMs!,
        tail: {
          observedMs: tailObservedMs,
          samples: tailSamples,
          minimumCoverage: Number(minimumCoverage.toFixed(4)),
          minimumImageCards: Number.isFinite(minimumImageCards)
            ? minimumImageCards
            : 0,
          maximumDecodedImages,
        },
        visibleImagesAfterTail,
        queueBefore,
        queueAfter,
        rendererTiming: {
          createEventSeen: createLocal.eventSeen,
          inputToDomMs: createLocal.inputToDomMs,
          inputToPaintMs: createLocal.inputToPaintMs,
          folderClickEventSeen: folderLocal.eventSeen,
          folderClickToActiveDomMs: folderLocal.clickToActiveDomMs,
          folderClickToActivePaintMs: folderLocal.clickToActivePaintMs,
          folderClickToEmptyDomMs: folderLocal.clickToDomMs,
          folderClickToEmptyPaintMs: folderLocal.clickToPaintMs,
          allAssetsClickEventSeen: allAssetsLocal.eventSeen,
          allAssetsClickToActiveDomMs: allAssetsLocal.clickToActiveDomMs,
          allAssetsClickToActivePaintMs: allAssetsLocal.clickToActivePaintMs,
          allAssetsClickToFirstDecodedMs: allAssetsLocal.clickToFirstDecodedMs,
          allAssetsClickToNinetyPercentDecodedMs:
            allAssetsLocal.clickToNinetyPercentDecodedMs,
        },
        renderer: {
          create: createRenderer,
          folderBrowse: folderBrowseRenderer,
          allAssetsBrowse: allAssetsBrowseRenderer,
        },
      });
    }
  } finally {
    await page
      .evaluate(() => {
        const clock = (
          window as Window & {
            __folderInteractionClock?: LocalInteractionClock;
          }
        ).__folderInteractionClock;
        clock?.dispose();
        delete (
          window as Window & {
            __folderInteractionClock?: LocalInteractionClock;
          }
        ).__folderInteractionClock;
      })
      .catch(() => undefined);
  }

  return { repetitions, rounds };
}

async function waitForAllAssetsActive(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [
            ...document.querySelectorAll<HTMLElement>(
              ".navigation-pane button.nav-row.is-active .nav-row-label",
            ),
          ].some((label) => label.textContent?.trim() === "所有资产"),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function readQueueSummary(
  page: Page,
  libraryId: string,
): Promise<QueueSummary> {
  return page.evaluate(async (activeLibraryId) => {
    const api = (
      globalThis as typeof globalThis & {
        serpent: { library: SerpentLibraryApi };
      }
    ).serpent.library;
    const result = await api.getMediaJobSummary({ libraryId: activeLibraryId });
    if (!result.ok)
      throw new Error("The media queue summary could not be read.");
    const summary = result.value;
    return {
      queued: summary.queued,
      running: summary.running,
      succeeded: summary.succeeded,
      failed: summary.failed,
      paused: summary.paused,
      cancelled: summary.cancelled,
      ...(summary.queuePaused === undefined
        ? {}
        : { queuePaused: summary.queuePaused }),
    };
  }, libraryId);
}

async function armLocalMarker(
  page: Page,
  mode: LocalInteractionMode,
  target: LocalInteractionTarget,
): Promise<number> {
  return page.evaluate(
    ({ activeMode, activeTarget }) => {
      const clock = (
        window as Window & { __folderInteractionClock?: LocalInteractionClock }
      ).__folderInteractionClock;
      if (!clock)
        throw new Error("The renderer interaction clock is unavailable.");
      return clock.arm(activeMode, activeTarget);
    },
    { activeMode: mode, activeTarget: target },
  );
}

async function readLocalMarker(
  page: Page,
  token: number,
): Promise<LocalInteractionMeasurement> {
  const measurement = await page.evaluate(async (activeToken) => {
    const clock = (
      window as Window & { __folderInteractionClock?: LocalInteractionClock }
    ).__folderInteractionClock;
    if (!clock)
      throw new Error("The renderer interaction clock is unavailable.");
    return clock.read(activeToken);
  }, token);
  if (!measurement.eventSeen || measurement.timedOut) {
    throw new Error("The renderer interaction marker did not observe its complete input/render path.");
  }
  return measurement;
}
