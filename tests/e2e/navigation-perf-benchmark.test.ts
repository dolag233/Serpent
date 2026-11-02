import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  clickNavScope,
  installRendererProbe,
  launchBenchmarkApp,
  listNavScopes,
  readRendererProbe,
  readSessionLog,
  resetRendererCounters,
  seedRecentLibraries,
  summarizeBenchLog,
  summarizeTimings,
  visibleImageStats,
  waitForVisibleDecoded,
  writeBenchReport,
  type BenchLogSummary,
  type NavScope,
  type RendererProbe,
} from "./perf-bench-helpers";

/**
 * Serpent-217028: end-to-end navigation benchmark on a real library.
 *
 * It is an operator tool, not a pass/fail gate: it never runs without
 * `SERPENT_NAV_BENCH_LIBRARY`, and it never stores a library path, library name
 * or asset name — every path arrives through the environment.
 *
 * Journeys:
 *   read-only (always)   open, folder switch, collection switch, random jumps,
 *                        continuous wheel scroll, viewer open, library switch
 *   destructive (opt-in) folder create, collection create, asset trash, folder
 *                        delete — only with SERPENT_NAV_BENCH_WRITE_LIBRARY and
 *                        an explicit SERPENT_NAV_BENCH_WRITE_CONFIRM=1, so a
 *                        real library can never be mutated by accident.
 *
 * Run it through `npm run test:perf:navigation -- <library> [second-library]`.
 */
const readLibrary = process.env.SERPENT_NAV_BENCH_LIBRARY;
const secondLibrary = process.env.SERPENT_NAV_BENCH_LIBRARY_B;
const writeLibrary = process.env.SERPENT_NAV_BENCH_WRITE_LIBRARY;
const writeConfirmed = process.env.SERPENT_NAV_BENCH_WRITE_CONFIRM === "1";
const reportPath = process.env.SERPENT_NAV_BENCH_OUT;
const iterations = Math.max(1, Math.min(40, Number(process.env.SERPENT_NAV_BENCH_ITERATIONS ?? 6)));
const wheelMs = Math.max(1_000, Number(process.env.SERPENT_NAV_BENCH_WHEEL_MS ?? 6_000));
const settleMs = Math.max(0, Number(process.env.SERPENT_NAV_BENCH_SETTLE_MS ?? 25_000));
const decodeBudgetMs = Number(process.env.SERPENT_NAV_BENCH_DECODE_BUDGET_MS ?? 20_000);

test.describe.configure({ timeout: 2_400_000 });
test.skip(!readLibrary, "Set SERPENT_NAV_BENCH_LIBRARY to a real library path.");

type OpSample = {
  op: string;
  index: number;
  ms: number;
  detail?: Record<string, unknown>;
};

/** Deterministic PRNG so two runs visit the same scopes in the same order. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

async function waitForFirstCard(window: Page, timeoutMs: number): Promise<number> {
  const startedAt = Date.now();
  await expect(window.locator(".asset-card").first()).toBeVisible({ timeout: timeoutMs });
  return Date.now() - startedAt;
}

async function activeScopeTitle(window: Page): Promise<string> {
  return window.evaluate(() =>
    document.querySelector<HTMLElement>(".navigation-pane button.nav-row.is-active .nav-row-label")
      ?.textContent?.trim() ?? "",
  );
}

function pickScope(
  scopes: readonly NavScope[],
  kind: NavScope["kind"],
  random: () => number,
  excludeTitle: string,
): NavScope | null {
  const candidates = scopes.filter((scope) => scope.kind === kind && scope.title !== excludeTitle);
  const pool = candidates.length > 0 ? candidates : scopes.filter((scope) => scope.kind === kind);
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)] ?? null;
}

type ScopeSwitchResult = {
  ms: number;
  pageMs: number | null;
  coverageMs: number | null;
  coverage: number;
  imageCards: number;
  timedOut: boolean;
};

/**
 * Click a sidebar scope and measure the phases a user feels separately:
 * input → the new scope and its card set committed (the navigation latency),
 * → first visible decode, → most of the visible image cards decoded.
 *
 * `ms` is the page arrival, never the decode budget: a library whose assets
 * have no ready thumbnail can sit at low coverage until the budget expires, and
 * reporting that timeout as the switch latency would hide a fast navigation.
 */
