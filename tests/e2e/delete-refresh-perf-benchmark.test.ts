import { accessSync, constants, existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  installRendererProbe,
  launchBenchmarkApp,
  readRendererProbe,
  readSessionLog,
  resetRendererCounters,
  seedRecentLibraries,
  summarizeBenchLog,
  visibleImageStats,
  waitForVisibleDecoded,
  writeBenchReport,
  type RendererProbe,
} from "./perf-bench-helpers";
import { chooseStandardOption } from "./electron-test-helpers";

/**
 * Operator-run diagnostic for visible asset deletion geometry and folder
 * create/delete refresh. It only opens a separately copied library and never
 * removes that copy. The only mutations are restored in `finally`.
 */
const sourceLibrary = process.env.SERPENT_DELETE_PERF_SOURCE_LIBRARY;
const writeLibrary = process.env.SERPENT_DELETE_PERF_WRITE_LIBRARY;
const reportPath = process.env.SERPENT_DELETE_PERF_OUT;
const confirmation = "I_CONFIRM_ISOLATED_COPY_WRITES";
const decodeBudgetMs = Number(process.env.SERPENT_DELETE_PERF_DECODE_BUDGET_MS ?? 15_000);
const confirmationEnv = process.env.SERPENT_DELETE_PERF_CONFIRM;
const recoveryAssetId = process.env.SERPENT_DELETE_PERF_RECOVER_ASSET_ID;
const recoveryFolderId = process.env.SERPENT_DELETE_PERF_RECOVER_FOLDER_ID;

test.describe.configure({ timeout: 240_000 });
test.skip(!sourceLibrary || !writeLibrary, "Set source and isolated write library paths for this diagnostic.");

type RefreshKind = "asset.trash" | "folder.create" | "folder.delete";

type RefreshProbeResult = {
  firstSettle: {
    firstVisibleMs: number | null;
    layoutStableMs: number | null;
    geometry: GeometrySummary | null;
  };
  delayedReconcile: {
    observationMs: number | null;
    changedAfterFirstSettle: boolean;
    firstChangeMsAfterSettle: number | null;
    stableAgainMsAfterChange: number | null;
    changedSamples: number;
    assetsMoved: number;
    maxAssetShiftPx: number;
    foldersMoved: number;
    maxFolderShiftPx: number;
    longTaskCount: number;
    longTaskMaxMs: number;
  };
};

type WorkerCommandTiming = {
  type: string;
  count: number;
  queueP95Ms: number;
  schedulerWaitP95Ms: number;
  runP95Ms: number;
  roundTripP95Ms: number;
};

type GeometrySummary = {
  assetsBefore: number;
  assetsAfter: number;
  assetsMoved: number;
  maxAssetShiftPx: number;
  foldersBefore: number;
  foldersAfter: number;
  foldersMoved: number;
  maxFolderShiftPx: number;
};

type DiagnosticOperation = Omit<RefreshProbeResult, "delayedReconcile"> & {
  delayedReconcile: RefreshProbeResult["delayedReconcile"] & {
    workerCommands: WorkerCommandTiming[];
  };
  op: RefreshKind;
  visibleImageCards: number;
  visibleImageCoverage: number;
  actionToDecodedMs: number | null;
  decodeTimedOut: boolean | null;
  renderer: Pick<RendererProbe,
    "longTaskCount" | "longTaskMaxMs" | "longTaskTotalMs" | "frameSamples" | "frameP95Ms" | "frameMaxMs"
  >;
  workerCommands: WorkerCommandTiming[];
};

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * Require a physical copy: the source and target must be disjoint, and the
 * target may not contain symbolic links or files with multiple hard links.
 */
function validateIsolatedCopy(sourcePath: string, targetPath: string): string {
  if (confirmationEnv !== confirmation) {
    throw new Error("Set SERPENT_DELETE_PERF_CONFIRM to the documented confirmation value.");
  }
  if (!existsSync(sourcePath) || !existsSync(targetPath)) {
    throw new Error("Both configured library directories must already exist.");
  }
  const sourceRealPath = realpathSync(sourcePath);
  const targetRealPath = realpathSync(targetPath);
  if (!lstatSync(sourceRealPath).isDirectory() || !lstatSync(targetRealPath).isDirectory()) {
    throw new Error("Both configured library paths must be directories.");
  }
  if (isWithin(sourceRealPath, targetRealPath) || isWithin(targetRealPath, sourceRealPath)) {
    throw new Error("The source and writable library must be separate directories.");
  }
  const sourceDatabase = path.join(sourceRealPath, ".serpent", "library.db");
  const targetDatabase = path.join(targetRealPath, ".serpent", "library.db");
  const sourceAssets = path.join(sourceRealPath, "Assets");
  const targetAssets = path.join(targetRealPath, "Assets");
  if (!existsSync(sourceDatabase) || !existsSync(targetDatabase)
    || !existsSync(sourceAssets) || !existsSync(targetAssets)
    || !lstatSync(sourceAssets).isDirectory() || !lstatSync(targetAssets).isDirectory()) {
    throw new Error("Both configured directories must contain a Serpent library database.");
  }
  try {
    accessSync(targetRealPath, constants.W_OK);
    accessSync(path.dirname(targetDatabase), constants.W_OK);
  } catch {
    throw new Error("The configured writable library must be writable on this device.");
  }

  const pending = [targetRealPath];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("The writable library copy must not contain symbolic links.");
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && lstatSync(entryPath).nlink > 1) {
        throw new Error("The writable library copy must not contain hard-linked files.");
      }
    }
  }
  return targetRealPath;
}

