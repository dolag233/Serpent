import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statfsSync,
  statSync,
  utimesSync,
} from "node:fs";
import type { ChildProcess } from "node:child_process";
import path from "node:path";

import { expect, test, type ElectronApplication, type Page } from "@playwright/test";

import type { SerpentLibraryApi } from "../../src/shared/library-api";
import {
  installLibraryLifecyclePaintProbe,
  type LibraryLifecyclePaintProbe,
  type LibraryLifecyclePaintProbeSummary,
} from "./real-library-lifecycle-paint-probe";
import {
  launchBenchmarkApp,
  readSessionLog,
  seedRecentLibraries,
  visibleImageStats,
  type VisibleImageStats,
} from "./perf-bench-helpers";
import { waitForLibraryLoadingToFinish } from "./electron-test-helpers";

const sourceRoot = process.env.SERPENT_REAL_LIFECYCLE_SOURCE_ROOT;
const stageTimeoutMs = 60_000;
const wholeJourneyTimeoutMs = 240_000;
const staleBackupControl = process.env.SERPENT_REAL_LIFECYCLE_STALE_BACKUP === "1";

test.skip(!sourceRoot, "Set SERPENT_REAL_LIFECYCLE_SOURCE_ROOT to an authorized real media directory.");
test.setTimeout(wholeJourneyTimeoutMs);

type DecodedViewportResult = {
  firstDecodedMs: number | null;
  ninetyPercentDecodedMs: number | null;
  stats: VisibleImageStats;
};

type MediaCounts = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  paused: number;
  cancelled: number;
};

type LifecycleStage = {
  stage: string;
  count: number;
  totalMs: number;
  maxMs: number;
};

const openStageNames = new Set([
  "path-resolution",
  "storage-classification",
  "migrate",
  "clear-failure",
  "tombstone-backfill",
  "verify",
  "adopt-services",
  "linked-statuses",
  "recover-file-ops",
  "recover-history",
  "recover-ai",
  "recovery-jobs",
  "asset-watcher",
  "watchers",
]);
const closeStageNames = new Set([
  "reconciliation",
  "drainMedia",
  "backup",
  "releaseHandle",
  "total",
]);
const lifecycleCommandTypes = new Set([
  "asset.import-linked",
  "asset.list",
  "asset.thumbnail.visible-window",
  "browse.session.close",
  "browse.session.ids",
  "browse.session.open",
  "browse.session.page",
  "folder.browse-entries",
  "folder.entries",
  "folder.filtered-counts",
  "folder.list",
  "library.close",
  "library.create",
  "library.import-folder",
  "library.list",
  "library.navigation-summary",
  "library.open",
  "media.enqueue-thumbnail-jobs",
  "media.job-summary",
  "media.list-jobs",
  "media.process-thumbnail-queue",
]);

let latestPhase = "unstarted";
function reportPhase(phase: string): void {
  latestPhase = phase;
  console.log("real library lifecycle phase:", phase);
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function within(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function requireSeparateSource(workspace: string, realSource: string): void {
  if (within(workspace, realSource) || within(realSource, workspace)) {
    throw new Error("The read-only source and isolated test catalog must be separate trees.");
  }
}

function assertOwnedDirectory(root: string, candidate: string): string {
  const rootReal = realpathSync(root);
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("The isolated test root is not a regular directory.");
  }
  const candidateInfo = lstatSync(candidate);
  if (!candidateInfo.isDirectory() || candidateInfo.isSymbolicLink()) {
    throw new Error("An isolated test directory is not a regular directory.");
  }
  const candidateReal = realpathSync(candidate);
  if (!within(rootReal, candidateReal)) {
    throw new Error("An isolated test directory escaped its owned root.");
  }
  return candidateReal;
}

/** Age only existing database backups in this test's own library. */
function ageExistingOwnedBackups(root: string, libraryPath: string): number {
  const libraryReal = assertOwnedDirectory(root, libraryPath);
  const metadataPath = path.join(libraryPath, ".serpent");
  const backupDirectory = path.join(metadataPath, "backups");
  if (!existsSync(metadataPath) || !existsSync(backupDirectory)) return 0;
  assertOwnedDirectory(root, metadataPath);
  assertOwnedDirectory(root, backupDirectory);

  // LibraryService.databaseBackupPath uses these two stable backup slots.
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  let aged = 0;
  for (const fileName of ["library.db.1", "library.db.2"]) {
    const backupPath = path.join(backupDirectory, fileName);
    if (!existsSync(backupPath)) continue;
    const fileInfo = lstatSync(backupPath);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || fileInfo.nlink > 1) {
      throw new Error("Refusing to alter a non-owned or linked backup file.");
    }
    const backupReal = realpathSync(backupPath);
    if (!within(libraryReal, backupReal)) {
      throw new Error("A backup file escaped the isolated library.");
    }
    const original = statSync(backupReal);
    utimesSync(backupReal, cutoff / 1000, cutoff / 1000);
    if (original.isFile()) aged += 1;
  }
  return aged;
}

