import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

import {
  electronLaunchEnv,
  resolveElectronExecutablePath,
} from "./electron-test-helpers";

const fixturePath = process.env.SERPENT_LARGE_LIBRARY_E2E_PATH;
const defaultJumpFractions = [
  0.11, 0.83, 0.37, 0.69, 0.22, 0.77, 0.46, 0.61, 0.15, 0.54,
];
const jumpFractions = (process.env.SERPENT_LARGE_LIBRARY_E2E_JUMPS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0)
  .map((value) => Number(value))
  .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
const effectiveJumpFractions = jumpFractions.length > 0 ? jumpFractions : defaultJumpFractions;
const targetMs = 500;
const observationTimeoutMs = Number(
  process.env.SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS ?? 5_000,
);

test.describe.configure({ timeout: 300_000 });

test.skip(!fixturePath, "Set SERPENT_LARGE_LIBRARY_E2E_PATH to a generated 10k+ fixture.");

test("fourth-stop random scrollbar jumps decode the visible viewport within 500ms", async () => {
  if (!fixturePath) throw new Error("Missing large-library fixture path.");
  const manifestPath = path.join(fixturePath, ".serpent", "large-library-fixture.json");
  if (!existsSync(manifestPath)) throw new Error(`Missing fixture manifest: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    assetCount: number;
    version: number;
  };
  expect(manifest.assetCount).toBeGreaterThanOrEqual(10_000);

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-large-scroll-benchmark-"));
  const libraryPath = path.join(temporaryRoot, "benchmark-library");
  const userDataPath = path.join(temporaryRoot, "user-data");
  // APFS clone keeps each run isolated from background jobs/cache writes while
  // avoiding a physical copy of the multi-gigabyte source fixture.
  execFileSync("cp", ["-cR", fixturePath, libraryPath]);

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: electronLaunchEnv({
      SERPENT_E2E: "1",
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_USER_DATA_PATH: userDataPath,
    }),
  });

  try {
    const window = await application.firstWindow();
    await window.setViewportSize({ width: 1440, height: 1000 });
    const openLibrary = window.getByRole("button", {
      exact: true,
      name: "打开资源库",
    });
    await expect(openLibrary).toBeVisible({ timeout: 30_000 });
    await openLibrary.click();
    const canvas = window.locator(".workspace-canvas");
    await expect(canvas).toBeVisible({ timeout: 120_000 });
    await expect(window.locator(".asset-card").first()).toBeVisible({ timeout: 120_000 });

    const sizeControl = window.getByLabel("资产缩略图大小");
    const maxSizeIndex = Number(await sizeControl.getAttribute("max"));
    expect(maxSizeIndex).toBeGreaterThanOrEqual(3);
    await sizeControl.fill("3");
    await expect(sizeControl).toHaveValue("3");
    await window.getByRole("button", { name: "瀑布流视图" }).click();
    await expect(window.locator(".asset-grid")).toHaveClass(/is-masonry/);
    await expect.poll(
      () => canvas.evaluate((element) => element.scrollHeight),
      { timeout: 30_000 },
    ).toBeGreaterThan(100_000);
    await expect.poll(
      () => window.evaluate(() => {
        const canvasElement = document.querySelector<HTMLElement>(".workspace-canvas");
        if (!canvasElement) return false;
        const canvasRect = canvasElement.getBoundingClientRect();
        const visibleLayoutIds = [
          ...document.querySelectorAll<HTMLElement>("[data-layout-asset-id]"),
        ].filter((slot) => {
          const rect = slot.getBoundingClientRect();
          return rect.bottom > canvasRect.top
            && rect.top < canvasRect.bottom
            && rect.right > canvasRect.left
            && rect.left < canvasRect.right;
        }).map((slot) => slot.dataset.layoutAssetId ?? "");
        const cards = [...document.querySelectorAll<HTMLElement>(".asset-card")]
          .filter((card) => {
            const rect = card.getBoundingClientRect();
            return rect.bottom > canvasRect.top && rect.top < canvasRect.bottom;
          });
        const cardIds = new Set(cards.map((card) => card.dataset.assetId ?? ""));
        return visibleLayoutIds.length >= 4
          && visibleLayoutIds.every((assetId) => cardIds.has(assetId));
      }),
      { timeout: 30_000 },
    ).toBe(true);
    await window.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await window.evaluate(() => {
      const root = globalThis as typeof globalThis & {
        __serpentBrowsePages?: unknown[];
        __serpentLongTasks?: number[];
      };
      root.__serpentBrowsePages = [];
      root.__serpentLongTasks = [];
      if ("PerformanceObserver" in globalThis) {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            root.__serpentLongTasks!.push(entry.duration);
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      }
      const capture = ((event: CustomEvent) => {
        root.__serpentBrowsePages!.push(event.detail);
      }) as EventListener;
      globalThis.addEventListener("serpent:e2e-browse-page", capture);
      globalThis.addEventListener("serpent:e2e-browse-result", capture);
    });

    const samples: Array<{
      fraction: number;
      elapsedMs: number;
      visibleCards: number;
      decodedImages: number;
      placeholders: number;
      defaultIcons: number;
      visibleAssetIds: string[];
      visibleLayoutAssetIds: string[];
      visibleLayoutRanks: number[];
      searchRequestsBefore: number;
      searchRequestsAfter: number;
      pageEvents: unknown[];
      requestOffsets: number[];
      requestWaveCount: number;
      longTaskCount: number;
      longTaskMaxMs: number;
      imageStates: Array<{
        assetId: string;
        layoutPreview: boolean;
        src: string;
        complete: boolean;
        naturalWidth: number;
        naturalHeight: number;
      }>;
      timedOut: boolean;
    }> = [];

    for (const fraction of effectiveJumpFractions) {
      const sample = await window.evaluate(
        async ({ fraction: targetFraction, timeoutMs }) => {
          const canvasElement = document.querySelector<HTMLElement>(".workspace-canvas");
          if (!canvasElement) throw new Error("Missing workspace canvas.");
          const diagnostics = (globalThis as unknown as {
            serpent: { e2e: { getRequestCount: (type: "asset.search.request") => number } };
          }).serpent.e2e;
          const searchRequestsBefore = diagnostics.getRequestCount("asset.search.request");
          const eventRoot = globalThis as typeof globalThis & {
            __serpentBrowsePages?: unknown[];
            __serpentLongTasks?: number[];
          };
          eventRoot.__serpentBrowsePages = [];
          const startedAt = performance.now();
          const maxScroll = Math.max(0, canvasElement.scrollHeight - canvasElement.clientHeight);
          canvasElement.scrollTop = maxScroll * targetFraction;

          return await new Promise<{
            fraction: number;
            elapsedMs: number;
            visibleCards: number;
            decodedImages: number;
            placeholders: number;
            defaultIcons: number;
            visibleAssetIds: string[];
            visibleLayoutAssetIds: string[];
            visibleLayoutRanks: number[];
            searchRequestsBefore: number;
            searchRequestsAfter: number;
            pageEvents: unknown[];
            requestOffsets: number[];
            requestWaveCount: number;
            longTaskCount: number;
            longTaskMaxMs: number;
            imageStates: Array<{
              assetId: string;
              layoutPreview: boolean;
              src: string;
              complete: boolean;
              naturalWidth: number;
              naturalHeight: number;
            }>;
            timedOut: boolean;
          }>((resolve) => {
            const inspect = () => {
              const canvasRect = canvasElement.getBoundingClientRect();
              const visible = [...document.querySelectorAll<HTMLElement>(".asset-card")]
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
              const decodedImages = visible.filter((card) => {
                const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
                return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
              }).length;
              const defaultIcons = visible.filter((card) =>
                !card.classList.contains("is-browse-placeholder")
                && !card.querySelector("img.asset-thumbnail"),
              ).length;
              const elapsedMs = performance.now() - startedAt;
              const visibleLayoutAssetIds = [
                ...document.querySelectorAll<HTMLElement>("[data-layout-asset-id]"),
              ].filter((slot) => {
                const rect = slot.getBoundingClientRect();
                return rect.bottom > canvasRect.top
                  && rect.top < canvasRect.bottom
                  && rect.right > canvasRect.left
                  && rect.left < canvasRect.right;
              }).map((slot) => slot.dataset.layoutAssetId ?? "");
              const visibleLayoutRanks = [
                ...document.querySelectorAll<HTMLElement>("[data-layout-rank]"),
              ].filter((slot) => {
                const rect = slot.getBoundingClientRect();
                return rect.bottom > canvasRect.top
                  && rect.top < canvasRect.bottom
                  && rect.right > canvasRect.left
                  && rect.left < canvasRect.right;
              }).map((slot) => Number(slot.dataset.layoutRank));
              const visibleAssetIds = visible.map(
                (card) => card.dataset.assetId ?? "",
              );
              const imageStates = visible.slice(0, 32).map((card) => {
                const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
                return {
                  assetId: card.dataset.assetId ?? "",
                  layoutPreview: card.classList.contains("is-layout-preview"),
                  src: image?.currentSrc || image?.src || "",
                  complete: image?.complete ?? false,
                  naturalWidth: image?.naturalWidth ?? 0,
                  naturalHeight: image?.naturalHeight ?? 0,
                };
              });
              const pageEvents = eventRoot.__serpentBrowsePages ?? [];
              const requestOffsets = pageEvents.flatMap((event) => {
                if (
                  typeof event !== "object"
                  || event === null
                  || !("requestOffset" in event)
                  || "resultOffset" in event
                  || typeof event.requestOffset !== "number"
                ) {
                  return [];
                }
                return [event.requestOffset];
              });
              const loadedIds = new Set(visibleAssetIds);
              const done = visibleLayoutAssetIds.length >= 4
                && visibleLayoutAssetIds.every((assetId) => loadedIds.has(assetId))
                && placeholders === 0
                && defaultIcons === 0
                && decodedImages === visible.length;
              if (done || elapsedMs >= timeoutMs) {
                resolve({
                  fraction: targetFraction,
                  elapsedMs,
                  visibleCards: visible.length,
                  decodedImages,
                  placeholders,
                  defaultIcons,
                  visibleAssetIds,
                  visibleLayoutAssetIds,
                  visibleLayoutRanks,
                  searchRequestsBefore,
                  searchRequestsAfter: diagnostics.getRequestCount("asset.search.request"),
                  pageEvents,
                  requestOffsets,
                  requestWaveCount: requestOffsets.length,
                  longTaskCount: eventRoot.__serpentLongTasks?.length ?? 0,
                  longTaskMaxMs: Math.max(0, ...(eventRoot.__serpentLongTasks ?? [])),
                  imageStates,
                  timedOut: !done,
                });
                return;
              }
              requestAnimationFrame(inspect);
            };
            requestAnimationFrame(inspect);
          });
        },
        { fraction, timeoutMs: observationTimeoutMs },
      );
      samples.push(sample);
    }

    const elapsed = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
    const p50 = elapsed[Math.floor(elapsed.length * 0.5)]!;
    const p95 = elapsed[Math.min(elapsed.length - 1, Math.ceil(elapsed.length * 0.95) - 1)]!;
    const result = {
      suite: "large-library-electron-scroll",
      fixtureVersion: manifest.version,
      assets: manifest.assetCount,
      cardSizeIndex: 3,
      jumps: samples.length,
      targetMs,
      passed: samples.filter((sample) => !sample.timedOut && sample.elapsedMs <= targetMs).length,
      p50Ms: Number(p50.toFixed(1)),
      p95Ms: Number(p95.toFixed(1)),
      maxMs: Number(Math.max(...elapsed).toFixed(1)),
      observationTimeoutMs,
      samples: samples.map((sample) => ({
        ...sample,
        elapsedMs: Number(sample.elapsedMs.toFixed(1)),
      })),
    };
    console.info(`[large-library-benchmark] ${JSON.stringify(result)}`);

    expect(result.passed, JSON.stringify(result, null, 2)).toBe(samples.length);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