/** Install a renderer-only observer for first visible update and stable layout. */
async function installRefreshProbe(window: Page): Promise<void> {
  await window.evaluate(() => {
    type Box = { key: string; x: number; y: number; width: number; height: number };
    type Snapshot = { assets: Box[]; folders: Box[] };
    type State = {
      kind: RefreshKind;
      assetId?: string;
      folderId?: string;
      folderName?: string;
      startedAt: number;
      firstAt: number | null;
      stableAt: number | null;
      observationCompletedAt: number | null;
      baseline: Snapshot;
      firstSnapshot: Snapshot | null;
      finalSnapshot: Snapshot | null;
      previous: Snapshot | null;
      stableFrames: number;
      delayedFirstChangeAt: number | null;
      delayedStableAt: number | null;
      delayedPrevious: Snapshot | null;
      delayedStableFrames: number;
      changedSamples: number;
      delayedAssetsMoved: number;
      delayedMaxAssetShiftPx: number;
      delayedFoldersMoved: number;
      delayedMaxFolderShiftPx: number;
      delayedLongTasks: number[];
      observer: MutationObserver | null;
      longTaskObserver: PerformanceObserver | null;
    };

    const globals = globalThis as typeof globalThis & {
      __serpentDeleteRefreshProbe?: {
        begin(input: { kind: RefreshKind; assetId?: string; folderId?: string; folderName?: string }): void;
        read(): RefreshProbeResult;
        state: State | null;
      };
    };

    const snapshot = (): Snapshot => {
      const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
      const visibleAssets = [...document.querySelectorAll<HTMLElement>(".asset-card[data-asset-id]")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          if (!canvas) return false;
          const bounds = canvas.getBoundingClientRect();
          return rect.bottom > bounds.top && rect.top < bounds.bottom
            && rect.right > bounds.left && rect.left < bounds.right;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            key: element.dataset.assetId ?? "",
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          };
        });
      const visibleFolders = [...document.querySelectorAll<HTMLElement>(
        ".navigation-pane button.nav-row[data-nav-folder-id]",
      )].filter((element) => element.getClientRects().length > 0).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          key: element.dataset.navFolderId ?? "",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
      return { assets: visibleAssets, folders: visibleFolders };
    };

    const sameLayout = (left: Snapshot, right: Snapshot): boolean => {
      const sameBoxes = (a: Box[], b: Box[]) => a.length === b.length && a.every((item, index) => {
        const other = b[index];
        return other?.key === item.key
          && Math.abs(item.x - other.x) <= 0.5
          && Math.abs(item.y - other.y) <= 0.5
          && Math.abs(item.width - other.width) <= 0.5
          && Math.abs(item.height - other.height) <= 0.5;
      });
      return sameBoxes(left.assets, right.assets) && sameBoxes(left.folders, right.folders);
    };

    const diff = (before: Box[], after: Box[]) => {
      const afterById = new Map(after.map((box) => [box.key, box]));
      let moved = 0;
      let maxShift = 0;
      for (const box of before) {
        const next = afterById.get(box.key);
        if (!next) continue;
        const shift = Math.max(Math.abs(next.x - box.x), Math.abs(next.y - box.y));
        if (shift > 0.5) moved += 1;
        maxShift = Math.max(maxShift, shift);
      }
      return { moved, maxShift: Number(maxShift.toFixed(2)) };
    };

    const read = (): RefreshProbeResult => {
      const state = globals.__serpentDeleteRefreshProbe?.state;
      if (!state) {
        return {
          firstSettle: { firstVisibleMs: null, layoutStableMs: null, geometry: null },
          delayedReconcile: {
            observationMs: null,
            changedAfterFirstSettle: false,
            firstChangeMsAfterSettle: null,
            stableAgainMsAfterChange: null,
            changedSamples: 0,
            assetsMoved: 0,
            maxAssetShiftPx: 0,
            foldersMoved: 0,
            maxFolderShiftPx: 0,
            longTaskCount: 0,
            longTaskMaxMs: 0,
          },
        };
      }
      const finalSnapshot = state.finalSnapshot;
      const baseline = state.baseline;
      const finalAssets = finalSnapshot?.assets ?? [];
      const finalFolders = finalSnapshot?.folders ?? [];
      const assetDiff = diff(baseline.assets, finalAssets);
      const folderDiff = diff(baseline.folders, finalFolders);
      const stableAt = state.stableAt;
      const delayedFirstChangeAt = state.delayedFirstChangeAt;
      const delayedLongTasks = stableAt === null
        ? []
        : state.delayedLongTasks.filter((duration) => duration > 0);
      return {
        firstSettle: {
          firstVisibleMs: state.firstAt === null ? null : Number((state.firstAt - state.startedAt).toFixed(2)),
          layoutStableMs: stableAt === null ? null : Number((stableAt - state.startedAt).toFixed(2)),
          geometry: finalSnapshot === null ? null : {
            assetsBefore: baseline.assets.length,
            assetsAfter: finalAssets.length,
            assetsMoved: assetDiff.moved,
            maxAssetShiftPx: assetDiff.maxShift,
            foldersBefore: baseline.folders.length,
            foldersAfter: finalFolders.length,
            foldersMoved: folderDiff.moved,
            maxFolderShiftPx: folderDiff.maxShift,
          },
        },
        delayedReconcile: {
          observationMs: stableAt === null || state.observationCompletedAt === null
            ? null
            : Number((state.observationCompletedAt - stableAt).toFixed(2)),
          changedAfterFirstSettle: delayedFirstChangeAt !== null,
          firstChangeMsAfterSettle: delayedFirstChangeAt === null || stableAt === null
            ? null
            : Number((delayedFirstChangeAt - stableAt).toFixed(2)),
          stableAgainMsAfterChange: state.delayedStableAt === null
            || delayedFirstChangeAt === null
            ? null
            : Number((state.delayedStableAt - delayedFirstChangeAt).toFixed(2)),
          changedSamples: state.changedSamples,
          assetsMoved: state.delayedAssetsMoved,
          maxAssetShiftPx: Number(state.delayedMaxAssetShiftPx.toFixed(2)),
          foldersMoved: state.delayedFoldersMoved,
          maxFolderShiftPx: Number(state.delayedMaxFolderShiftPx.toFixed(2)),
          longTaskCount: delayedLongTasks.length,
          longTaskMaxMs: Number(Math.max(0, ...delayedLongTasks).toFixed(2)),
        },
      };
    };

    const probe = {
      state: null as State | null,
      begin(input: { kind: RefreshKind; assetId?: string; folderId?: string; folderName?: string }) {
        this.state?.observer?.disconnect();
        this.state?.longTaskObserver?.disconnect();
        const state: State = {
          ...input,
          startedAt: performance.now(),
          firstAt: null,
          stableAt: null,
          observationCompletedAt: null,
          baseline: snapshot(),
          firstSnapshot: null,
          finalSnapshot: null,
          previous: null,
          stableFrames: 0,
          delayedFirstChangeAt: null,
          delayedStableAt: null,
          delayedPrevious: null,
          delayedStableFrames: 0,
          changedSamples: 0,
          delayedAssetsMoved: 0,
          delayedMaxAssetShiftPx: 0,
          delayedFoldersMoved: 0,
          delayedMaxFolderShiftPx: 0,
          delayedLongTasks: [],
          observer: null,
          longTaskObserver: null,
        };
        const changed = (): boolean => {
          if (state.kind === "asset.trash") {
            return ![...document.querySelectorAll<HTMLElement>(".asset-card[data-asset-id]")]
              .some((element) => element.dataset.assetId === state.assetId);
          }
          if (state.kind === "folder.create") {
            return [...document.querySelectorAll<HTMLElement>(
              ".navigation-pane button.nav-row[data-nav-folder-id]",
            )].some((element) => element.dataset.hoverTip === state.folderName);
          }
          return ![...document.querySelectorAll<HTMLElement>(
            ".navigation-pane button.nav-row[data-nav-folder-id]",
          )].some((element) => element.dataset.navFolderId === state.folderId);
        };
        const markFirst = () => {
          if (state.firstAt !== null || !changed()) return;
          state.firstAt = performance.now();
          state.firstSnapshot = snapshot();
          state.previous = state.firstSnapshot;
        };
        const observer = new MutationObserver(markFirst);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        state.observer = observer;
        try {
          const longTaskObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (state.stableAt !== null && entry.startTime >= state.stableAt
                && (state.observationCompletedAt === null
                  || entry.startTime <= state.observationCompletedAt)) {
                state.delayedLongTasks.push(entry.duration);
              }
            }
          });
          longTaskObserver.observe({ type: "longtask", buffered: true });
          state.longTaskObserver = longTaskObserver;
        } catch {
          // Long-task entries are optional; geometry observation still applies.
        }
        this.state = state;
        const tick = () => {
          if (state.observationCompletedAt !== null) return;
          if (state.firstAt === null) markFirst();
          if (state.firstAt !== null && state.stableAt === null) {
            const next = snapshot();
            if (state.previous && sameLayout(state.previous, next)) state.stableFrames += 1;
            else state.stableFrames = 0;
            state.previous = next;
            if (state.stableFrames >= 3) {
              state.stableAt = performance.now();
              state.finalSnapshot = next;
              state.delayedPrevious = next;
            }
          } else if (state.stableAt !== null) {
            const next = snapshot();
            const firstSettleSnapshot = state.finalSnapshot ?? next;
            const changedFromFirstSettle = !sameLayout(firstSettleSnapshot, next);
            if (changedFromFirstSettle) {
              const now = performance.now();
              state.delayedFirstChangeAt ??= now;
              state.changedSamples += 1;
              const assetShift = diff(firstSettleSnapshot.assets, next.assets);
              const folderShift = diff(firstSettleSnapshot.folders, next.folders);
              state.delayedAssetsMoved = Math.max(state.delayedAssetsMoved, assetShift.moved);
              state.delayedMaxAssetShiftPx = Math.max(state.delayedMaxAssetShiftPx, assetShift.maxShift);
              state.delayedFoldersMoved = Math.max(state.delayedFoldersMoved, folderShift.moved);
              state.delayedMaxFolderShiftPx = Math.max(state.delayedMaxFolderShiftPx, folderShift.maxShift);
            }
            if (state.delayedFirstChangeAt !== null) {
              if (state.delayedPrevious && sameLayout(state.delayedPrevious, next)) {
                state.delayedStableFrames += 1;
              } else {
                state.delayedStableFrames = 0;
              }
              if (state.delayedStableFrames >= 3) state.delayedStableAt ??= performance.now();
            }
            state.delayedPrevious = next;
            if (performance.now() - state.stableAt >= 1_800) {
              state.observationCompletedAt = performance.now();
              observer.disconnect();
              state.longTaskObserver?.disconnect();
              return;
            }
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      read,
    };
    globals.__serpentDeleteRefreshProbe = probe;
  });
}