function cleanOwnedCatalog(
  root: string,
  workspace: string,
  children: readonly ChildProcess[],
  launchAttempted: boolean,
): void {
  if (!existsSync(root)) return;
  if (launchAttempted && children.length === 0) {
    throw new Error("The launched app process could not be confirmed; the isolated catalog was retained.");
  }
  if (children.some((child) => child.exitCode === null && child.signalCode === null)) {
    throw new Error("A test app process is still alive; the isolated catalog was retained.");
  }
  const rootInfo = lstatSync(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Refusing to clean an unexpected test root.");
  }
  const rootReal = realpathSync(root);
  if (path.dirname(rootReal) !== workspace) {
    throw new Error("Refusing to clean a test root outside the workspace-owned parent.");
  }
  const verifyNoReparsePoints = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const entryPath = path.join(directory, name);
      const info = lstatSync(entryPath);
      if (info.isSymbolicLink()) throw new Error("Refusing to clean a tree containing a reparse point.");
      if (info.isDirectory()) verifyNoReparsePoints(entryPath);
    }
  };
  verifyNoReparsePoints(root);
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("App process did not exit within the lifecycle phase limit."));
    }, timeoutMs);
    const onExit = (): void => {
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

async function closeApp(
  application: ElectronApplication,
  child: ChildProcess,
): Promise<number> {
  const startedAt = performance.now();
  await application.close();
  await waitForChildExit(child, stageTimeoutMs);
  return elapsedMs(startedAt);
}

async function createLibraryFromUi(
  window: Page,
  displayName: string,
  fromSwitcher: boolean,
): Promise<{ identityReadyMs: number; loadingFinishedMs: number }> {
  const startedAt = performance.now();
  if (fromSwitcher) {
    await window.getByRole("button", { name: /^当前资源库/u }).click();
    await window.getByRole("menuitem", { name: "新建资源库…", exact: true }).click();
  } else {
    await window.getByRole("button", { name: "创建资源库", exact: true }).click();
  }
  await window.getByRole("textbox", { name: "名称", exact: true }).fill(displayName);
  await window.getByRole("button", { name: "创建", exact: true }).click();
  await expect(window.getByRole("button", { name: `当前资源库 ${displayName}` }))
    .toBeVisible({ timeout: stageTimeoutMs });
  const identityReadyMs = elapsedMs(startedAt);
  await waitForLibraryLoadingToFinish(window);
  return { identityReadyMs, loadingFinishedMs: elapsedMs(startedAt) };
}

async function captureOpenedLibraryId(window: Page, displayName: string): Promise<string> {
  const libraryId = await window.evaluate((name) => {
    const state = (globalThis as typeof globalThis & {
      __lifecyclePerfOpenedLibraries?: Array<{ displayName: string; libraryId: string }>;
    }).__lifecyclePerfOpenedLibraries;
    return state?.findLast((entry) => entry.displayName === name)?.libraryId ?? null;
  }, displayName);
  if (!libraryId) throw new Error("The UI library-open event did not provide its in-memory identity.");
  return libraryId;
}

async function installLifecycleCapture(window: Page): Promise<void> {
  await window.evaluate(() => {
    const bridge = globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
      __lifecyclePerfOpenedLibraries?: Array<{ displayName: string; libraryId: string }>;
    };
    const openedLibraries: Array<{ displayName: string; libraryId: string }> = [];
    bridge.__lifecyclePerfOpenedLibraries = openedLibraries;
    bridge.serpent.library.onLifecycle((event) => {
      if (event.type === "library.opened") {
        openedLibraries.push({
          displayName: event.library.displayName,
          libraryId: event.library.libraryId,
        });
      }
    });
  });
}