async function measureScopeSwitch(
  window: Page,
  scope: NavScope,
  timeoutMs: number,
): Promise<ScopeSwitchResult> {
  const beforeIds = await window.locator(".asset-card[data-asset-id]").evaluateAll((cards) =>
    cards.map((card) => (card as HTMLElement).dataset.assetId ?? "").join("\u0000"));
  const startedAt = Date.now();
  await clickNavScope(window, scope.rowIndex);
  // The browse-page diagnostic event only covers subsequent pages. First-page
  // session opens must be observed from the active scope and committed cards.
  let pageMs: number | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    const committed = await window.evaluate(({ rowIndex, before }) => {
      const row = document.querySelectorAll<HTMLElement>(".navigation-pane button.nav-row")[rowIndex];
      const ids = [...document.querySelectorAll<HTMLElement>(".asset-card[data-asset-id]")]
        .map((card) => card.dataset.assetId ?? "").join("\u0000");
      return row?.classList.contains("is-active") === true && ids.length > 0 && ids !== before;
    }, { rowIndex: scope.rowIndex, before: beforeIds });
    if (committed) {
      pageMs = Date.now() - startedAt;
      break;
    }
    await window.waitForTimeout(40);
  }
  const decode = await waitForVisibleDecoded(window, 0.8, decodeBudgetMs);
  const stats = await visibleImageStats(window);
  return {
    ms: pageMs ?? Date.now() - startedAt,
    pageMs,
    coverageMs: decode.timedOut ? null : decode.elapsedMs,
    coverage: Number(stats.coverage.toFixed(3)),
    imageCards: stats.imageCards,
    timedOut: pageMs === null,
  };
}

/** Random scrollbar jumps: viewport teleports, then the new page must paint. */
async function measureJump(
  window: Page,
  random: () => number,
  timeoutMs: number,
): Promise<{ ms: number; coverageMs: number | null; coverage: number; timedOut: boolean; ratio: number }> {
  const canvas = window.locator(".workspace-canvas");
  const ratio = 0.05 + random() * 0.9;
  const startedAt = Date.now();
  await canvas.evaluate((element, fraction) => {
    element.scrollTop = element.scrollHeight * (fraction as number);
  }, ratio);
  const decode = await waitForVisibleDecoded(window, 0.8, timeoutMs);
  const stats = await visibleImageStats(window);
  return {
    ms: Date.now() - startedAt,
    coverageMs: decode.timedOut ? null : decode.elapsedMs,
    coverage: Number(stats.coverage.toFixed(3)),
    timedOut: decode.timedOut,
    ratio: Number(ratio.toFixed(2)),
  };
}

/** Continuous wheel scroll with direction reversals, like a real user. */
async function measureWheel(window: Page, ms: number): Promise<{
  steps: number;
  longTaskCount: number;
  longTaskMaxMs: number;
  frameP95Ms: number;
  frameMaxMs: number;
  mediaSrcWrites: number;
  maxSrcWritesOnOneElement: number;
  slotCreated: number;
  slotRemoved: number;
}> {
  await resetRendererCounters(window);
  const canvas = window.locator(".workspace-canvas");
  const box = await canvas.boundingBox();
  if (box) await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const startedAt = Date.now();
  let direction = 1;
  let steps = 0;
  while (Date.now() - startedAt < ms) {
    await window.mouse.wheel(0, direction * (60 + Math.floor(Math.random() * 240)));
    steps += 1;
    await window.waitForTimeout(60 + Math.floor(Math.random() * 90));
    if (Math.random() < 0.25) direction *= -1;
  }
  const probe = await readRendererProbe(window);
  return {
    steps,
    longTaskCount: probe.longTaskCount,
    longTaskMaxMs: probe.longTaskMaxMs,
    frameP95Ms: probe.frameP95Ms,
    frameMaxMs: probe.frameMaxMs,
    mediaSrcWrites: probe.mediaSrcWrites,
    maxSrcWritesOnOneElement: probe.maxSrcWritesOnOneElement,
    slotCreated: probe.slotCreated,
    slotRemoved: probe.slotRemoved,
  };
}

/** Open the viewer on a decoded image card and wait for the preview decode. */
async function measureViewerOpen(window: Page, timeoutMs: number): Promise<{
  ms: number;
  decoded: boolean;
  timedOut: boolean;
}> {
  const startedAt = Date.now();
  const card = window.locator(".asset-card[data-media-type='image']").filter({
    has: window.locator("img.asset-thumbnail"),
  }).first();
  if (await card.count() === 0) return { ms: 0, decoded: false, timedOut: true };
  await card.dblclick();
  let decoded = false;
  let timedOut = false;
  try {
    await expect(window.locator(".workspace-viewer")).toBeVisible({ timeout: timeoutMs });
    await expect
      .poll(async () => window.locator(".workspace-viewer img.preview-image:not(.is-hidden)").evaluateAll(
        (images) => images.some((image) => {
          const element = image as HTMLImageElement;
          return element.complete && element.naturalWidth > 0;
        }),
      ), { timeout: timeoutMs })
      .toBe(true);
    decoded = true;
  } catch {
    timedOut = true;
  }
  const ms = Date.now() - startedAt;
  await window.keyboard.press("Escape");
  await expect(window.locator(".workspace-viewer")).toBeHidden({ timeout: 30_000 }).catch(() => undefined);
  return { ms, decoded, timedOut };
}

