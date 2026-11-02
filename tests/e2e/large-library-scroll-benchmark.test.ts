import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import type { CDPSession } from "@playwright/test";

import {
  electronLaunchEnv,
  resolveElectronExecutablePath,
} from "./electron-test-helpers";
import { readSessionLog } from "./perf-bench-helpers";

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
// The ticket keeps the strict all-visible-images gate. The architecture also
// needs a progressive-loading gate that measures the first real visual wave
// separately; selecting it is explicit so a passing first wave can never be
// mistaken for strict all-image completion.
const gateMode = process.env.SERPENT_LARGE_LIBRARY_E2E_GATE === "first-wave"
  ? "first-wave"
  : "all-images";
const observationTimeoutMs = Number(
  process.env.SERPENT_LARGE_LIBRARY_E2E_OBSERVATION_MS ?? 5_000,
);
// sa65 gate is a 10k-asset library; real libraries can be smaller. Operators
// measuring a smaller library can lower the bar explicitly.
const minAssets = Number(process.env.SERPENT_LARGE_LIBRARY_E2E_MIN_ASSETS ?? 10_000);
// Real libraries (converted Eagle/Billfish, hand-built) live outside tmpdir and
// can be tens of GB; let the operator choose the clone volume.
const cloneRoot = process.env.SERPENT_LARGE_LIBRARY_E2E_CLONE_ROOT ?? tmpdir();
// Operator-managed library copy: skips the per-run clone (and its deletion) so
// repeated baseline/optimization runs measure the same warm on-disk state.
const reuseLibraryPath = process.env.SERPENT_LARGE_LIBRARY_E2E_REUSE_LIBRARY ?? "";
// Full benchmark JSON (per-jump samples and stage breakdowns) is written here
// when requested; the console prints only a concise failure summary.
const resultPath = process.env.SERPENT_LARGE_LIBRARY_E2E_RESULT_PATH ?? "";
// When set, sample the renderer main thread during every jump (CDP Profiler)
// and write one .cpuprofile per jump for function-level hotspot attribution.
const profileDir = process.env.SERPENT_LARGE_LIBRARY_E2E_PROFILE_DIR ?? "";
// CDP Network events can expose serpent:// requests that Chromium omits from
// PerformanceResourceTiming. Opt in for diagnostic runs only.
const networkTraceEnabled = process.env.SERPENT_LARGE_LIBRARY_E2E_NETWORK_TRACE === "1";
// When set, record a devtools.timeline trace covering all jumps and write it
// as one JSON file (event-level timeline: layout/style/paint/function calls).
const traceDir = process.env.SERPENT_LARGE_LIBRARY_E2E_TRACE_DIR ?? "";

/**
 * Count live assets without loading better-sqlite3 into the Playwright runner:
 * dev node_modules are built for the Electron ABI, so the database is read
 * through ELECTRON_RUN_AS_NODE instead of a direct require.
 */
function countLiveAssetsViaElectron(libraryPath: string): number {
  const script = `
    const { createRequire } = require("node:module");
    const repoRequire = createRequire(${JSON.stringify(path.resolve("package.json"))});
    const Database = repoRequire("better-sqlite3");
    const db = new Database(${JSON.stringify(path.join(libraryPath, ".serpent", "library.db"))}, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT COUNT(*) AS n FROM assets WHERE deleted_at IS NULL").get();
    db.close();
    process.stdout.write(String(row.n));
  `;
  const stdout = execFileSync(
    resolveElectronExecutablePath(),
    ["-e", script],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 60_000,
    },
  );
  const count = Number(stdout.trim());
  if (!Number.isFinite(count)) {
    throw new Error(`Could not count assets in ${libraryPath}: got ${JSON.stringify(stdout)}`);
  }
  return count;
}

test.describe.configure({ timeout: 1_200_000 });

test.skip(!fixturePath, "Set SERPENT_LARGE_LIBRARY_E2E_PATH to a generated 10k+ fixture.");