async function readRefreshProbe(window: Page): Promise<RefreshProbeResult> {
  return window.evaluate(() => (globalThis as typeof globalThis & {
    __serpentDeleteRefreshProbe: { read(): RefreshProbeResult };
  }).__serpentDeleteRefreshProbe.read());
}

async function waitForFirstSettle(window: Page): Promise<RefreshProbeResult> {
  const startedAt = Date.now();
  let result = await readRefreshProbe(window);
  while (Date.now() - startedAt < 30_000) {
    if (result.firstSettle.firstVisibleMs !== null && result.firstSettle.layoutStableMs !== null) return result;
    await window.waitForTimeout(25);
    result = await readRefreshProbe(window);
  }
  expect(result.firstSettle.firstVisibleMs, "the action should produce a visible update").not.toBeNull();
  expect(result.firstSettle.layoutStableMs, "the updated layout should settle").not.toBeNull();
  return result;
}

async function waitForDelayedReconcile(window: Page): Promise<RefreshProbeResult> {
  const startedAt = Date.now();
  let result = await readRefreshProbe(window);
  while (Date.now() - startedAt < 30_000) {
    if (result.delayedReconcile.observationMs !== null) return result;
    await window.waitForTimeout(25);
    result = await readRefreshProbe(window);
  }
  expect(result.delayedReconcile.observationMs, "the delayed-reconcile observation should complete").not.toBeNull();
  return result;
}