test("navigation benchmark on a real library", async () => {
  const readPath = readLibrary!;
  // A fixed profile path makes cold/warm replay possible: run once with a fresh
  // directory, then again on the same directory to compare a cold open against
  // a warm preview cache.
  const fixedUserData = process.env.SERPENT_NAV_BENCH_USER_DATA;
  const temporaryRoot = fixedUserData ?? mkdtempSync(path.join(tmpdir(), "serpent-nav-bench-"));
  const userDataPath = fixedUserData ?? path.join(temporaryRoot, "user-data");
  const seeded = [readPath, secondLibrary, writeLibraryConfirmed()]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  seedRecentLibraries(userDataPath, seeded, readPath);

  const ops: OpSample[] = [];
  const phases: Record<string, unknown> = {};
  const random = mulberry32(0x5eed2026);
  const errors: string[] = [];
  // Declared outside the journey so a crash mid-run still produces a report.
  let rendererProbe: RendererProbe | null = null;
  let log: BenchLogSummary | null = null;
  let summaries: Record<string, unknown> = {};

  const app = await launchBenchmarkApp({ userDataPath, openLibraryPath: readPath });
  try {
    const window: Page = app.window;
    window.on("crash", () => errors.push("renderer crashed"));
    await installRendererProbe(window);
    // A crashed renderer or worker must still leave the measurements collected
    // so far: the log-derived and operation tables are the whole point of a run
    // that takes minutes on a real library.
    try {

    // ------------------------------------------------------------ library open
    const openStartedAt = Date.now();
    await waitForFirstCard(window, 240_000);
    const openFirstCardMs = Date.now() - openStartedAt;
    ops.push({ op: "library.open.first-card", index: 0, ms: openFirstCardMs });
    const openDecode = await waitForVisibleDecoded(window, 0.8, decodeBudgetMs);
    ops.push({
      op: "library.open.coverage-80",
      index: 0,
      ms: openDecode.elapsedMs,
      detail: { coverage: Number(openDecode.stats.coverage.toFixed(3)), timedOut: openDecode.timedOut },
    });
    phases.open = { firstCardMs: openFirstCardMs, coverageMs: openDecode.elapsedMs };

    const scopes = await listNavScopes(window);
    phases.scopes = {
      total: scopes.length,
      folders: scopes.filter((scope) => scope.kind === "folder").length,
      collections: scopes.filter((scope) => scope.kind === "collection").length,
    };

    // ------------------------------------------- busy phase (reconciliation on)
    // The reported regression is "a switch during background work takes about a
    // minute". Measure the first switches while the open reconciliation and the
    // media pump are still running, then repeat after the library settles.
    const busySwitches: ScopeSwitchResult[] = [];
    for (let index = 0; index < Math.min(2, iterations); index += 1) {
      const current = await activeScopeTitle(window);
      const scope = pickScope(scopes, "folder", random, current);
      if (!scope) break;
      const result = await measureScopeSwitch(window, scope, decodeBudgetMs);
      busySwitches.push(result);
      ops.push({
        op: "folder.switch.busy",
        index,
        ms: result.ms,
        detail: { pageMs: result.pageMs, coverageMs: result.coverageMs, coverage: result.coverage },
      });
    }
    const busyWheel = await measureWheel(window, Math.min(wheelMs, 3_000));
    phases.busy = { switches: busySwitches, wheel: busyWheel };

    // ------------------------------------------------- quiet phase (settled)
    if (settleMs > 0) await window.waitForTimeout(settleMs);

    for (let index = 0; index < iterations; index += 1) {
      const current = await activeScopeTitle(window);
      const scope = pickScope(scopes, "folder", random, current);
      if (!scope) break;
      const result = await measureScopeSwitch(window, scope, decodeBudgetMs);
      ops.push({
        op: "folder.switch",
        index,
        ms: result.ms,
        detail: { pageMs: result.pageMs, coverageMs: result.coverageMs, coverage: result.coverage },
      });
    }

    for (let index = 0; index < iterations; index += 1) {
      const current = await activeScopeTitle(window);
      const scope = pickScope(scopes, "collection", random, current);
      if (!scope) break;
      const result = await measureScopeSwitch(window, scope, decodeBudgetMs);
      ops.push({
        op: "collection.switch",
        index,
        ms: result.ms,
        detail: { pageMs: result.pageMs, coverageMs: result.coverageMs, coverage: result.coverage },
      });
    }

    for (let index = 0; index < iterations; index += 1) {
      const jump = await measureJump(window, random, decodeBudgetMs);
      ops.push({
        op: "browse.jump",
        index,
        ms: jump.ms,
        detail: {
          target: jump.ratio,
          coverageMs: jump.coverageMs,
          coverage: jump.coverage,
          timedOut: jump.timedOut,
        },
      });
    }

    const quietWheel = await measureWheel(window, wheelMs);
    phases.wheel = quietWheel;

    for (let index = 0; index < Math.min(3, iterations); index += 1) {
      const viewer = await measureViewerOpen(window, decodeBudgetMs);
      ops.push({
        op: "viewer.open",
        index,
        ms: viewer.ms,
        detail: { decoded: viewer.decoded, timedOut: viewer.timedOut },
      });
    }

    // -------------------------------------------------------- library switch
    if (secondLibrary) {
      const switchStartedAt = Date.now();
      const switcher = window.getByRole("button", { name: `当前资源库 ${path.basename(readPath)}` });
      try {
        await expect(switcher).toBeVisible({ timeout: 30_000 });
        await switcher.click();
        await window.getByRole("menuitem", { name: path.basename(secondLibrary) }).click();
        await expect(
          window.getByRole("button", { name: `当前资源库 ${path.basename(secondLibrary)}` }),
        ).toBeVisible({ timeout: 120_000 });
        const firstCardMs = await waitForFirstCard(window, 120_000);
        const decode = await waitForVisibleDecoded(window, 0.8, decodeBudgetMs);
        ops.push({
          op: "library.switch.first-card",
          index: 0,
          ms: Date.now() - switchStartedAt,
          detail: { firstCardAfterHeaderMs: firstCardMs, coverage: Number(decode.stats.coverage.toFixed(3)) },
        });
        ops.push({ op: "library.switch.coverage-80", index: 0, ms: decode.elapsedMs });
      } catch (error) {
        errors.push(`library switch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // ------------------------------------------------- destructive journey
    if (writeLibraryConfirmed()) {
      // Never assume which library is open: switch to the operator-provided
      // disposable copy first, and skip the whole destructive phase if that
      // switch does not complete.
      const target = writeLibraryConfirmed()!;
      try {
        await switchToLibrary(window, target, 180_000);
        phases.destructive = await runDestructiveJourney(window, ops);
      } catch (error) {
        errors.push(`destructive journey skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // ------------------------------------------------------------- reporting
    } catch (error) {
      errors.push(`journey failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    rendererProbe = await readRendererProbe(window).catch(() => null);
    log = summarizeBenchLog(readSessionLog(userDataPath));
    const byOp = new Map<string, number[]>();
    for (const sample of ops) {
      const list = byOp.get(sample.op) ?? [];
      list.push(sample.ms);
      byOp.set(sample.op, list);
    }
    summaries = Object.fromEntries(
      [...byOp.entries()].map(([op, samples]) => [op, summarizeTimings(samples)]),
    );
    console.info(`NAV_BENCH_SUMMARY ${JSON.stringify({ summaries, errors })}`);
    console.info(`NAV_BENCH_LOG ${JSON.stringify({
      slowestCommands: log.commands.slice(0, 8).map((command) => ({
        type: command.commandType,
        count: command.count,
        waitP95: command.schedulerWaitMs.p95Ms,
        runP95: command.runMs.p95Ms,
        roundTripP95: command.roundTripMs.p95Ms,
        roundTripMax: command.roundTripMs.maxMs,
      })),
      lag: log.lagEvents,
      mainLag: log.mainLagEvents,
      stalls: log.schedulerStalls,
      media: log.mediaWaves,
      reconcile: log.reconcileStages.slice(0, 8),
      openStages: log.openStages.slice(0, 8),
      previewCache: log.previewCache,
    })}`);
  } finally {
    await app.application.close().catch(() => undefined);
    // The report is written even when the journey threw, so a crash still
    // produces the evidence needed to diagnose it.
    writeBenchReport(reportPath, {
      suite: "navigation-perf-benchmark",
      iterations,
      wheelMs,
      settleMs,
      phases,
      ops,
      renderer: rendererProbe,
      log,
      errors,
      summaries,
    });
    if (!fixedUserData) rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

function writeLibraryConfirmed(): string | undefined {
  return writeLibrary && writeConfirmed ? writeLibrary : undefined;
}

/** Switch the open library through the real switcher UI and wait for content. */
async function switchToLibrary(window: Page, libraryPath: string, timeoutMs: number): Promise<void> {
  const targetName = path.basename(libraryPath);
  const switcher = window.getByRole("button", { name: /^当前资源库/u });
  await expect(switcher).toBeVisible({ timeout: 30_000 });
  await switcher.click();
  await window.getByRole("menuitem", { name: targetName }).click();
  await expect(window.getByRole("button", { name: `当前资源库 ${targetName}` }))
    .toBeVisible({ timeout: timeoutMs });
  await waitForFirstCard(window, timeoutMs);
  await window.locator(".library-loading-backdrop").waitFor({ state: "hidden", timeout: timeoutMs }).catch(() => undefined);
}

/** Destructive operations, only ever against an operator-provided copy. */
async function runDestructiveJourney(window: Page, ops: OpSample[]): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = {};
  const collectionInput = window.getByPlaceholder("新建合集");

  // collection create
  try {
    const before = await window.locator(".navigation-pane button.nav-row[data-nav-collection-id]").count();
    const startedAt = Date.now();
    await collectionInput.fill(`bench ${Date.now() % 100000}`);
    await collectionInput.press("Enter");
    await expect
      .poll(() => window.locator(".navigation-pane button.nav-row[data-nav-collection-id]").count(), { timeout: 30_000 })
      .toBeGreaterThan(before);
    ops.push({ op: "collection.create", index: 0, ms: Date.now() - startedAt });
  } catch (error) {
    summary.collectionCreateError = error instanceof Error ? error.message : String(error);
  }

  // folder create (subfolder of the first folder row)
  let createdFolderTitle: string | null = null;
  try {
    const folderRow = window.locator(".navigation-pane button.nav-row[data-nav-folder-kind]").first();
    const before = await window.locator(".navigation-pane button.nav-row[data-nav-folder-kind]").count();
    const startedAt = Date.now();
    await folderRow.click({ button: "right" });
    const menu = window.getByRole("menu");
    await menu.getByRole("menuitem", { name: "新建子文件夹" }).click();
    await expect
      .poll(() => window.locator(".navigation-pane button.nav-row[data-nav-folder-kind]").count(), { timeout: 30_000 })
      .toBeGreaterThan(before);
    ops.push({ op: "folder.create", index: 0, ms: Date.now() - startedAt });
    createdFolderTitle = await window.evaluate(() =>
      document.querySelector<HTMLElement>(".navigation-pane button.nav-row.is-active .nav-row-label")
        ?.textContent?.trim() ?? null,
    );
  } catch (error) {
    summary.folderCreateError = error instanceof Error ? error.message : String(error);
  }

  // asset trash (single visible image card)
  try {
    const card = window.locator(".asset-card[data-media-type='image']").first();
    const before = await window.locator(".asset-card").count();
    const startedAt = Date.now();
    await card.click({ button: "right" });
    await window.getByRole("menuitem", { name: /移入回收站/u }).click();
    await expect
      .poll(() => window.locator(".asset-card").count(), { timeout: 60_000 })
      .toBeLessThan(before);
    ops.push({ op: "asset.trash", index: 0, ms: Date.now() - startedAt, detail: { before } });
  } catch (error) {
    summary.assetTrashError = error instanceof Error ? error.message : String(error);
  }

  // folder delete (the empty folder created above, so no user data is implied)
  if (createdFolderTitle) {
    try {
      const row = window.locator(
        `.navigation-pane button.nav-row[data-nav-folder-kind][data-hover-tip="${createdFolderTitle.replaceAll('"', '\\"')}"]`,
      ).first();
      const before = await window.locator(".navigation-pane button.nav-row[data-nav-folder-kind]").count();
      const startedAt = Date.now();
      await row.click({ button: "right" });
      await window.getByRole("menuitem", { name: "删除" }).click();
      await expect
        .poll(() => window.locator(".navigation-pane button.nav-row[data-nav-folder-kind]").count(), { timeout: 60_000 })
        .toBeLessThan(before);
      ops.push({ op: "folder.delete", index: 0, ms: Date.now() - startedAt, detail: { before } });
    } catch (error) {
      summary.folderDeleteError = error instanceof Error ? error.message : String(error);
    }
  }
  return summary;
}