test("fourth-stop random scrollbar jumps measure progressive visible decode", async () => {
  if (!fixturePath) throw new Error("Missing large-library fixture path.");
  // Reuse mode is intentionally stateful, but its denominator and fixture
  // metadata must come from the directory that Electron will actually open.
  // Reading these from the source fixture hid drift in reused artifact/job
  // state and made the benchmark report the wrong population.
  const measuredLibraryPath = reuseLibraryPath || fixturePath;
  const manifestPath = path.join(measuredLibraryPath, ".serpent", "large-library-fixture.json");
  let fixtureVersion: number | string;
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version: number;
    };
    fixtureVersion = manifest.version;
  } else {
    // Real-library mode: no generator manifest, count straight from the DB.
    fixtureVersion = "real-library";
  }
  // The manifest describes how the fixture was generated, not the current
  // live population: ignored/deleted assets and a reused library can drift.
  // Always use the DB owned by the library path that will be opened below.
  const assetCount = countLiveAssetsViaElectron(measuredLibraryPath);
  expect(assetCount).toBeGreaterThanOrEqual(minAssets);

  mkdirSync(cloneRoot, { recursive: true });
  const temporaryRoot = mkdtempSync(path.join(cloneRoot, "serpent-large-scroll-benchmark-"));
  const libraryPath = reuseLibraryPath || path.join(temporaryRoot, "benchmark-library");
  // Diagnostics can persist the isolated app log outside the disposable
  // benchmark root. The default remains per-run isolation and is always
  // cleaned with the rest of the temporary root.
  const userDataPath = process.env.SERPENT_LARGE_LIBRARY_E2E_USER_DATA_PATH
    || path.join(temporaryRoot, "user-data");
  if (!reuseLibraryPath) {
    if (process.platform === "win32") {
      // Robocopy exit codes are bit flags: 0-7 mean success, 8+ are failures.
      // execFileSync throws on any non-zero status, so success flags are caught.
      try {
        execFileSync(
          "robocopy",
          [fixturePath, libraryPath, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"],
          { stdio: "ignore" },
        );
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (typeof status !== "number" || status >= 8) throw error;
      }
    } else {
      // APFS clone keeps each run isolated from background jobs/cache writes while
      // avoiding a physical copy of the multi-gigabyte source fixture.
      execFileSync("cp", ["-cR", fixturePath, libraryPath]);
    }
  }

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

  let bodyError: unknown = undefined;
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
    await expect(window.locator(".asset-card:not(.is-layout-preview)").first()).toBeVisible({ timeout: 120_000 });

    const sizeControl = window.getByLabel("资产缩略图大小");
    const maxSizeIndex = Number(await sizeControl.getAttribute("max"));
    expect(maxSizeIndex).toBeGreaterThanOrEqual(3);
    await sizeControl.fill("3");
    await expect(sizeControl).toHaveValue("3");
    await window.getByRole("button", { name: "瀑布流视图" }).click();
    await expect(window.locator(".asset-grid")).toHaveClass(/is-masonry/);
    // Smaller real libraries (post-ignore visible sets) have proportionally
    // shorter canvases; the sa65 10k-asset default stays the operator default.
    const minScrollHeight = Number(process.env.SERPENT_LARGE_LIBRARY_E2E_MIN_SCROLL_HEIGHT ?? 100_000);
    await expect.poll(
      () => canvas.evaluate((element) => element.scrollHeight),
      { timeout: 30_000 },
    ).toBeGreaterThan(minScrollHeight);
    await expect.poll(
      () => window.evaluate(() => {
        const canvasElement = document.querySelector<HTMLElement>(".workspace-canvas");
        if (!canvasElement) return false;
        const canvasRect = canvasElement.getBoundingClientRect();
        const isVisiblyIntersecting = (rect: DOMRect) =>
          Math.min(rect.bottom, canvasRect.bottom) - Math.max(rect.top, canvasRect.top) >= 1
          && Math.min(rect.right, canvasRect.right) - Math.max(rect.left, canvasRect.left) >= 1;
        const visibleLayoutIds = [
          ...document.querySelectorAll<HTMLElement>("[data-layout-asset-id]"),
        ].filter((slot) => {
          const rect = slot.getBoundingClientRect();
          return isVisiblyIntersecting(rect);
        }).map((slot) => slot.dataset.layoutAssetId ?? "");
        // CANVAS-038: the virtual path no longer renders a shadow card for a slot
        // whose index identity is unresolved, and it keys slots by index rather
        // than by assetId. Both the selector below and the placeholder counters
        // further down therefore exclude *nothing* on this path. Require that
        // fact in the gate rather than assume it: if a future change
        // reintroduces shadow or placeholder cards here, the gate fails instead
        // of silently mis-measuring `passed`.
        const shadowCardCount = document.querySelectorAll(".asset-card.is-layout-preview").length;
        const placeholderCardCount = document.querySelectorAll(
          ".asset-card.is-browse-placeholder, .asset-card[data-asset-id^='__pending:']",
        ).length;
        const cards = [...document.querySelectorAll<HTMLElement>(".asset-card:not(.is-layout-preview)")]
          .filter((card) => {
            const rect = card.getBoundingClientRect();
            return isVisiblyIntersecting(rect);
          });
        const cardIds = new Set(cards.map((card) => card.dataset.assetId ?? ""));
        return visibleLayoutIds.length >= 4
          && visibleLayoutIds.every((assetId) => cardIds.has(assetId))
          && shadowCardCount === 0
          && placeholderCardCount === 0;
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
      // Stage breakdown needs every serpent://preview fetch of the current
      // jump; the default 250-entry buffer overflows across jumps.
      performance.setResourceTimingBufferSize(8192);
      const capture = ((event: CustomEvent) => {
        root.__serpentBrowsePages!.push({
          at: performance.now(),
          detail: event.detail,
        });
      }) as EventListener;
      globalThis.addEventListener("serpent:e2e-browse-page", capture);
      globalThis.addEventListener("serpent:e2e-browse-result", capture);
      globalThis.addEventListener("serpent:e2e-browse-request", capture);
    });

    let cdp: CDPSession | null = null;
    if (profileDir || traceDir || networkTraceEnabled) {
      cdp = await application.context().newCDPSession(window);
    }
    const networkRequests = new Map<string, {
      artifactId: string;
      startedEpochMs: number;
      startedAtMs: number;
      headersAtMs: number | null;
      finishedAtMs: number | null;
    }>();
    if (cdp && networkTraceEnabled) {
      cdp.on("Network.requestWillBeSent", (event: {
        requestId: string;
        request: { url: string };
        timestamp: number;
        wallTime: number;
      }) => {
        if (!/^serpent:\/\/(?:preview|source|proxy)\//.test(event.request.url)) return;
        networkRequests.set(event.requestId, {
          artifactId: event.request.url.slice(event.request.url.lastIndexOf("/") + 1).split("?")[0] ?? "",
          startedEpochMs: event.wallTime * 1_000,
          startedAtMs: event.timestamp * 1_000,
          headersAtMs: null,
          finishedAtMs: null,
        });
      });
      cdp.on("Network.responseReceived", (event: { requestId: string; timestamp: number }) => {
        const request = networkRequests.get(event.requestId);
        if (request) request.headersAtMs = event.timestamp * 1_000;
      });
      cdp.on("Network.loadingFinished", (event: { requestId: string; timestamp: number }) => {
        const request = networkRequests.get(event.requestId);
        if (request) request.finishedAtMs = event.timestamp * 1_000;
      });
      await cdp.send("Network.enable");
    }
    if (cdp && profileDir) {
      mkdirSync(profileDir, { recursive: true });
      await cdp.send("Profiler.enable");
      // 100 µs sampling: fine enough to attribute single-frame hot functions.
      await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    }
    const traceEvents: Array<Record<string, unknown>> = [];
    let tracingComplete: Promise<unknown> | null = null;
    if (cdp && traceDir) {
      mkdirSync(traceDir, { recursive: true });
      cdp.on("Tracing.dataCollected", (payload: { value?: unknown }) => {
        if (Array.isArray(payload.value)) traceEvents.push(...payload.value);
      });
      await cdp.send("Tracing.start", {
        traceConfig: {
          includedCategories: [
            "devtools.timeline",
            "v8.execute",
            "blink.user_timing",
            "disabled-by-default-devtools.timeline.frame",
          ],
        },
      });
    }

    const samples: Array<{
      fraction: number;
      startedEpochMs: number;
      endedEpochMs: number;
      actualFraction: number;
      targetReached: boolean;
      elapsedMs: number;
      visibleCards: number;
      imageCards: number;
      decodedImages: number;
      videoCards: number;
      decodedVideos: number;
      fontCards: number;
      decodedFonts: number;
      previewCards: number;
      decodedPreviews: number;
      placeholders: number;
      defaultIcons: number;
      firstVisualWaveAt: number | null;
      firstVisualWaveDecodedImages: number;
      imgCardsAllDecodedAt: number | null;
      eventualCompleteAt: number | null;
      observationElapsedMs: number;
      undecodedImageIds: string[];
      undecodedPosterIds: string[];
      visibleAssetIds: string[];
      visibleLayoutAssetIds: string[];
      visibleLayoutRanks: number[];
      searchRequestsBefore: number;
      searchRequestsAfter: number;
      pageEvents: unknown[];
      requestOffsets: number[];
      requestWaveCount: number;
      pageTimeline: Array<{
        relMs: number;
        kind: "issue" | "resolved" | "applied";
        offset: number | null;
      }>;
      fetchStages: Array<{
        artifactId: string;
        startRelMs: number;
        endRelMs: number;
        durationMs: number;
        transferSize: number;
      }>;
      doneTimeline: Array<{
        relMs: number;
        visibleCards: number;
        decodedImages: number;
        placeholders: number;
        defaultIcons: number;
        uncoveredLayoutIds: number;
      }>;
      longTaskCount: number;
      longTaskMaxMs: number;
      imageStates: Array<{
        assetId: string;
        mediaType: string;
        layoutPreview: boolean;
        src: string;
        complete: boolean;
        naturalWidth: number;
        naturalHeight: number;
      }>;
      gatePassed: boolean;
      timedOut: boolean;
    }> = [];

    const networkByJump: Array<{
      fraction: number;
      stages: Array<{
        artifactId: string;
        requestAtMs: number;
        headersAtMs: number | null;
        finishedAtMs: number | null;
      }>;
    }> = [];
    let jumpIndex = 0;
    for (const fraction of effectiveJumpFractions) {
      if (cdp && profileDir) await cdp.send("Profiler.start");
      if (cdp && traceDir) {
        // Give the just-started tracing session a macrotask turn so its first
        // captured events are not dropped; otherwise the jump's opening phase
        // (scroll → first page request) can fall outside the trace.
        await window.evaluate(() => new Promise<void>((resolve) => {
          setTimeout(resolve, 300);
        }));
      }
      const sample = await window.evaluate(
        async ({ fraction: targetFraction, timeoutMs, gate }) => {
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
          eventRoot.__serpentLongTasks = [];
          const startedAt = performance.now();
          let firstVisualWaveAt: number | null = null;
          let firstVisualWaveDecodedImages = 0;
          let imgCardsAllDecodedAt: number | null = null;
          let eventualCompleteAt: number | null = null;
          const doneTimeline: Array<{
            relMs: number;
            visibleCards: number;
            decodedImages: number;
            placeholders: number;
            defaultIcons: number;
            uncoveredLayoutIds: number;
          }> = [];
          // Keep only this jump's serpent://preview resource entries so the
          // stage breakdown never mixes jumps (or the initial open).
          performance.clearResourceTimings();
          // Trace anchor: blink.user_timing surfaces these in CDP traces so the
          // analysis can bound the jump window exactly.
          performance.mark("bench:jump-start");
          const maxScroll = Math.max(0, canvasElement.scrollHeight - canvasElement.clientHeight);
          canvasElement.scrollTop = maxScroll * targetFraction;

          return await new Promise<{
            fraction: number;
            startedEpochMs: number;
            endedEpochMs: number;
            actualFraction: number;
            targetReached: boolean;
            elapsedMs: number;
            visibleCards: number;
            imageCards: number;
            decodedImages: number;
            videoCards: number;
            decodedVideos: number;
            fontCards: number;
            decodedFonts: number;
            previewCards: number;
            decodedPreviews: number;
            placeholders: number;
            defaultIcons: number;
            firstVisualWaveAt: number | null;
            firstVisualWaveDecodedImages: number;
            imgCardsAllDecodedAt: number | null;
            eventualCompleteAt: number | null;
            observationElapsedMs: number;
            undecodedImageIds: string[];
            undecodedPosterIds: string[];
            visibleAssetIds: string[];
            visibleLayoutAssetIds: string[];
            visibleLayoutRanks: number[];
            searchRequestsBefore: number;
            searchRequestsAfter: number;
            pageEvents: unknown[];
            requestOffsets: number[];
            requestWaveCount: number;
            pageTimeline: Array<{
              relMs: number;
              kind: "issue" | "resolved" | "applied";
              offset: number | null;
            }>;
            fetchStages: Array<{
              artifactId: string;
              startRelMs: number;
              endRelMs: number;
              durationMs: number;
              transferSize: number;
            }>;
            doneTimeline: Array<{
              relMs: number;
              visibleCards: number;
              decodedImages: number;
              placeholders: number;
              defaultIcons: number;
              uncoveredLayoutIds: number;
            }>;
            longTaskCount: number;
            longTaskMaxMs: number;
            imageStates: Array<{
              assetId: string;
              mediaType: string;
              layoutPreview: boolean;
              src: string;
              complete: boolean;
              naturalWidth: number;
              naturalHeight: number;
            }>;
            gatePassed: boolean;
            timedOut: boolean;
          }>((resolve) => {
            const inspect = () => {
              const canvasRect = canvasElement.getBoundingClientRect();
              // A card touching only a subpixel sliver at the bottom has no
              // visible image pixels. It must not hold the strict decode gate
              // open while its media is correctly deferred off-screen.
              const isVisiblyIntersecting = (rect: DOMRect) =>
                Math.min(rect.bottom, canvasRect.bottom) - Math.max(rect.top, canvasRect.top) >= 1
                  && Math.min(rect.right, canvasRect.right) - Math.max(rect.left, canvasRect.left) >= 1;
              // Never count an aria-hidden layout preview as a decoded real
              // card. Its thumbnail can be ready while the summary page for
              // this scrollbar destination is still in flight.
              const visible = [...document.querySelectorAll<HTMLElement>(".asset-card:not(.is-layout-preview)")]
                .filter((card) => {
                  const rect = card.getBoundingClientRect();
                  return isVisiblyIntersecting(rect);
                });
              const placeholders = visible.filter((card) =>
                card.classList.contains("is-browse-placeholder")
                || card.dataset.assetId?.startsWith("__pending:"),
              ).length;
              const imageCards = visible.filter((card) => card.dataset.mediaType === "image");
              const videoCards = visible.filter((card) => card.dataset.mediaType === "video");
              const fontCards = visible.filter((card) => card.dataset.mediaType === "font");
              const previewCards = [...imageCards, ...videoCards, ...fontCards];
              const isDecoded = (card: HTMLElement) => {
                const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
                return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
              };
              const decodedImages = imageCards.filter(isDecoded).length;
              const decodedVideos = videoCards.filter(isDecoded).length;
              const decodedFonts = fontCards.filter(isDecoded).length;
              const decodedPreviews = decodedImages + decodedVideos + decodedFonts;
              const defaultIcons = visible.filter((card) =>
                !card.classList.contains("is-browse-placeholder")
                && !card.querySelector("img.asset-thumbnail"),
              ).length;
              const elapsedMs = performance.now() - startedAt;
              const currentMaxScroll = Math.max(0, canvasElement.scrollHeight - canvasElement.clientHeight);
              const actualFraction = currentMaxScroll > 0
                ? canvasElement.scrollTop / currentMaxScroll
                : 0;
              // A programmatic jump can be restored by scroll anchoring before
              // any new page arrives. Decoded cards from the old position are
              // not a successful sample of the requested destination.
              const targetReached = Math.abs(actualFraction - targetFraction) <= 0.02;
              const visibleLayoutAssetIds = [
                ...document.querySelectorAll<HTMLElement>("[data-layout-asset-id]"),
              ].filter((slot) => {
                const rect = slot.getBoundingClientRect();
                return isVisiblyIntersecting(rect);
              }).map((slot) => slot.dataset.layoutAssetId ?? "");
              const visibleAssetIds = visible.map(
                (card) => card.dataset.assetId ?? "",
              );
              const loadedIds = new Set(visibleAssetIds);
              const layoutReady = targetReached
                && visibleLayoutAssetIds.length >= 4
                && visibleLayoutAssetIds.every((assetId) => loadedIds.has(assetId))
                && placeholders === 0;
              // Count image covers, video posters and font previews. Icon-only cards do
              // not have a decodable visual preview and remain outside this gate.
              const imgDecoded = decodedPreviews;
              const firstWaveTarget = Math.min(4, previewCards.length);
              if (
                firstVisualWaveAt === null
                && previewCards.length > 0
                && layoutReady
                && imgDecoded >= firstWaveTarget
              ) {
                firstVisualWaveAt = Math.round(elapsedMs * 10) / 10;
                firstVisualWaveDecodedImages = imgDecoded;
              }
              if (
                imgCardsAllDecodedAt === null
                && previewCards.length > 0
                && layoutReady
                && imgDecoded === previewCards.length
              ) {
                imgCardsAllDecodedAt = Math.round(elapsedMs * 10) / 10;
                eventualCompleteAt = imgCardsAllDecodedAt;
              }
              // Strict sa65 completion remains available as a separate
              // metric. The architecture's primary gate is the first visual
              // wave; both values are recorded so a progressive pass cannot
              // hide a slow tail.
              const strictDone = imgCardsAllDecodedAt !== null;
              const observationDone = strictDone || elapsedMs >= timeoutMs;
              const gatePassed = gate === "first-wave"
                ? firstVisualWaveAt !== null && firstVisualWaveAt <= 500
                : strictDone && imgCardsAllDecodedAt !== null && imgCardsAllDecodedAt <= 500;
              doneTimeline.push({
                relMs: Math.round(elapsedMs * 10) / 10,
                visibleCards: visible.length,
                decodedImages,
                placeholders,
                defaultIcons,
                uncoveredLayoutIds: visibleLayoutAssetIds.filter(
                  (assetId) => !loadedIds.has(assetId),
                ).length,
              });
              if (observationDone) {
                const visibleLayoutRanks = [
                  ...document.querySelectorAll<HTMLElement>("[data-layout-rank]"),
                ].filter((slot) => {
                  const rect = slot.getBoundingClientRect();
                  return isVisiblyIntersecting(rect);
                }).map((slot) => Number(slot.dataset.layoutRank));
                const imageStates = visible.slice(0, 32).map((card) => {
                  const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
                  return {
                    assetId: card.dataset.assetId ?? "",
                    mediaType: card.dataset.mediaType ?? "",
                    layoutPreview: card.classList.contains("is-layout-preview"),
                    src: image?.currentSrc || image?.src || "",
                    complete: image?.complete ?? false,
                    naturalWidth: image?.naturalWidth ?? 0,
                    naturalHeight: image?.naturalHeight ?? 0,
                  };
                });
                const pageEvents = eventRoot.__serpentBrowsePages ?? [];
                const pageTimeline = pageEvents.flatMap((event) => {
                  if (
                    typeof event !== "object"
                    || event === null
                    || !("at" in event)
                    || !("detail" in event)
                    || typeof event.at !== "number"
                    || typeof event.detail !== "object"
                    || event.detail === null
                  ) return [];
                  const detail = event.detail as Record<string, unknown>;
                  const kind: "issue" | "resolved" | "applied" =
                    "resultOffset" in detail
                      ? "applied"
                      : "ok" in detail
                        ? "resolved"
                        : "issue";
                  const offset = typeof detail.requestOffset === "number"
                    ? detail.requestOffset
                    : typeof detail.resultOffset === "number"
                      ? detail.resultOffset
                      : null;
                  return [{ relMs: Math.round((event.at - startedAt) * 10) / 10, kind, offset }];
                });
                const requestOffsets = pageTimeline
                  .filter((event) => event.kind === "issue" && event.offset !== null)
                  .map((event) => event.offset as number);
                // Chromium does not always expose timing for custom protocols.
                const fetchStages = performance.getEntriesByType("resource")
                  .filter((entry): entry is PerformanceResourceTiming =>
                    entry.name.startsWith("serpent://preview/"))
                  .filter((entry) => entry.startTime >= startedAt)
                  .map((entry) => ({
                    artifactId: entry.name.slice(entry.name.lastIndexOf("/") + 1),
                    startRelMs: Math.round((entry.startTime - startedAt) * 10) / 10,
                    endRelMs: Math.round((entry.responseEnd - startedAt) * 10) / 10,
                    durationMs: Math.round(entry.duration * 10) / 10,
                    transferSize: entry.transferSize,
                  }));
                const undecodedImageIds = imageCards
                  .filter((card) => !isDecoded(card))
                  .map((card) => card.dataset.assetId ?? "");
                const undecodedPosterIds = videoCards
                  .filter((card) => !isDecoded(card))
                  .map((card) => card.dataset.assetId ?? "");
                performance.mark("bench:jump-done");
                performance.measure("bench:jump", "bench:jump-start", "bench:jump-done");
                const gateElapsedMs = gate === "first-wave"
                  ? firstVisualWaveAt ?? elapsedMs
                  : imgCardsAllDecodedAt ?? elapsedMs;
                resolve({
                  fraction: targetFraction,
                  startedEpochMs: performance.timeOrigin + startedAt,
                  endedEpochMs: performance.timeOrigin + performance.now(),
                  actualFraction,
                  targetReached,
                  elapsedMs: gateElapsedMs,
                  visibleCards: visible.length,
                  imageCards: imageCards.length,
                  decodedImages,
                  videoCards: videoCards.length,
                  decodedVideos,
                  fontCards: fontCards.length,
                  decodedFonts,
                  previewCards: previewCards.length,
                  decodedPreviews,
                  placeholders,
                  defaultIcons,
                  firstVisualWaveAt,
                  firstVisualWaveDecodedImages,
                  imgCardsAllDecodedAt,
                  eventualCompleteAt,
                  observationElapsedMs: elapsedMs,
                  undecodedImageIds,
                  undecodedPosterIds,
                  visibleAssetIds,
                  visibleLayoutAssetIds,
                  visibleLayoutRanks,
                  searchRequestsBefore,
                  searchRequestsAfter: diagnostics.getRequestCount("asset.search.request"),
                  pageEvents,
                  requestOffsets,
                  requestWaveCount: requestOffsets.length,
                  pageTimeline,
                  fetchStages,
                  doneTimeline,
                  longTaskCount: eventRoot.__serpentLongTasks?.length ?? 0,
                  longTaskMaxMs: Math.max(0, ...(eventRoot.__serpentLongTasks ?? [])),
                  imageStates,
                  gatePassed,
                  timedOut: !strictDone,
                });
                return;
              }
              requestAnimationFrame(inspect);
            };
            requestAnimationFrame(inspect);
          });
        },
        { fraction, timeoutMs: observationTimeoutMs, gate: gateMode },
      );
      if (cdp && profileDir) {
        const stopResult = await cdp.send("Profiler.stop");
        if (stopResult.profile) {
          writeFileSync(
            path.join(profileDir, `jump-${jumpIndex}-fraction-${fraction}.cpuprofile`),
            JSON.stringify(stopResult.profile),
          );
        }
      }
      if (networkTraceEnabled) {
        // Let CDP deliver loadingFinished messages already queued by Chromium.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        networkByJump.push({
          fraction,
          stages: [...networkRequests.values()]
            .filter((request) =>
              request.startedEpochMs >= sample.startedEpochMs
              && request.startedEpochMs <= sample.endedEpochMs)
            .map((request) => ({
              artifactId: request.artifactId,
              requestAtMs: Math.round((request.startedEpochMs - sample.startedEpochMs) * 10) / 10,
              headersAtMs: request.headersAtMs === null
                ? null
                : Math.round((request.headersAtMs - request.startedAtMs) * 10) / 10,
              finishedAtMs: request.finishedAtMs === null
                ? null
                : Math.round((request.finishedAtMs - request.startedAtMs) * 10) / 10,
            })),
        });
      }
      jumpIndex += 1;
      samples.push(sample);
    }

    if (cdp && traceDir) {
      tracingComplete = new Promise((resolve) => {
        cdp!.once("Tracing.tracingComplete", resolve);
      });
      await cdp.send("Tracing.end");
      await tracingComplete;
      writeFileSync(
        path.join(traceDir, "jumps-trace.json"),
        JSON.stringify(traceEvents),
      );
    }

    const elapsed = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
    const workerCommandSpans = process.env.SERPENT_WORKER_CMD_LOG === "1"
      ? readSessionLog(userDataPath)
        .split(/\r?\n/)
        .flatMap((line) => {
          try {
            const record = JSON.parse(line) as {
              scope?: string;
              context?: { type?: string; sentAt?: number; queueMs?: number; schedulerWaitMs?: number; runMs?: number };
            };
            if (record.scope !== "worker.cmd" || !record.context?.type) return [];
            return [record.context];
          } catch {
            return [];
          }
        })
      : [];
    const workerLagEvents = process.env.SERPENT_LAG_LOG === "1"
      ? readSessionLog(userDataPath)
        .split(/\r?\n/)
        .flatMap((line) => {
          try {
            const record = JSON.parse(line) as {
              timestamp?: string;
              scope?: string;
              context?: { driftMs?: number; activity?: string };
            };
            if (record.scope !== "worker.eventLoop.lag") return [];
            return [{
              atEpochMs: Date.parse(record.timestamp ?? ""),
              driftMs: record.context?.driftMs ?? 0,
              activity: record.context?.activity ?? "unknown",
            }];
          } catch {
            return [];
          }
        })
      : [];
    const reconciliationStages = process.env.SERPENT_REFRESH_STAGE_LOG === "1"
      ? readSessionLog(userDataPath)
        .split(/\r?\n/)
        .flatMap((line) => {
          try {
            const record = JSON.parse(line) as {
              timestamp?: string;
              scope?: string;
              context?: { stage?: string; durationMs?: number; totalMs?: number };
            };
            if (record.scope !== "open.reconciliation.stage"
              && record.scope !== "open.refresh-managed-assets.stage") return [];
            return [{
              atEpochMs: Date.parse(record.timestamp ?? ""),
              scope: record.scope,
              stage: record.context?.stage ?? "unknown",
              durationMs: record.context?.durationMs ?? 0,
              totalMs: record.context?.totalMs ?? 0,
            }];
          } catch {
            return [];
          }
        })
      : [];
    const mediaQueueStages = process.env.SERPENT_MEDIA_QUEUE_LOG === "1"
      ? readSessionLog(userDataPath)
        .split(/\r?\n/)
        .flatMap((line) => {
          try {
            const record = JSON.parse(line) as {
              timestamp?: string;
              scope?: string;
              context?: { mediaStage?: string; maxJobs?: number; assetCount?: number | null };
            };
            if (record.scope !== "worker.media-queue") return [];
            return [{
              atEpochMs: Date.parse(record.timestamp ?? ""),
              stage: record.context?.mediaStage ?? "unknown",
              maxJobs: record.context?.maxJobs ?? null,
              assetCount: record.context?.assetCount ?? null,
            }];
          } catch {
            return [];
          }
        })
      : [];
    const workerByJump = (commandType: string) => samples.map((sample) => {
      const spans = workerCommandSpans.filter((span) =>
        span.type === commandType
        && typeof span.sentAt === "number"
        && span.sentAt >= sample.startedEpochMs
        && span.sentAt <= sample.endedEpochMs);
      return {
        fraction: sample.fraction,
        count: spans.length,
        maxQueueMs: Math.max(0, ...spans.map((span) => span.queueMs ?? 0)),
        maxSchedulerWaitMs: Math.max(0, ...spans.map((span) => span.schedulerWaitMs ?? 0)),
        maxRunMs: Math.max(0, ...spans.map((span) => span.runMs ?? 0)),
      };
    });
    const pathWorkerByJump = workerByJump("media.get-artifact-paths");
    const pageWorkerByJump = workerByJump("browse.session.page");
    const firstWaveElapsed = samples
      .map((sample) => sample.firstVisualWaveAt)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    const eventualElapsed = samples
      .map((sample) => sample.eventualCompleteAt)
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    const percentile = (values: number[], quantile: number): number | null => {
      if (values.length === 0) return null;
      return values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)]!;
    };
    const p50 = percentile(elapsed, 0.5)!;
    const p95 = percentile(elapsed, 0.95)!;
    const result = {
      suite: "large-library-electron-scroll",
      fixtureVersion,
      assets: assetCount,
      cardSizeIndex: 3,
      jumps: samples.length,
      targetMs,
      gateMode,
      passed: samples.filter((sample) => sample.gatePassed).length,
      p50Ms: Number(p50.toFixed(1)),
      p95Ms: Number(p95.toFixed(1)),
      maxMs: Number(Math.max(...elapsed).toFixed(1)),
      firstVisualWaveP50Ms: percentile(firstWaveElapsed, 0.5),
      firstVisualWaveP95Ms: percentile(firstWaveElapsed, 0.95),
      firstVisualWaveMaxMs: firstWaveElapsed.length > 0
        ? Number(Math.max(...firstWaveElapsed).toFixed(1))
        : null,
      eventualCompleteCount: eventualElapsed.length,
      eventualCompleteP50Ms: percentile(eventualElapsed, 0.5),
      strictAllImagesWithinTarget: samples.filter((sample) =>
        sample.imgCardsAllDecodedAt !== null && sample.imgCardsAllDecodedAt <= targetMs,
      ).length,
      observationTimeoutMs,
      ...(networkTraceEnabled ? { networkByJump } : {}),
      ...(process.env.SERPENT_WORKER_CMD_LOG === "1" ? {
        pathWorkerByJump,
        pageWorkerByJump,
        workerCommandsNearJumps: samples.map((sample) => ({
          fraction: sample.fraction,
          commands: workerCommandSpans.filter((span) =>
            typeof span.sentAt === "number"
            && span.sentAt >= sample.startedEpochMs - 10_000
            && span.sentAt <= sample.endedEpochMs,
          ).slice(0, 500),
        })),
      } : {}),
      ...(process.env.SERPENT_LAG_LOG === "1" ? {
        workerLagByJump: samples.map((sample) => ({
          fraction: sample.fraction,
          events: workerLagEvents.filter((event) =>
            event.atEpochMs >= sample.startedEpochMs - 1_000
            && event.atEpochMs <= sample.endedEpochMs + 1_000,
          ),
        })),
      } : {}),
      ...(process.env.SERPENT_REFRESH_STAGE_LOG === "1" ? {
        reconciliationStagesNearJumps: samples.map((sample) => ({
          fraction: sample.fraction,
          stages: reconciliationStages.filter((stage) =>
            stage.atEpochMs >= sample.startedEpochMs - 2_000
            && stage.atEpochMs <= sample.endedEpochMs + 2_000,
          ),
        })),
      } : {}),
      ...(process.env.SERPENT_MEDIA_QUEUE_LOG === "1" ? {
        mediaQueueStagesNearJumps: samples.map((sample) => ({
          fraction: sample.fraction,
          stages: mediaQueueStages.filter((stage) =>
            stage.atEpochMs >= sample.startedEpochMs - 2_000
            && stage.atEpochMs <= sample.endedEpochMs + 1_000,
          ).slice(0, 200),
        })),
      } : {}),
      samples: samples.map((sample) => ({
        ...sample,
        elapsedMs: Number(sample.elapsedMs.toFixed(1)),
        observationElapsedMs: Number(sample.observationElapsedMs.toFixed(1)),
      })),
    };
    const summary = {
      suite: result.suite,
      assets: result.assets,
      jumps: result.jumps,
      passed: result.passed,
      p50Ms: result.p50Ms,
      p95Ms: result.p95Ms,
      maxMs: result.maxMs,
      firstVisualWaveP95Ms: result.firstVisualWaveP95Ms,
      ...((networkTraceEnabled || process.env.SERPENT_WORKER_CMD_LOG === "1") ? {
        diagnosticStages: result.samples.map((sample) => {
          const network = networkByJump.find((jump) => jump.fraction === sample.fraction)?.stages ?? [];
          return {
            fraction: sample.fraction,
            elapsedMs: sample.elapsedMs,
            lastPageAppliedMs: sample.pageTimeline
              .filter((event) => event.kind === "applied")
              .at(-1)?.relMs ?? null,
            networkCount: network.length,
            latestRequestAtMs: Math.max(0, ...network.map((stage) => stage.requestAtMs)),
            latestFinishedAtMs: Math.max(
              0,
              ...network.map((stage) => stage.requestAtMs + (stage.finishedAtMs ?? 0)),
            ),
            pathWorker: pathWorkerByJump.find((jump) => jump.fraction === sample.fraction),
            pageWorker: pageWorkerByJump.find((jump) => jump.fraction === sample.fraction),
          };
        }),
      } : {}),
      failures: result.samples.filter((sample) => !sample.gatePassed).map((sample) => ({
        fraction: sample.fraction,
        elapsedMs: sample.elapsedMs,
        firstVisualWaveAt: sample.firstVisualWaveAt,
        visibleCards: sample.visibleCards,
        decodedPreviews: sample.decodedPreviews,
        requestOffsets: sample.requestOffsets,
        pageTimeline: sample.pageTimeline,
        longTaskCount: sample.longTaskCount,
        longTaskMaxMs: sample.longTaskMaxMs,
        ...(process.env.SERPENT_WORKER_CMD_LOG === "1"
          ? {
              pathWorker: pathWorkerByJump.find((jump) => jump.fraction === sample.fraction),
              pageWorker: pageWorkerByJump.find((jump) => jump.fraction === sample.fraction),
            }
          : {}),
        ...(networkTraceEnabled ? {
          network: (() => {
            const stages = networkByJump.find((jump) => jump.fraction === sample.fraction)?.stages ?? [];
            return {
              count: stages.length,
              maxRequestToHeadersMs: Math.max(0, ...stages.map((stage) => stage.headersAtMs ?? 0)),
              maxRequestToFinishMs: Math.max(0, ...stages.map((stage) => stage.finishedAtMs ?? 0)),
              latestFinishedAtMs: Math.max(
                0,
                ...stages.map((stage) => stage.requestAtMs + (stage.finishedAtMs ?? 0)),
              ),
            };
          })(),
        } : {}),
      })),
    };
    console.info(`[large-library-benchmark] ${JSON.stringify(summary)}`);
    if (resultPath) {
      writeFileSync(resultPath, JSON.stringify(result, null, 2));
    }

    expect(result.passed, JSON.stringify(summary, null, 2)).toBe(samples.length);
  } catch (error) {
    bodyError = error;
  }
  await application.close();
  // Serpent-140fe2: no-unsafe-finally — cleanup runs outside try/finally so
  // its throws never mask the body error; the body error is rethrown after
  // cleanup completes either way.
  let cleanupError: unknown = undefined;
  try {
    rmSync(temporaryRoot, { force: true, recursive: true });
  } catch (firstCleanupError) {
    // Windows can hold brief locks immediately after Electron exits; block
    // shortly and retry once.
    const buffer = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(buffer), 0, 0, 400);
    try {
      rmSync(temporaryRoot, { force: true, recursive: true });
    } catch (retryError) {
      cleanupError = retryError;
      void firstCleanupError;
    }
  }
  if (bodyError !== undefined) throw bodyError;
  if (cleanupError !== undefined) throw cleanupError;
});