function logSegment(before: string, after: string): string {
  return after.startsWith(before) ? after.slice(before.length) : after;
}

function compactWorkerCommands(logText: string): DiagnosticOperation["workerCommands"] {
  return summarizeBenchLog(logText).commands.map((command) => ({
    type: command.commandType,
    count: command.count,
    queueP95Ms: command.queueMs.p95Ms,
    schedulerWaitP95Ms: command.schedulerWaitMs.p95Ms,
    runP95Ms: command.runMs.p95Ms,
    roundTripP95Ms: command.roundTripMs.p95Ms,
  }));
}

async function finishOperation(options: {
  window: Page;
  userDataPath: string;
  logBefore: string;
  logAtFirstSettle: string;
  logAtObservationEnd: string;
  actionStartedAt: number;
  kind: RefreshKind;
  refresh: RefreshProbeResult;
}): Promise<DiagnosticOperation> {
  const {
    window, userDataPath, logBefore, logAtFirstSettle, logAtObservationEnd,
    actionStartedAt, kind, refresh,
  } = options;
  let decode: { elapsedMs: number; stats: Awaited<ReturnType<typeof visibleImageStats>>; timedOut: boolean } | null = null;
  const initialStats = await visibleImageStats(window);
  if (initialStats.imageCards > 0) {
    decode = await waitForVisibleDecoded(window, 0.8, decodeBudgetMs);
  }
  await window.waitForTimeout(250);
  const logAfter = readSessionLog(userDataPath);
  const logTail = logSegment(logBefore, logAfter);
  const renderer = await readRendererProbe(window);
  return {
    ...refresh,
    delayedReconcile: {
      ...refresh.delayedReconcile,
      workerCommands: compactWorkerCommands(logSegment(logAtFirstSettle, logAtObservationEnd)),
    },
    op: kind,
    visibleImageCards: decode?.stats.imageCards ?? initialStats.imageCards,
    visibleImageCoverage: Number((decode?.stats.coverage ?? initialStats.coverage).toFixed(3)),
    actionToDecodedMs: decode && !decode.timedOut ? Date.now() - actionStartedAt : null,
    decodeTimedOut: decode?.timedOut ?? null,
    renderer: {
      longTaskCount: renderer.longTaskCount,
      longTaskMaxMs: renderer.longTaskMaxMs,
      longTaskTotalMs: renderer.longTaskTotalMs,
      frameSamples: renderer.frameSamples,
      frameP95Ms: renderer.frameP95Ms,
      frameMaxMs: renderer.frameMaxMs,
    },
    workerCommands: compactWorkerCommands(logTail),
  };
}