async function readMediaCounts(window: Page, libraryId: string): Promise<MediaCounts> {
  const result = await window.evaluate(async (id) => {
    const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
    const response = await api.listMediaJobs({ libraryId: id, summaryOnly: true });
    if (!response.ok) throw new Error("Could not read one media-job summary snapshot.");
    const { queued, running, succeeded, failed, paused, cancelled } = response.value;
    return { queued, running, succeeded, failed, paused, cancelled };
  }, libraryId);
  return result;
}

async function clickRecentLibrary(
  window: Page,
  currentName: string,
  targetName: string,
): Promise<{ identityReadyMs: number; loadingFinishedMs: number }> {
  const startedAt = performance.now();
  await window.getByRole("button", { name: `当前资源库 ${currentName}` }).click();
  await window.getByRole("menuitem", { name: targetName, exact: true }).click();
  await expect(window.getByRole("button", { name: `当前资源库 ${targetName}` }))
    .toBeVisible({ timeout: stageTimeoutMs });
  const identityReadyMs = elapsedMs(startedAt);
  await waitForLibraryLoadingToFinish(window);
  return { identityReadyMs, loadingFinishedMs: elapsedMs(startedAt) };
}

async function waitForDecodedViewport(
  window: Page,
  journeyStartedAt: number,
): Promise<DecodedViewportResult> {
  const startedAt = performance.now();
  let firstDecodedMs: number | null = null;
  let ninetyPercentDecodedMs: number | null = null;
  let stats = await visibleImageStats(window);
  while (performance.now() - startedAt < stageTimeoutMs) {
    stats = await visibleImageStats(window);
    if (stats.imageCards > 0 && stats.decodedImages > 0 && firstDecodedMs === null) {
      firstDecodedMs = elapsedMs(journeyStartedAt);
    }
    if (stats.imageCards > 0 && stats.coverage >= 0.9) {
      ninetyPercentDecodedMs = elapsedMs(journeyStartedAt);
      return { firstDecodedMs, ninetyPercentDecodedMs, stats };
    }
    await window.waitForTimeout(50);
  }
  return { firstDecodedMs, ninetyPercentDecodedMs, stats };
}

async function visibleAssetIds(window: Page): Promise<string[]> {
  return window.evaluate(() => [...document.querySelectorAll<HTMLElement>(
    ".workspace-canvas .asset-card[data-asset-id]:not(.is-layout-preview)",
  )]
    .map((card) => card.dataset.assetId ?? "")
    .filter((id) => id.length > 0 && !id.startsWith("__pending:")));
}

function summarizeLifecycleLog(logText: string): {
  open: { status: "observed" | "unobserved"; stages: LifecycleStage[] };
  close: { status: "observed" | "unobserved"; stages: LifecycleStage[] };
  workerExitDuringShutdown: "observed" | "unobserved";
} {
  const open = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  const close = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  let workerExitDuringShutdownObserved = false;
  const record = (map: typeof open, stage: string, milliseconds: unknown): void => {
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value < 0) return;
    const previous = map.get(stage) ?? { count: 0, totalMs: 0, maxMs: 0 };
    previous.count += 1;
    previous.totalMs += value;
    previous.maxMs = Math.max(previous.maxMs, value);
    map.set(stage, previous);
  };
  for (const line of logText.split(/\r?\n/u)) {
    let rawWorkerMessage: string | null = null;
    if (line.startsWith("[library.close.phase] ")) rawWorkerMessage = line;
    if (line.trimStart().startsWith("{")) {
      try {
        const envelope = JSON.parse(line) as {
          scope?: unknown;
          message?: unknown;
          context?: unknown;
        };
        const context = typeof envelope.context === "object" && envelope.context !== null
          ? envelope.context as Record<string, unknown>
          : {};
        if (envelope.scope === "open.stage") {
          const stage = context.stage;
          if (typeof stage === "string" && openStageNames.has(stage)) {
            record(open, stage, context.durationMs);
          }
        } else if (envelope.scope === "worker.stderr" && typeof envelope.message === "string") {
          rawWorkerMessage = envelope.message;
        } else if (envelope.scope === "worker.exit") {
          workerExitDuringShutdownObserved = envelope.message === "Library Worker exited during shutdown.";
        }
      } catch {
        // Ignore non-structured lines; never copy raw diagnostics to the report.
      }
    }
    const closePrefix = "[library.close.phase] ";
    if (rawWorkerMessage?.startsWith(closePrefix)) {
      try {
        const event = JSON.parse(rawWorkerMessage.slice(closePrefix.length)) as {
          phase?: unknown;
          ms?: unknown;
        };
        if (typeof event.phase === "string" && closeStageNames.has(event.phase)) {
          record(close, event.phase, event.ms);
        }
      } catch {
        // Ignore truncated close diagnostics; unobserved is reported if none remain.
      }
    }
  }
  const stages = (map: typeof open): LifecycleStage[] => [...map.entries()]
    .map(([stage, value]) => ({
      stage,
      count: value.count,
      totalMs: Math.round(value.totalMs),
      maxMs: Math.round(value.maxMs),
    }));
  const openStages = stages(open);
  const closeStages = stages(close);
  return {
    open: { status: openStages.length > 0 ? "observed" : "unobserved", stages: openStages },
    close: { status: closeStages.length > 0 ? "observed" : "unobserved", stages: closeStages },
    workerExitDuringShutdown: workerExitDuringShutdownObserved ? "observed" : "unobserved",
  };
}