async function deleteCreatedFolder(window: Page, folderId: string | null, folderName: string | null): Promise<void> {
  if (!folderId && !folderName) return;
  if (!folderId) throw new Error("The benchmark-created folder ID is unavailable for cleanup.");
  if (!await readFolderRecoveryTarget(window, folderId)) return;
  const target = await requireEmptyBenchmarkFolder(window, folderId, folderName ?? undefined);
  const row = window.locator(
    `.navigation-pane button.nav-row[data-nav-folder-kind="managed"][data-nav-folder-id="${folderId}"]`,
  );
  await expect(row, `benchmark folder ${target.folderId} should remain visible before cleanup`).toBeVisible();
  const dialog = window.getByRole("dialog", { name: "从磁盘删除这个文件夹？", exact: true });
  if (await dialog.count() === 0) {
    await row.click({ button: "right" });
    const deleteAction = window.getByRole("menuitem", { name: /^从硬盘中删除/u });
    await expect(deleteAction).toBeVisible();
    await deleteAction.click();
  }
  await confirmFolderDiskDelete(window);
  await expect(row).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(async () => (await readFolderRecoveryTarget(window, folderId)) === null, {
    timeout: 60_000,
  }).toBe(true);
}

type AssetRecoveryState = { isActive: boolean; isTrashed: boolean };
type FolderRecoveryTarget = {
  folderId: string;
  parentFolderId: string | null;
  name: string;
  relativePath: string;
  directAssetCount: number;
  childFolderCount: number;
  scopedAssetCount: number;
};