type WorkerCommandWindow = {
  status: "observed" | "unobserved";
  windowMs: number;
  commands: Array<{
    commandType: string;
    count: number;
    maxRunMs: number | null;
    maxQueueMs: number | null;
    maxSchedulerWaitMs: number | null;
    maxRoundTripMs: number | null;
  }>;
};

function summarizeWorkerCommandWindow(
  logText: string,
  startedAtEpochMs: number,
  endedAtEpochMs: number,
): WorkerCommandWindow {
  type WorkerCommand = {
    commandType: string;
    queueMs: number | null;
    schedulerWaitMs: number | null;
    runMs: number | null;
    roundTripMs: number | null;
  };
  type CommandTotals = {
    commandType: string;
    count: number;
    runMs: number[];
    queueMs: number[];
    schedulerWaitMs: number[];
    roundTripMs: number[];
  };
  const commandsByRequestId = new Map<string, WorkerCommand>();
  const roundTripsByRequestId = new Map<string, number>();
  const finiteNumberOrNull = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const timestampEpochMs = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const isWithinWindow = (timestampValue: unknown): boolean => {
    const timestamp = timestampEpochMs(timestampValue);
    return timestamp !== null && timestamp >= startedAtEpochMs && timestamp <= endedAtEpochMs;
  };

  for (const line of logText.split(/\r?\n/u)) {
    if (!line.trimStart().startsWith("{")) continue;
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof envelope.timestamp !== "string") continue;
    const context = typeof envelope.context === "object" && envelope.context !== null
      ? envelope.context as Record<string, unknown>
      : {};
    if (envelope.scope === "worker.cmd" && isWithinWindow(context.timestamp ?? envelope.timestamp)) {
      const commandType = typeof context.type === "string" ? context.type : "";
      const requestId = typeof context.requestId === "string" ? context.requestId : "";
      if (!requestId || !lifecycleCommandTypes.has(commandType)) continue;
      commandsByRequestId.set(requestId, {
        commandType,
        queueMs: finiteNumberOrNull(context.queueMs),
        schedulerWaitMs: finiteNumberOrNull(context.schedulerWaitMs),
        runMs: finiteNumberOrNull(context.runMs),
        roundTripMs: null,
      });
    } else if (
      envelope.scope === "worker.cmd.roundtrip"
      && isWithinWindow(context.completedAtEpochMs ?? envelope.timestamp)
    ) {
      const commandType = typeof context.commandType === "string" ? context.commandType : "";
      const requestId = typeof context.requestId === "string" ? context.requestId : "";
      const roundTripMs = finiteNumberOrNull(context.roundTripMs ?? context.totalMs);
      if (!requestId || !lifecycleCommandTypes.has(commandType) || roundTripMs === null) continue;
      roundTripsByRequestId.set(requestId, roundTripMs);
    }
  }

  const totals = new Map<string, CommandTotals>();
  for (const [requestId, command] of commandsByRequestId) {
    const roundTripMs = roundTripsByRequestId.get(requestId) ?? null;
    const entry = totals.get(command.commandType) ?? {
      commandType: command.commandType,
      count: 0,
      runMs: [],
      queueMs: [],
      schedulerWaitMs: [],
      roundTripMs: [],
    };
    entry.count += 1;
    if (command.runMs !== null) entry.runMs.push(command.runMs);
    if (command.queueMs !== null) entry.queueMs.push(command.queueMs);
    if (command.schedulerWaitMs !== null) entry.schedulerWaitMs.push(command.schedulerWaitMs);
    if (roundTripMs !== null) entry.roundTripMs.push(roundTripMs);
    totals.set(command.commandType, entry);
  }
  const maximum = (values: number[]): number | null => values.length > 0 ? Math.max(...values) : null;
  const commands = [...totals.values()]
    .map((entry) => ({
      commandType: entry.commandType,
      count: entry.count,
      maxRunMs: maximum(entry.runMs),
      maxQueueMs: maximum(entry.queueMs),
      maxSchedulerWaitMs: maximum(entry.schedulerWaitMs),
      maxRoundTripMs: maximum(entry.roundTripMs),
    }))
    .sort((left, right) => {
      const score = (entry: typeof left): number => Math.max(
        entry.maxRunMs ?? -1,
        entry.maxQueueMs ?? -1,
        entry.maxSchedulerWaitMs ?? -1,
        entry.maxRoundTripMs ?? -1,
      );
      return score(right) - score(left);
    })
    .slice(0, 5);
  return {
    status: commands.length > 0 ? "observed" : "unobserved",
    windowMs: Math.max(0, endedAtEpochMs - startedAtEpochMs),
    commands,
  };
}

async function expectDecodedViewport(
  window: Page,
  journeyStartedAt: number,
): Promise<DecodedViewportResult> {
  const decoded = await waitForDecodedViewport(window, journeyStartedAt);
  expect(decoded.stats.imageCards).toBeGreaterThan(0);
  expect(decoded.stats.decodedImages).toBeGreaterThan(0);
  expect(decoded.stats.coverage).toBeGreaterThanOrEqual(0.9);
  return decoded;
}

test("opens, switches, and fully restarts a real linked-media library", async () => {
  if (!sourceRoot || !existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new Error("The authorized real source directory is unavailable.");
  }
  const workspace = realpathSync(process.cwd());
  const resolvedSource = realpathSync(sourceRoot);
  requireSeparateSource(workspace, resolvedSource);
  const freeBytes = statfsSync(workspace).bavail * statfsSync(workspace).bsize;
  if (freeBytes < 4 * 1024 ** 3) throw new Error("Insufficient free space for an isolated large catalog.");

  const root = mkdtempSync(path.join(workspace, ".tmp-real-library-lifecycle-"));
  const profilePath = path.join(root, "profile");
  const alphaPath = path.join(root, "LifecycleAlpha");
  const controlPath = path.join(root, "LifecycleControl");
  const children: ChildProcess[] = [];
  let application: ElectronApplication | undefined;
  let activePaintProbe: LibraryLifecyclePaintProbe | undefined;
  let launchAttempted = false;
  let result: Record<string, unknown> | undefined;

  try {
    launchAttempted = true;
    let stageStartedAt = performance.now();
    const firstLaunch = await launchBenchmarkApp({
      userDataPath: profilePath,
      extraEnv: {
        SERPENT_E2E_HIDE_WINDOW: "1",
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_LINKED_SOURCE: resolvedSource,
      },
    });
    application = firstLaunch.application;
    let child = application.process();
    children.push(child);
    const window = firstLaunch.window;
    await window.setViewportSize({ width: 1440, height: 1000 });
    await installLifecycleCapture(window);

    const alphaCreateMilestones = await createLibraryFromUi(window, "LifecycleAlpha", false);
    expect(existsSync(alphaPath)).toBe(true);
    const alphaId = await captureOpenedLibraryId(window, "LifecycleAlpha");
    const createdAlphaMs = elapsedMs(stageStartedAt);
    reportPhase("alpha-created");

    stageStartedAt = performance.now();
    const imported = await window.evaluate(async (libraryId) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
      const response = await api.importFolderAsLinked({ libraryId, displayName: "LinkedMedia" });
      if (!response.ok) throw new Error(`Linked-source ingestion failed (${response.error.code}).`);
      return response.value.assetCount;
    }, alphaId);
    const linkImportMs = elapsedMs(stageStartedAt);
    expect(imported).toBeGreaterThan(10_000);
    reportPhase("alpha-imported");

    stageStartedAt = performance.now();
    await window.getByRole("button", { name: "所有资产", exact: true }).click();
    await expect(window.locator(".workspace-canvas .asset-card").first()).toBeVisible({ timeout: stageTimeoutMs });
    const initialAlphaDecoded = await expectDecodedViewport(window, stageStartedAt);
    reportPhase("alpha-decoded");
    const initialAlphaIds = new Set(await visibleAssetIds(window));
    const alphaMediaJobs = await readMediaCounts(window, alphaId);

    stageStartedAt = performance.now();
    const controlCreateWindowStartedAt = Date.now();
    const controlCreateMilestones = await createLibraryFromUi(window, "LifecycleControl", true);
    expect(existsSync(controlPath)).toBe(true);
    const controlId = await captureOpenedLibraryId(window, "LifecycleControl");
    await expect(window.locator(".workspace-canvas .asset-card")).toHaveCount(0, { timeout: stageTimeoutMs });
    const controlCreateWindowEndedAt = Date.now();
    const controlCreateWorkerCommands = summarizeWorkerCommandWindow(
      readSessionLog(profilePath),
      controlCreateWindowStartedAt,
      controlCreateWindowEndedAt,
    );
    const createdControlMs = elapsedMs(stageStartedAt);
    const controlMediaJobs = await readMediaCounts(window, controlId);
    reportPhase("control-created");

    const stagingCloseMs = await closeApp(application, child);
    application = undefined;
    reportPhase("staging-exited");
    const stagingLifecycleLog = readSessionLog(profilePath);
    // Write the active recent-library target only after the running Main process
    // has exited, so shutdown persistence cannot overwrite this test seed.
    seedRecentLibraries(profilePath, [alphaPath, controlPath], alphaPath);
    let backupAgeResult: { backupAgeControl: string; backupFiles: number } | undefined;
    if (staleBackupControl) {
      const backupFiles = ageExistingOwnedBackups(root, alphaPath);
      backupAgeResult = {
        backupAgeControl: backupFiles > 0 ? "aged-owned-existing" : "no-existing-backup-already-due",
        backupFiles,
      };
    }

    stageStartedAt = performance.now();
    launchAttempted = true;
    const reopened = await launchBenchmarkApp({
      userDataPath: profilePath,
      extraEnv: {
        SERPENT_E2E_HIDE_WINDOW: "1",
        SERPENT_E2E_CREATE_PARENT_PATH: root,
      },
    });
    application = reopened.application;
    child = application.process();
    children.push(child);
    const reopenedWindow = reopened.window;
    await reopenedWindow.setViewportSize({ width: 1440, height: 1000 });
    reportPhase("restarted");
    await expect(reopenedWindow.getByRole("button", { name: "当前资源库 LifecycleAlpha" }))
      .toBeVisible({ timeout: stageTimeoutMs });
    reportPhase("restart-identity-ready");
    const coldOpenIdentityReadyMs = elapsedMs(stageStartedAt);
    await waitForLibraryLoadingToFinish(reopenedWindow);
    const coldOpenLoadingFinishedMs = elapsedMs(stageStartedAt);
    await reopenedWindow.getByRole("button", { name: "所有资产", exact: true }).click();
    await expect(reopenedWindow.locator(".workspace-canvas .asset-card").first())
      .toBeVisible({ timeout: stageTimeoutMs });
    const coldOpenDecoded = await expectDecodedViewport(reopenedWindow, stageStartedAt);
    reportPhase("restart-decoded");
    const restartedAlphaIds = new Set(await visibleAssetIds(reopenedWindow));
    expect([...restartedAlphaIds].some((id) => initialAlphaIds.has(id))).toBe(true);
    const coldOpenMs = elapsedMs(stageStartedAt);

    activePaintProbe = await installLibraryLifecyclePaintProbe(reopenedWindow);
    await activePaintProbe.start({ targetLibraryName: "LifecycleControl", expectedAssetIds: [] });
    stageStartedAt = performance.now();
    const alphaToControlWindowStartedAt = Date.now();
    const alphaToControlMilestones = await clickRecentLibrary(
      reopenedWindow,
      "LifecycleAlpha",
      "LifecycleControl",
    );
    await expect(reopenedWindow.locator(".workspace-canvas .asset-card"))
      .toHaveCount(0, { timeout: stageTimeoutMs });
    await activePaintProbe.markActionCompleted();
    const alphaToControlPaint = await activePaintProbe.stop();
    activePaintProbe = undefined;
    expect(alphaToControlPaint.identityReadyMs).not.toBeNull();
    expect(alphaToControlPaint.visibleTargetCards).toBe(0);
    const alphaToControlWindowEndedAt = Date.now();
    const controlEmptyMs = elapsedMs(stageStartedAt);
    reportPhase("switched-to-control");

    activePaintProbe = await installLibraryLifecyclePaintProbe(reopenedWindow);
    await activePaintProbe.start({
      targetLibraryName: "LifecycleAlpha",
      expectedAssetIds: [...initialAlphaIds],
    });
    stageStartedAt = performance.now();
    const controlToAlphaWindowStartedAt = Date.now();
    const controlToAlphaMilestones = await clickRecentLibrary(
      reopenedWindow,
      "LifecycleControl",
      "LifecycleAlpha",
    );
    await reopenedWindow.getByRole("button", { name: "所有资产", exact: true }).click();
    await activePaintProbe.markActionCompleted();
    await expect(reopenedWindow.locator(".workspace-canvas .asset-card").first())
      .toBeVisible({ timeout: stageTimeoutMs });
    const returnedAlphaDecoded = await expectDecodedViewport(reopenedWindow, stageStartedAt);
    const returnedAlphaIds = new Set(await visibleAssetIds(reopenedWindow));
    expect([...returnedAlphaIds].some((id) => initialAlphaIds.has(id))).toBe(true);
    const controlToAlphaPaint = await activePaintProbe.stop();
    activePaintProbe = undefined;
    expect(controlToAlphaPaint.identityReadyMs).not.toBeNull();
    expect(controlToAlphaPaint.firstTargetCardMs).not.toBeNull();
    expect(controlToAlphaPaint.firstDecodedMs).not.toBeNull();
    expect(controlToAlphaPaint.ninetyPercentDecodedMs).not.toBeNull();
    expect(controlToAlphaPaint.coverage).toBeGreaterThanOrEqual(0.9);
    expect(controlToAlphaPaint.visibleImageCards).toBeGreaterThan(0);
    const controlToAlphaWindowEndedAt = Date.now();
    const alphaReturnMs = elapsedMs(stageStartedAt);
    reportPhase("returned-to-alpha");

    const finalOpenCount = await reopenedWindow.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
      const response = await api.listOpen();
      if (!response.ok) throw new Error("Could not read the final open-library count.");
      return response.value.length;
    });
    const finalCloseMs = await closeApp(application, child);
    application = undefined;
    reportPhase("final-exited");
    const finalLifecycleLog = readSessionLog(profilePath);
    const stagingStages = summarizeLifecycleLog(stagingLifecycleLog);
    const reopenedStages = summarizeLifecycleLog(finalLifecycleLog);
    result = {
      sourceAssetCount: imported,
      timingsMs: {
        alphaCreate: createdAlphaMs,
        alphaCreateIdentityReady: alphaCreateMilestones.identityReadyMs,
        alphaCreateLoadingFinished: alphaCreateMilestones.loadingFinishedMs,
        linkedImport: linkImportMs,
        controlCreate: createdControlMs,
        controlCreateIdentityReady: controlCreateMilestones.identityReadyMs,
        controlCreateLoadingFinished: controlCreateMilestones.loadingFinishedMs,
        stagingFullExit: stagingCloseMs,
        linkedFirstDecode: initialAlphaDecoded.firstDecodedMs,
        linkedNinetyPercentDecode: initialAlphaDecoded.ninetyPercentDecodedMs,
        coldOpenFirstDecode: coldOpenDecoded.firstDecodedMs,
        coldOpenToNinetyPercent: coldOpenDecoded.ninetyPercentDecodedMs,
        coldOpenIdentityReady: coldOpenIdentityReadyMs,
        coldOpenLoadingFinished: coldOpenLoadingFinishedMs,
        coldOpenComplete: coldOpenMs,
        alphaToControlIdentityReady: alphaToControlMilestones.identityReadyMs,
        alphaToControlLoadingFinished: alphaToControlMilestones.loadingFinishedMs,
        alphaToControlEmpty: controlEmptyMs,
        controlToAlphaIdentityReady: controlToAlphaMilestones.identityReadyMs,
        controlToAlphaLoadingFinished: controlToAlphaMilestones.loadingFinishedMs,
        controlToAlphaFirstDecode: returnedAlphaDecoded.firstDecodedMs,
        controlToAlphaNinetyPercent: returnedAlphaDecoded.ninetyPercentDecodedMs,
        controlToAlphaComplete: alphaReturnMs,
        finalFullExit: finalCloseMs,
      },
      measurementNotes: {
        priorWallClockSwitchMetrics: "post-action-observation-upper-bound",
        viewportProbe: "DOM-ready-and-decoded-on-RAF; not compositor paint",
      },
      decode: {
        linkedFirstViewport: initialAlphaDecoded.stats,
        coldOpenViewport: coldOpenDecoded.stats,
        returnedAlphaViewport: returnedAlphaDecoded.stats,
      },
      viewportProbe: {
        alphaToControl: alphaToControlPaint,
        controlToAlpha: controlToAlphaPaint,
      } satisfies Record<string, LibraryLifecyclePaintProbeSummary>,
      mediaJobs: { alpha: alphaMediaJobs, control: controlMediaJobs },
      controlCanvasWasEmpty: true,
      coldOpenReusedAlphaAssetIdentity: [...restartedAlphaIds].some((id) => initialAlphaIds.has(id)),
      menuReturnReusedAlphaAssetIdentity: [...returnedAlphaIds].some((id) => initialAlphaIds.has(id)),
      finalOpenLibraryCount: finalOpenCount,
      lifecycleLogs: {
        afterStagingExit: stagingStages,
        afterColdRestartAndFinalExit: reopenedStages,
      },
      workerCommandsByAction: {
        controlCreate: controlCreateWorkerCommands,
        alphaToControl: summarizeWorkerCommandWindow(
          finalLifecycleLog,
          alphaToControlWindowStartedAt,
          alphaToControlWindowEndedAt,
        ),
        controlToAlpha: summarizeWorkerCommandWindow(
          finalLifecycleLog,
          controlToAlphaWindowStartedAt,
          controlToAlphaWindowEndedAt,
        ),
      },
      shutdownEvidence: {
        afterStagingExit: {
          applicationProcessExitObserved: true,
          workerExitDuringShutdown: stagingStages.workerExitDuringShutdown,
          // worker-client.shutdown logs neither ACK receipt nor timeout-then-kill; exit alone cannot distinguish them.
          acknowledgement: "unobserved",
          timeoutKill: "unobserved",
        },
        afterColdRestartAndFinalExit: {
          applicationProcessExitObserved: true,
          workerExitDuringShutdown: reopenedStages.workerExitDuringShutdown,
          acknowledgement: "unobserved",
          timeoutKill: "unobserved",
        },
      },
      ...(backupAgeResult === undefined ? {} : { backupAgeControl: backupAgeResult }),
    };
  } catch (error) {
    let viewport: Record<string, unknown> = { status: "unobserved" };
    const page = application?.windows()[0];
    if (page) {
      viewport = await page.evaluate(() => ({
        status: "observed",
        alphaIdentity: document.querySelector(".library-switcher-name")?.textContent?.trim() === "LifecycleAlpha",
        controlIdentity: document.querySelector(".library-switcher-name")?.textContent?.trim() === "LifecycleControl",
        cards: document.querySelectorAll(".workspace-canvas .asset-card").length,
        layoutSlots: document.querySelectorAll(".workspace-canvas [data-layout-index]").length,
        pendingCards: document.querySelectorAll('.workspace-canvas [data-asset-id^="__pending:"]').length,
        localConfirmation: document.querySelector("#local-confirmation-dialog") !== null,
      })).catch(() => ({ status: "unobserved" }));
    }
    const log = readSessionLog(profilePath);
    const healthScopes = new Set([
      "worker.spawn", "worker.exit", "renderer.console.error",
      "renderer.process-gone", "renderer.unresponsive", "renderer.child-process-gone",
    ]);
    const healthEvents = log.split(/\r?\n/u).flatMap((line) => {
      try {
        const record = JSON.parse(line) as { scope?: string; context?: { code?: unknown } };
        if (!record.scope || !healthScopes.has(record.scope)) return [];
        return [{ scope: record.scope,
          exitCode: record.scope === "worker.exit" && typeof record.context?.code === "number"
            ? record.context.code : null }];
      } catch { return []; }
    }).slice(-15);
    console.log("real library lifecycle failure:", JSON.stringify({
      phase: latestPhase, viewport, healthEvents,
      lifecycle: summarizeLifecycleLog(log),
      recentWorkerCommands: summarizeWorkerCommandWindow(log, Date.now() - 65_000, Date.now()),
    }));
    throw error;
  } finally {
    await activePaintProbe?.stop().catch(() => undefined);
    if (application) {
      const child = application.process();
      await application.close();
      await waitForChildExit(child, stageTimeoutMs);
    }
    cleanOwnedCatalog(root, workspace, children, launchAttempted);
  }

  if (!result) throw new Error("The lifecycle performance journey produced no result.");
  console.log("real library lifecycle performance:", JSON.stringify(result));
});