function formatFailure(error: unknown): string {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const sanitized = detail.split(/\r?\n/u).map((line) => {
    const tokens = line.split(/(\s+)/u);
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (/^\s+$/u.test(token)) continue;
      const wrapped = token.replace(/^[([{"'`]+/u, "").replace(/[)\]},;"'`]+$/u, "");
      const separator = wrapped.indexOf("=");
      const candidate = separator >= 0 ? wrapped.slice(separator + 1) : wrapped;
      const parsedUrl = URL.canParse(candidate) ? new URL(candidate) : null;
      if (path.win32.isAbsolute(candidate) || path.posix.isAbsolute(candidate) || parsedUrl?.protocol === "file:") {
        const tokenPathIndex = token.indexOf(candidate);
        tokens[index] = `${tokenPathIndex > 0 ? token.slice(0, tokenPathIndex) : ""}[local path]`;
        return tokens.slice(0, index + 1).join("");
      }
    }
    return tokens.join("");
  }).join("\n");
  return sanitized.slice(0, 2_000);
}

async function readFolderRecoveryTarget(window: Page, folderId: string): Promise<FolderRecoveryTarget | null> {
  return window.evaluate(async (id) => {
    type Result<T> = { ok: boolean; value?: T; error?: { code: string } };
    type Folder = {
      folderId: string;
      parentFolderId: string | null;
      name: string;
      relativePath: string;
      directAssetCount: number;
      childFolderCount: number;
    };
    type Asset = { assetId: string };
    type LibraryApi = {
      listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
      listFolders(input: { libraryId: string; showIgnored: boolean }): Promise<Result<Folder[]>>;
      listAssets(input: {
        libraryId: string;
        folderId?: string;
        recursive: boolean;
        showIgnored: boolean;
      }): Promise<Result<Asset[]>>;
    };
    const api = (globalThis as typeof globalThis & { serpent: { library: LibraryApi } }).serpent.library;
    const opened = await api.listOpen();
    const libraryId = opened.value?.[0]?.libraryId;
    if (!opened.ok || !libraryId) throw new Error("Could not identify the open library during folder recovery.");
    const folders = await api.listFolders({ libraryId, showIgnored: true });
    if (!folders.ok) throw new Error(`Could not list folders during recovery (${folders.error?.code ?? "unknown"}).`);
    const folder = folders.value?.find((entry) => entry.folderId === id);
    if (!folder) return null;
    const assets = await api.listAssets({
      libraryId,
      folderId: id,
      recursive: true,
      showIgnored: true,
    });
    if (!assets.ok) throw new Error(`Could not verify folder contents (${assets.error?.code ?? "unknown"}).`);
    return { ...folder, scopedAssetCount: assets.value?.length ?? 0 };
  }, folderId);
}

async function requireEmptyBenchmarkFolder(
  window: Page,
  folderId: string,
  expectedName?: string,
): Promise<FolderRecoveryTarget> {
  const target = await readFolderRecoveryTarget(window, folderId);
  if (!target) throw new Error(`Benchmark folder ${folderId} is not present in the open library.`);
  if (!target.name.startsWith("__delete_perf_") || (expectedName && target.name !== expectedName)) {
    throw new Error(`Refusing to delete folder ${folderId}: its identity does not match the benchmark prefix.`);
  }
  if (target.directAssetCount > 0 || target.childFolderCount > 0 || target.scopedAssetCount > 0) {
    throw new Error(`Refusing to delete folder ${folderId}: it is not empty.`);
  }
  return target;
}

async function confirmFolderDiskDelete(window: Page): Promise<void> {
  const dialog = window.getByRole("dialog", { name: "从磁盘删除这个文件夹？", exact: true });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "强制删除", exact: true }).click();
}

async function readAssetRecoveryState(window: Page, assetId: string): Promise<AssetRecoveryState> {
  return window.evaluate(async (id) => {
    type Result<T> = { ok: boolean; value?: T; error?: { code: string } };
    type Asset = { assetId: string };
    type LibraryApi = {
      listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
      listTrash(input: { libraryId: string }): Promise<Result<Asset[]>>;
      listAssets(input: { libraryId: string; recursive: boolean; assetIds: string[] }): Promise<Result<Asset[]>>;
    };
    const api = (globalThis as typeof globalThis & { serpent: { library: LibraryApi } }).serpent.library;
    const opened = await api.listOpen();
    const libraryId = opened.value?.[0]?.libraryId;
    if (!opened.ok || !libraryId) throw new Error("Could not identify the open library during asset recovery.");
    const [trash, active] = await Promise.all([
      api.listTrash({ libraryId }),
      api.listAssets({ libraryId, recursive: true, assetIds: [id] }),
    ]);
    if (!trash.ok || !active.ok) throw new Error("Could not verify the asset recovery state.");
    const isTrashed = trash.value?.some((asset) => asset.assetId === id) ?? false;
    return {
      isActive: !isTrashed && (active.value?.some((asset) => asset.assetId === id) ?? false),
      isTrashed,
    };
  }, assetId);
}

/** Idempotent typed-bridge fallback used only to restore the selected asset. */
async function restoreTrashedAssetViaBridge(window: Page, assetId: string): Promise<void> {
  const before = await readAssetRecoveryState(window, assetId);
  if (before.isTrashed) {
    const restore = await window.evaluate(async (id) => {
      type Result<T> = { ok: boolean; value?: T; error?: { code: string } };
      type LibraryApi = {
        listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
        restoreAssets(input: {
          libraryId: string;
          assetIds: string[];
          conflictStrategy: "keep-both";
        }): Promise<Result<{ restoredCount: number }>>;
      };
      const api = (globalThis as typeof globalThis & { serpent: { library: LibraryApi } }).serpent.library;
      const opened = await api.listOpen();
      const libraryId = opened.value?.[0]?.libraryId;
      if (!opened.ok || !libraryId) throw new Error("Could not identify the open library during asset recovery.");
      const result = await api.restoreAssets({
        libraryId,
        assetIds: [id],
        conflictStrategy: "keep-both",
      });
      if (!result.ok || result.value?.restoredCount !== 1) {
        throw new Error(`Typed-bridge asset recovery failed (${result.error?.code ?? "unexpected result"}).`);
      }
      return result.value.restoredCount;
    }, assetId);
    if (restore !== 1) throw new Error(`Typed-bridge asset recovery failed for asset ${assetId}.`);
  }
  const after = await readAssetRecoveryState(window, assetId);
  if (!after.isActive || after.isTrashed) {
    throw new Error(`Asset ${assetId} is not confirmed active after recovery.`);
  }
}

async function restoreTrashedAssetViaUi(window: Page, assetId: string): Promise<void> {
  await window.getByRole("button", { name: /回收站/u }).click();
  const card = window.locator(`.asset-card[data-asset-id="${assetId}"]`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await card.click({ button: "right" });
  await window.getByRole("menuitem", { name: "恢复", exact: true }).click();
  const dialog = window.getByRole("dialog");
  await window.waitForFunction(() => Boolean(document.querySelector('[role="dialog"]'))
    || document.querySelector(".workspace-notice")?.textContent?.includes("已恢复"));
  if (await dialog.count()) {
    await chooseStandardOption(dialog.getByLabel("恢复位置"), "original");
    await chooseStandardOption(dialog.getByLabel("同名冲突"), "keep-both");
    await dialog.getByRole("button", { name: "确认恢复" }).click();
  }
  await expect(window.locator(".workspace-notice")).toContainText("已恢复 1 项资产", { timeout: 60_000 });
  await expect(card).toHaveCount(0, { timeout: 60_000 });
  const state = await readAssetRecoveryState(window, assetId);
  if (!state.isActive || state.isTrashed) {
    throw new Error(`UI restore did not return asset ${assetId} to the active library.`);
  }
  await window.getByRole("button", { name: "所有资产", exact: true }).click();
  await expect(card).toBeVisible({ timeout: 60_000 });
}

test("measures visible asset deletion geometry and folder refresh on an isolated copy", async () => {
  if (!sourceLibrary || !writeLibrary) throw new Error("Missing configured library paths.");
  if (recoveryAssetId && recoveryFolderId) {
    throw new Error("Set only one of the asset or folder recovery IDs at a time.");
  }
  if (recoveryAssetId && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(recoveryAssetId)) {
    throw new Error("SERPENT_DELETE_PERF_RECOVER_ASSET_ID must be a UUID.");
  }
  if (recoveryFolderId && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(recoveryFolderId)) {
    throw new Error("SERPENT_DELETE_PERF_RECOVER_FOLDER_ID must be a UUID.");
  }
  const libraryPath = validateIsolatedCopy(sourceLibrary, writeLibrary);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-delete-refresh-perf-"));
  const userDataPath = path.join(temporaryRoot, "user-data");
  seedRecentLibraries(userDataPath, [libraryPath], libraryPath);

  const operations: DiagnosticOperation[] = [];
  const cleanupErrors: string[] = [];
  let app: Awaited<ReturnType<typeof launchBenchmarkApp>> | null = null;
  let assetId: string | null = null;
  let assetIsTrashed = false;
  let createdFolderId: string | null = null;
  let createdFolderName: string | null = null;
  let finalRenderer: RendererProbe | null = null;
  const errors: string[] = [];
  let journeyError: unknown = null;

  try {
    app = await launchBenchmarkApp({ userDataPath, openLibraryPath: libraryPath });
    const window = app.window;
    window.on("crash", () => errors.push("renderer crashed"));

    if (recoveryAssetId) {
      // Recovery-only mode deliberately exits before installing benchmark probes
      // or performing any new trash, folder-create, or folder-delete action.
      assetId = recoveryAssetId;
      assetIsTrashed = true;
      await restoreTrashedAssetViaUi(window, recoveryAssetId);
      assetIsTrashed = false;
      console.info("DELETE_REFRESH_RECOVERY_SUMMARY {\"mode\":\"ui-only-restore\",\"activeAssetVerified\":true}");
      return;
    }

    if (recoveryFolderId) {
      // Recovery-only mode verifies this exact empty benchmark folder before
      // opening its disk-delete menu and confirms the CriticalConfirmation UI.
      const target = await requireEmptyBenchmarkFolder(window, recoveryFolderId);
      createdFolderId = recoveryFolderId;
      createdFolderName = target.name;
      await deleteCreatedFolder(window, createdFolderId, createdFolderName);
      createdFolderId = null;
      createdFolderName = null;
      console.info("DELETE_REFRESH_RECOVERY_SUMMARY {\"mode\":\"ui-folder-delete\",\"folderAbsentVerified\":true}");
      return;
    }

    await installRendererProbe(window);
    await installRefreshProbe(window);
    await expect(window.locator(".asset-card[data-asset-id]").first()).toBeVisible({ timeout: 180_000 });

    // ---------------------------------------------------- asset deletion geometry
    const canvas = window.locator(".workspace-canvas");
    await canvas.click({ position: { x: 8, y: 8 } });
    const targetCard = window.locator(".asset-card[data-media-type='image'][data-asset-id]").first();
    await expect(targetCard).toBeVisible({ timeout: 30_000 });
    assetId = (await targetCard.getAttribute("data-asset-id")) ?? null;
    if (!assetId) throw new Error("The benchmark card did not expose an asset ID.");
    await targetCard.click({ button: "right" });
    const trashAction = window.getByRole("menuitem", { name: "移入回收站", exact: true });
    await expect(trashAction).toBeVisible();
    await resetRendererCounters(window);
    const trashLogBefore = readSessionLog(userDataPath);
    await window.evaluate((id) => (globalThis as typeof globalThis & {
      __serpentDeleteRefreshProbe: { begin(input: { kind: RefreshKind; assetId: string }): void };
    }).__serpentDeleteRefreshProbe.begin({ kind: "asset.trash", assetId: id }), assetId);
    const trashStartedAt = Date.now();
    assetIsTrashed = true;
    await trashAction.click();
    await expect(window.locator(`.asset-card[data-asset-id="${assetId}"]`)).toHaveCount(0, { timeout: 60_000 });
    await waitForFirstSettle(window);
    const trashLogAtFirstSettle = readSessionLog(userDataPath);
    const trashRefresh = await waitForDelayedReconcile(window);
    const trashLogAtObservationEnd = readSessionLog(userDataPath);
    operations.push(await finishOperation({
      window,
      userDataPath,
      logBefore: trashLogBefore,
      logAtFirstSettle: trashLogAtFirstSettle,
      logAtObservationEnd: trashLogAtObservationEnd,
      actionStartedAt: trashStartedAt,
      kind: "asset.trash",
      refresh: trashRefresh,
    }));

    // ------------------------------------------------ folder create and delete
    const addFolderButton = window.getByRole("button", { name: "添加文件夹", exact: true });
    await expect(addFolderButton).toBeVisible();
    await addFolderButton.click();
    const folderName = `__delete_perf_${Date.now().toString(36)}`;
    createdFolderName = folderName;
    const input = window.locator(".nav-inline-edit input");
    await expect(input).toBeFocused();
    await input.fill(folderName);
    await resetRendererCounters(window);
    const createLogBefore = readSessionLog(userDataPath);
    await window.evaluate((name) => (globalThis as typeof globalThis & {
      __serpentDeleteRefreshProbe: { begin(input: { kind: RefreshKind; folderName: string }): void };
    }).__serpentDeleteRefreshProbe.begin({ kind: "folder.create", folderName: name }), folderName);
    const createStartedAt = Date.now();
    await input.press("Enter");
    const createdRow = window.locator(
      `.navigation-pane button.nav-row[data-nav-folder-kind="managed"][data-hover-tip="${folderName}"]`,
    );
    await expect(createdRow).toBeVisible({ timeout: 60_000 });
    createdFolderId = await createdRow.getAttribute("data-nav-folder-id");
    if (!createdFolderId) throw new Error("The created folder did not expose an ID.");
    await waitForFirstSettle(window);
    const createLogAtFirstSettle = readSessionLog(userDataPath);
    const createRefresh = await waitForDelayedReconcile(window);
    const createLogAtObservationEnd = readSessionLog(userDataPath);
    operations.push(await finishOperation({
      window,
      userDataPath,
      logBefore: createLogBefore,
      logAtFirstSettle: createLogAtFirstSettle,
      logAtObservationEnd: createLogAtObservationEnd,
      actionStartedAt: createStartedAt,
      kind: "folder.create",
      refresh: createRefresh,
    }));

    await createdRow.click({ button: "right" });
    const deleteAction = window.getByRole("menuitem", { name: /从硬盘中删除/u });
    await expect(deleteAction).toBeVisible();
    await resetRendererCounters(window);
    const deleteLogBefore = readSessionLog(userDataPath);
    await window.evaluate((id) => (globalThis as typeof globalThis & {
      __serpentDeleteRefreshProbe: { begin(input: { kind: RefreshKind; folderId: string }): void };
    }).__serpentDeleteRefreshProbe.begin({ kind: "folder.delete", folderId: id }), createdFolderId);
    const deleteStartedAt = Date.now();
    await deleteAction.click();
    await confirmFolderDiskDelete(window);
    await expect(createdRow).toHaveCount(0, { timeout: 60_000 });
    await expect.poll(async () => (await readFolderRecoveryTarget(window, createdFolderId!)) === null, {
      timeout: 60_000,
    }).toBe(true);
    createdFolderId = null;
    createdFolderName = null;
    await waitForFirstSettle(window);
    const deleteLogAtFirstSettle = readSessionLog(userDataPath);
    const deleteRefresh = await waitForDelayedReconcile(window);
    const deleteLogAtObservationEnd = readSessionLog(userDataPath);
    operations.push(await finishOperation({
      window,
      userDataPath,
      logBefore: deleteLogBefore,
      logAtFirstSettle: deleteLogAtFirstSettle,
      logAtObservationEnd: deleteLogAtObservationEnd,
      actionStartedAt: deleteStartedAt,
      kind: "folder.delete",
      refresh: deleteRefresh,
    }));

    finalRenderer = await readRendererProbe(window);
    console.info(`DELETE_REFRESH_PERF_SUMMARY ${JSON.stringify({ operations })}`);
  } catch (error) {
    errors.push(`benchmark journey failed: ${formatFailure(error)}`);
    journeyError = error;
  } finally {
    if (app) {
      const window = app.window;
      if (createdFolderId || createdFolderName) {
        try {
          const pendingEdit = window.locator(".nav-inline-edit input");
          if (await pendingEdit.count() > 0) await pendingEdit.press("Escape").catch(() => undefined);
          await deleteCreatedFolder(window, createdFolderId, createdFolderName);
          createdFolderId = null;
          createdFolderName = null;
        } catch (error) {
          cleanupErrors.push(
            `could not remove benchmark folder ${createdFolderId}: ${formatFailure(error)}`,
          );
        }
      }
      if (assetIsTrashed && assetId) {
        try {
          await restoreTrashedAssetViaBridge(window, assetId);
          assetIsTrashed = false;
        } catch (error) {
          cleanupErrors.push(`could not restore trashed asset ${assetId}: ${formatFailure(error)}`);
        }
      }
      finalRenderer ??= await readRendererProbe(window).catch(() => null);
      await app.application.close().catch(() => undefined);
    }

    writeBenchReport(reportPath, {
      suite: "delete-refresh-perf-benchmark",
      operations,
      renderer: finalRenderer,
      errors,
      cleanupErrors,
    });
    rmSync(temporaryRoot, { force: true, recursive: true });
  }

  if (cleanupErrors.length > 0 || journeyError) {
    console.error(`DELETE_REFRESH_FAILURE_SUMMARY ${JSON.stringify({
      journeyError: journeyError ? formatFailure(journeyError) : null,
      operations,
      cleanupErrors,
    })}`);
  }
  if (cleanupErrors.length > 0) {
    const journeyDetails = journeyError ? ` Journey error: ${formatFailure(journeyError)}` : "";
    throw new Error(`Benchmark cleanup failed: ${cleanupErrors.join("; ")}.${journeyDetails}`);
  }
  if (journeyError) throw new Error(`Benchmark journey failed: ${formatFailure(journeyError)}`);
  console.log(`DELETE_REFRESH_SUMMARY ${JSON.stringify(operations.map((operation) => ({
    op: operation.op,
    firstVisibleMs: operation.firstSettle.firstVisibleMs,
    layoutStableMs: operation.firstSettle.layoutStableMs,
    workerCommands: operation.workerCommands,
  })))}`);
});
