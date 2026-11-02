import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import {
  benchmarkLogEnv,
  installRendererProbe,
  readRendererProbe,
  readSessionLog,
  resetRendererCounters,
  seedRecentLibraries,
  summarizeBenchLog,
  summarizeMediaQueueWindow,
  summarizeTimings,
  visibleImageStats,
  writeBenchReport,
} from "./perf-bench-helpers";
import { electronLaunchEnv, resolveElectronExecutablePath } from "./electron-test-helpers";
import { LARGE_LIBRARY_FIXTURE_VERSION } from "../worker/large-library-mix";

/**
 * Profiler + user-visible latency harness (real library only).
 *
 * The earlier navigation benchmark reported `serpent:e2e-browse-page` as the
 * switch latency; that event is gated behind `browseDiagnosticsEnabled` and
 * never fires in a production-like build, so its "20 s" was a wait-for-nothing
 * timeout. This harness measures what a user actually waits for instead:
 *
 *   click → the visible card set really changed → all visible images decoded
 *
 * and attaches real profilers while the journey runs:
 *   - renderer: CDP `Profiler` (V8 CPU profile) + frame/long-task samples
 *   - Library Worker: V8 inspector (`SERPENT_WORKER_INSPECT`) CPU profile, so
 *     the hotspot answer covers the process that owns SQLite and the files.
 *
 * Usage (paths only via env, nothing stored in the repo):
 *   SERPENT_PROFILE_LIBRARY=<library> SERPENT_PROFILE_OUT=<dir> \
 *   node scripts/run-e2e.mjs tests/e2e/navigation-profile.test.ts
 */
const library = process.env.SERPENT_PROFILE_LIBRARY;
const outDir = process.env.SERPENT_PROFILE_OUT;
const workerInspectPort = Number(process.env.SERPENT_WORKER_INSPECT ?? 9333);
const wheelMs = Number(process.env.SERPENT_PROFILE_WHEEL_MS ?? 8_000);
const navTarget = process.env.SERPENT_PROFILE_NAV_TARGET;
const contended = process.env.SERPENT_PROFILE_CONTENDED === "1";
const switches = Number(process.env.SERPENT_PROFILE_SWITCHES ?? 4);
const includeJumps = process.env.SERPENT_PROFILE_INCLUDE_JUMPS !== "0";
const percentJump = process.env.SERPENT_PROFILE_PERCENT_JUMP === "1";
const idleMs = Number(process.env.SERPENT_PROFILE_IDLE_MS ?? 0);
const pauseQueueBeforeNavigation = process.env.SERPENT_PROFILE_PAUSE_QUEUE_BEFORE_NAV === "1";
const pauseQueueConfirmation = process.env.SERPENT_PROFILE_PAUSE_QUEUE_CONFIRM;
const minimumPauseQueueSize = Math.max(1, Number(process.env.SERPENT_PROFILE_PAUSE_QUEUE_MIN ?? 2_000));
const minimumQueueSize = Math.max(0, Number(process.env.SERPENT_PROFILE_QUEUE_MIN ?? 0));
const minScopeAssets = Math.max(1, Number(process.env.SERPENT_PROFILE_MIN_SCOPE_ASSETS ?? 32));
const minVisibleImages = Math.max(1, Number(process.env.SERPENT_PROFILE_MIN_VISIBLE_IMAGES ?? 6));
const repeatSwitchesForWarmCache = process.env.SERPENT_PROFILE_REPEAT_SWITCHES !== "0";
/**
 * Serpent-e97c00: how many task-status reads to issue through the real bridge
 * after the navigation journey. The task panel polls at about 1 Hz, so a series
 * of reads is the only way to A/B a summary cache without opening the panel.
 */
const statusSamples = Math.max(0, Number(process.env.SERPENT_PROFILE_STATUS_SAMPLES ?? 0));
const statusSampleIntervalMs = Math.max(0, Number(process.env.SERPENT_PROFILE_STATUS_INTERVAL_MS ?? 200));
const traceWheel = process.env.SERPENT_PROFILE_TRACE_WHEEL === "1";
const styleAblation = process.env.SERPENT_PROFILE_STYLE_ABLATION ?? "";
const suppressWheelInput = process.env.SERPENT_PROFILE_SUPPRESS_WHEEL_INPUT === "1";
type PersistedJobGroup = {
  kind: string;
  status: string;
  errorClass: string;
  count: number;
};

/** Read-only raw queue breakdown; the aggregate is needed to know what a backlog contains. */
function readPersistedJobGroups(libraryPath: string): PersistedJobGroup[] {
  const database = new DatabaseSync(path.join(libraryPath, ".serpent", "library.db"), {
    readOnly: true,
  });
  try {
    return database.prepare(
      `SELECT kind, status,
              CASE
                WHEN error_code IS NULL THEN 'none'
                WHEN error_code IN (
                  'SOURCE_DIRECT', 'ARTIFACT_READY', 'STALE_REVISION',
                  'SOURCE_NOT_FOUND', 'ASSET_IGNORED', 'PALETTE_NOT_APPLICABLE',
                  'SINGLE_FLIGHT', 'MEDIA_RESOURCE_EXHAUSTED'
                ) THEN error_code
                ELSE 'other'
              END AS errorClass,
              COUNT(*) AS count
         FROM jobs
        GROUP BY kind, status, errorClass
        ORDER BY kind, status, errorClass`,
    ).all() as PersistedJobGroup[];
  } finally {
    database.close();
  }
}

function diffPersistedJobGroups(
  before: PersistedJobGroup[] | null,
  after: PersistedJobGroup[] | null,
): Array<PersistedJobGroup & { before: number; after: number; delta: number }> | null {
  if (!before || !after) return null;
  const keyFor = (row: PersistedJobGroup): string =>
    `${row.kind}\u0000${row.status}\u0000${row.errorClass}`;
  const beforeByKey = new Map(before.map((row) => [keyFor(row), row]));
  const afterByKey = new Map(after.map((row) => [keyFor(row), row]));
  return [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])]
    .map((key) => {
      const earlier = beforeByKey.get(key);
      const later = afterByKey.get(key);
      const countBefore = earlier?.count ?? 0;
      const countAfter = later?.count ?? 0;
      const reference = later ?? earlier!;
      return {
        kind: reference.kind,
        status: reference.status,
        errorClass: reference.errorClass,
        count: countAfter,
        before: countBefore,
        after: countAfter,
        delta: countAfter - countBefore,
      };
    })
    .sort((left, right) => left.kind.localeCompare(right.kind)
      || left.status.localeCompare(right.status)
      || left.errorClass.localeCompare(right.errorClass));
}

test.describe.configure({ timeout: 1_800_000 });
test.skip(!library || !outDir, "Set SERPENT_PROFILE_LIBRARY and SERPENT_PROFILE_OUT.");

/** Self time per function from a V8 .cpuprofile. */
function topFunctions(profile: {
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number }>;
  samples?: number[];
  timeDeltas?: number[];
}, limit = 18): Array<{ fn: string; file: string; selfMs: number; samples: number }> {
  const byNode = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let index = 0; index < samples.length; index += 1) {
    const nodeId = samples[index]!;
    const micros = deltas[index] ?? 0;
    byNode.set(nodeId, (byNode.get(nodeId) ?? 0) + micros / 1000);
  }
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const rows = [...byNode.entries()].map(([nodeId, selfMs]) => {
    const node = nodes.get(nodeId);
    return {
      fn: node?.callFrame.functionName || "(anonymous)",
      file: (node?.callFrame.url ?? "").replace(/^.*\//u, ""),
      selfMs: Math.round(selfMs * 10) / 10,
      samples: Math.max(1, Math.round(selfMs / 1)),
    };
  });
  return rows.sort((left, right) => right.selfMs - left.selfMs).slice(0, limit);
}

async function connectWorkerProfiler(port: number): Promise<{
  start(): Promise<void>;
  stop(): Promise<unknown>;
} | null> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json() as Array<{ webSocketDebuggerUrl?: string }>;
      const socketUrl = targets[0]?.webSocketDebuggerUrl;
      if (socketUrl) {
        const socket = new WebSocket(socketUrl);
        await new Promise<void>((resolve, reject) => {
          socket.addEventListener("open", () => resolve());
          socket.addEventListener("error", () => reject(new Error("inspector socket failed")));
        });
        let id = 0;
        const pending = new Map<number, (value: unknown) => void>();
        socket.addEventListener("message", (event: MessageEvent) => {
          const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown };
          if (message.id !== undefined) pending.get(message.id)?.(message.result);
        });
        const send = (method: string): Promise<unknown> => new Promise((resolve) => {
          id += 1;
          pending.set(id, resolve);
          socket.send(JSON.stringify({ id, method }));
        });
        return {
          start: async () => {
            await send("Profiler.enable");
            await send("Profiler.start");
          },
          stop: async () => {
            const result = await send("Profiler.stop") as { profile?: unknown };
            socket.close();
            return result.profile;
          },
        };
      }
    } catch {
      // The Worker may not have spawned yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/** Visible card identities, so a navigation can prove the content changed. */
async function visibleCardIds(window: Page): Promise<string[]> {
  return window.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!canvas) return [];
    const rect = canvas.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>(".asset-card:not(.is-layout-preview)")]
      .filter((card) => {
        const box = card.getBoundingClientRect();
        return box.bottom > rect.top && box.top < rect.bottom && box.right > rect.left && box.left < rect.right;
      })
      .map((card) => card.dataset.assetId ?? "")
      .filter((value) => value.length > 0)
      .slice(0, 40);
  });
}

type NavigationScope = { index: number; identity: string; count: number };

async function activeNavigationScope(window: Page): Promise<string> {
  return window.locator(".navigation-pane button.nav-row.is-active").first().evaluate((row) => {
    const button = row as HTMLButtonElement;
    return [
      button.dataset.navFolderKind ?? "",
      button.dataset.navFolderId ?? "",
      button.dataset.navCollectionId ?? "",
      button.querySelector(".nav-row-label")?.textContent?.trim() ?? "",
    ].join("\u0000");
  }).catch(() => "");
}

type NavigationClickMarker = { sequence: number; identity: string; atEpochMs: number };

async function installNavigationClickProbe(window: Page): Promise<void> {
  await window.evaluate(() => {
    const host = window as typeof window & {
      __serpentNavigationClickMarker?: NavigationClickMarker;
      __serpentNavigationClickSequence?: number;
    };
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button.nav-row")
        : null;
      if (!target) return;
      const sequence = (host.__serpentNavigationClickSequence ?? 0) + 1;
      host.__serpentNavigationClickSequence = sequence;
      host.__serpentNavigationClickMarker = {
        sequence,
        identity: [
          target.dataset.navFolderKind ?? "",
          target.dataset.navFolderId ?? "",
          target.dataset.navCollectionId ?? "",
          target.querySelector(".nav-row-label")?.textContent?.trim() ?? "",
        ].join("\u0000"),
        atEpochMs: performance.timeOrigin + event.timeStamp,
      };
    }, true);
  });
}

async function readNavigationClickMarker(
  window: Page,
  previousSequence: number,
): Promise<NavigationClickMarker | null> {
  return window.evaluate((previous) => {
    const host = window as typeof window & {
      __serpentNavigationClickMarker?: NavigationClickMarker;
    };
    const marker = host.__serpentNavigationClickMarker;
    return marker && marker.sequence > previous ? marker : null;
  }, previousSequence);
}

async function nonEmptyNavigationScopes(window: Page): Promise<NavigationScope[]> {
  const scopes = await window.locator(".navigation-pane button.nav-row").evaluateAll((rows) => rows
    .map((row, index) => {
      const button = row as HTMLButtonElement;
      const identity = [
        button.dataset.navFolderKind ?? "",
        button.dataset.navFolderId ?? "",
        button.dataset.navCollectionId ?? "",
        button.querySelector(".nav-row-label")?.textContent?.trim() ?? "",
      ].join("\u0000");
      const countText = button.querySelector(".nav-count")?.textContent?.trim() ?? "";
      const count = Number.parseInt(countText, 10);
      return { index, identity, count: Number.isFinite(count) ? count : 0, active: button.classList.contains("is-active") };
    })
    .filter((row) => !row.active && row.count > 0)
    .map(({ index, identity, count }) => ({ index, identity, count }))
    // Smaller non-empty scopes are more likely to differ from the library-wide
    // viewport, while still being real content rather than an empty nav row.
    .sort((left, right) => left.count - right.count));
  const representative = scopes.filter((scope) => scope.count >= minScopeAssets);
  return representative.length > 0 ? representative : scopes;
}

async function waitForScopeContentChange(
  window: Page,
  expectedScope: string,
  before: string[],
  timeoutMs: number,
  startedAt = Date.now(),
): Promise<{
  elapsedMs: number;
  activeElapsedMs?: number;
  timedOut: boolean;
  /** What was actually on screen when the wait gave up, for failure evidence. */
  observedScope: string;
  observedCount: number;
}> {
  let activeElapsedMs: number | undefined;
  for (;;) {
    const [activeScope, now] = await Promise.all([activeNavigationScope(window), visibleCardIds(window)]);
    // A click/active highlight alone is not a completed navigation. The target
    // scope must be active and its visible card set must have committed.
    // A target can be a strict subset of the old viewport (e.g. a 12-item
    // folder whose cards were all visible in the library scope). A changed
    // ordered identity set is still a real content commit; requiring a novel
    // asset incorrectly classified these switches as timeouts.
    const changed = now.length > 0 && now.join("\u0000") !== before.join("\u0000");
    const observedAt = Date.now();
    if (activeScope === expectedScope && activeElapsedMs === undefined) {
      activeElapsedMs = observedAt - startedAt;
    }
    if (activeScope === expectedScope && changed) {
      return {
        elapsedMs: observedAt - startedAt,
        activeElapsedMs: activeElapsedMs ?? observedAt - startedAt,
        timedOut: false,
        observedScope: activeScope,
        observedCount: now.length,
      };
    }
    if (observedAt - startedAt >= timeoutMs) {
      return {
        elapsedMs: observedAt - startedAt,
        ...(activeElapsedMs === undefined ? {} : { activeElapsedMs }),
        timedOut: true,
        observedScope: activeScope,
        observedCount: now.length,
      };
    }
    await window.waitForTimeout(50);
  }
}


/** Wait until EVERY visible image card has a decoded thumbnail (user's definition). */
async function waitForAllVisibleThumbnails(
  window: Page,
  timeoutMs: number,
): Promise<{
  elapsedMs: number;
  imageCards: number;
  decoded: number;
  placeholders: number;
  timedOut: boolean;
  /** First visible image card that finished decoding, and the 90% milestone. */
  firstDecodedMs: number | null;
  decoded90Ms: number | null;
}> {
  const startedAt = Date.now();
  let last: { imageCards: number; decoded: number; placeholders: number };
  let emptySamples = 0;
  let firstDecodedMs: number | null = null;
  let decoded90Ms: number | null = null;
  for (;;) {
    const sample = await window.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
      if (!canvas) return { imageCards: 0, decoded: 0, placeholders: 0 };
      const rect = canvas.getBoundingClientRect();
      const visible = [...document.querySelectorAll<HTMLElement>(".asset-card:not(.is-layout-preview)")]
        .filter((card) => {
          const box = card.getBoundingClientRect();
          return box.bottom > rect.top && box.top < rect.bottom && box.right > rect.left && box.left < rect.right;
        });
      const imageCards = visible.filter((card) => card.dataset.mediaType === "image");
      const decoded = imageCards.filter((card) => {
        const image = card.querySelector<HTMLImageElement>("img.asset-thumbnail");
        return image?.complete === true && image.naturalWidth > 0;
      }).length;
      const placeholders = visible.filter((card) =>
        card.classList.contains("is-browse-placeholder")
        || (card.dataset.assetId ?? "").startsWith("__pending:")).length;
      return { imageCards: imageCards.length, decoded, placeholders };
    });
    last = sample;
    const observedAt = Date.now();
    // The plan separates "first card on screen" from "90% decoded" from "all
    // decoded": a single 100% number hides whether the tail is slow or the
    // first paint is.
    if (firstDecodedMs === null && sample.decoded > 0) firstDecodedMs = observedAt - startedAt;
    if (
      decoded90Ms === null
      && sample.imageCards > 0
      && sample.decoded >= Math.ceil(sample.imageCards * 0.9)
    ) {
      decoded90Ms = observedAt - startedAt;
    }
    if (last.placeholders === 0 && last.imageCards > 0 && last.decoded === last.imageCards) {
      return { ...last, elapsedMs: Date.now() - startedAt, timedOut: false, firstDecodedMs, decoded90Ms };
    }
    // 目标 scope 里没有可见图片卡（空文件夹/非图片）：没有等待对象，
    // 连续两次采样确认后立即返回，不能把这个当超时。
    if (last.imageCards === 0 && last.placeholders === 0) {
      emptySamples += 1;
      if (emptySamples >= 2) {
        return { ...last, elapsedMs: Date.now() - startedAt, timedOut: false, firstDecodedMs, decoded90Ms };
      }
    } else {
      emptySamples = 0;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return { ...last, elapsedMs: Date.now() - startedAt, timedOut: true, firstDecodedMs, decoded90Ms };
    }
    await window.waitForTimeout(100);
  }
}

/** True when every visible card carries a real asset id (no browse placeholder). */
async function visibleCardsSettled(window: Page): Promise<boolean> {
  return window.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
    if (!canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const visible = [...document.querySelectorAll<HTMLElement>(".asset-card:not(.is-layout-preview)")]
      .filter((card) => {
        const box = card.getBoundingClientRect();
        return box.bottom > rect.top && box.top < rect.bottom && box.right > rect.left && box.left < rect.right;
      });
    if (visible.length === 0) return false;
    return visible.every((card) =>
      !card.classList.contains("is-browse-placeholder")
      && !(card.dataset.assetId ?? "").startsWith("__pending:"));
  });
}

async function waitForSettledVisibleCards(window: Page, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  for (;;) {
    if (await visibleCardsSettled(window)) return true;
    if (Date.now() - startedAt >= timeoutMs) return false;
    await window.waitForTimeout(100);
  }
}

type ScrollJumpOutcome = "changed" | "restored" | "no-scroll" | "no-commit" | "unsettled";

/**
 * Measure one scroll jump and say explicitly what happened.
 *
 * A jump can end four ways, and only one of them is a product failure:
 * - `changed`: the visible set committed — a latency sample.
 * - `restored`: the app put the viewport back (virtualised re-anchoring or a
 *   deliberate scroll restore). No navigation was requested, so it is not a
 *   failed commit — the previous judge reported these as 30 s timeouts.
 * - `no-scroll`: the assignment was clamped, so nothing could change.
 * - `unsettled`: the viewport never reached a settled baseline to compare from.
 * - `no-commit`: the position held but the content never arrived — a failure.
 */
async function measureScrollJump(
  window: Page,
  deltaPx: number,
  timeoutMs: number,
): Promise<{ outcome: ScrollJumpOutcome; elapsedMs: number; scrolledPx: number; observedCount: number }> {
  if (!await waitForSettledVisibleCards(window, 15_000)) {
    return { outcome: "unsettled", elapsedMs: 0, scrolledPx: 0, observedCount: 0 };
  }
  const canvas = window.locator(".workspace-canvas");
  const box = await canvas.boundingBox();
  if (!box) return { outcome: "no-scroll", elapsedMs: 0, scrolledPx: 0, observedCount: 0 };
  const before = await visibleCardIds(window);
  const expectedScope = await activeNavigationScope(window);
  const startScrollTop = await canvas.evaluate((element) => element.scrollTop);
  const startedAt = Date.now();
  // Drive the jump with real wheel input over the canvas. Assigning
  // `scrollTop` directly is not a user gesture: the app's scroll restoration
  // treats it as nothing to preserve and snaps the viewport back, which is
  // correct product behaviour and an unmeasurable jump.
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await window.mouse.wheel(0, deltaPx);

  // Phase 1: let the wheel (and any smooth scrolling) settle, then decide what
  // the product did with the input.
  let lastScrollTop = startScrollTop;
  let stableSamples = 0;
  let maxMovedPx = 0;
  const settleDeadline = startedAt + 6_000;
  for (;;) {
    const [activeScope, now, scrollTop] = await Promise.all([
      activeNavigationScope(window),
      visibleCardIds(window),
      canvas.evaluate((element) => element.scrollTop),
    ]);
    const observedAt = Date.now();
    maxMovedPx = Math.max(maxMovedPx, Math.abs(scrollTop - startScrollTop));
    if (
      activeScope === expectedScope
      && now.length > 0
      && now.join("\u0000") !== before.join("\u0000")
    ) {
      return {
        outcome: "changed",
        elapsedMs: observedAt - startedAt,
        scrolledPx: Math.abs(scrollTop - startScrollTop),
        observedCount: now.length,
      };
    }
    stableSamples = Math.abs(scrollTop - lastScrollTop) < 2 ? stableSamples + 1 : 0;
    lastScrollTop = scrollTop;
    if (stableSamples >= 5) {
      if (maxMovedPx < 8) {
        return { outcome: "no-scroll", elapsedMs: observedAt - startedAt, scrolledPx: maxMovedPx, observedCount: now.length };
      }
      if (Math.abs(scrollTop - startScrollTop) < 8) {
        return { outcome: "restored", elapsedMs: observedAt - startedAt, scrolledPx: maxMovedPx, observedCount: now.length };
      }
      break;
    }
    if (observedAt >= settleDeadline) break;
    await window.waitForTimeout(50);
  }

  // Phase 2: the position held. Now the product must commit the new window.
  for (;;) {
    const [activeScope, now, scrollTop] = await Promise.all([
      activeNavigationScope(window),
      visibleCardIds(window),
      canvas.evaluate((element) => element.scrollTop),
    ]);
    const observedAt = Date.now();
    if (
      activeScope === expectedScope
      && now.length > 0
      && now.join("\u0000") !== before.join("\u0000")
    ) {
      return {
        outcome: "changed",
        elapsedMs: observedAt - startedAt,
        scrolledPx: Math.abs(scrollTop - startScrollTop),
        observedCount: now.length,
      };
    }
    if (Math.abs(scrollTop - startScrollTop) < 8) {
      return { outcome: "restored", elapsedMs: observedAt - startedAt, scrolledPx: maxMovedPx, observedCount: now.length };
    }
    if (observedAt - startedAt >= timeoutMs) {
      return { outcome: "no-commit", elapsedMs: observedAt - startedAt, scrolledPx: maxMovedPx, observedCount: now.length };
    }
    await window.waitForTimeout(50);
  }
}

/** One task-status read through the real bridge, timed end to end. */
async function sampleMediaJobStatus(window: Page, libraryId: string): Promise<number> {
  return window.evaluate(async (id) => {
    type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listMediaJobs(input: { libraryId: string; summaryOnly?: boolean }): Promise<Result<unknown>>;
        };
      };
    };
    const startedAt = performance.now();
    const result = await bridge.serpent.library.listMediaJobs({ libraryId: id, summaryOnly: true });
    const elapsedMs = performance.now() - startedAt;
    if (!result.ok) throw new Error(`Could not read task status: ${result.error.code}`);
    return elapsedMs;
  }, libraryId);
}

async function openLibraryId(window: Page): Promise<string> {
  return window.evaluate(async () => {
    type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    const bridge = globalThis as typeof globalThis & {
      serpent: { library: { listOpen(): Promise<Result<Array<{ libraryId: string }>>> } };
    };
    const opened = await bridge.serpent.library.listOpen();
    const libraryId = opened.ok ? opened.value[0]?.libraryId : undefined;
    if (!libraryId) throw new Error("Expected one open library while sampling task status.");
    return libraryId;
  });
}

/**
 * Read the six media job counters, either through the cached summary path
 * (`summaryOnly: true`) or through the full path that always re-runs the SQL.
 * The two must agree; a fast counter that disagrees is a wrong counter.
 */
async function readMediaJobCounts(
  window: Page,
  libraryId: string,
  summaryOnly: boolean,
): Promise<Record<string, number>> {
  return window.evaluate(async ({ id, cached }) => {
    type Counts = {
      queued: number;
      running: number;
      succeeded: number;
      failed: number;
      paused: number;
      cancelled: number;
    };
    type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listMediaJobs(input: { libraryId: string; summaryOnly?: boolean }): Promise<Result<Counts>>;
        };
      };
    };
    const result = await bridge.serpent.library.listMediaJobs({
      libraryId: id,
      ...(cached ? { summaryOnly: true } : {}),
    });
    if (!result.ok) throw new Error(`Could not read task counts: ${result.error.code}`);
    const { queued, running, succeeded, failed, paused, cancelled } = result.value;
    return { queued, running, succeeded, failed, paused, cancelled };
  }, { id: libraryId, cached: summaryOnly });
}

async function readMediaQueueSnapshot(window: Page): Promise<{
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  paused: number;
  cancelled: number;
}> {
  return window.evaluate(async () => {
    type Status = {
      queued: number;
      running: number;
      succeeded: number;
      failed: number;
      paused: number;
      cancelled: number;
    };
    type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
          listMediaJobs(input: {
            libraryId: string;
            summaryOnly?: boolean;
          }): Promise<Result<Status & { jobs: unknown[] }>>;
        };
      };
    };
    const opened = await bridge.serpent.library.listOpen();
    const libraryId = opened.ok ? opened.value[0]?.libraryId : undefined;
    if (!libraryId) throw new Error("Expected one open library while collecting queue diagnostics.");
    const result = await bridge.serpent.library.listMediaJobs({ libraryId, summaryOnly: true });
    if (!result.ok) throw new Error("Could not collect the media queue diagnostic snapshot.");
    return {
      queued: result.value.queued,
      running: result.value.running,
      succeeded: result.value.succeeded,
      failed: result.value.failed,
      paused: result.value.paused,
      cancelled: result.value.cancelled,
    };
  });
}

/**
 * Queue pausing mutates the library. Keep the run/pause comparison restricted
 * to the generated 20k fixture, with a separate explicit confirmation. The
 * check is deliberately against the fixture manifest, not a path prefix.
 */
function assertDisposableFixtureForQueuePause(libraryPath: string): void {
  if (pauseQueueConfirmation !== "I_ACKNOWLEDGE_DISPOSABLE_FIXTURE") {
    throw new Error("Queue-pause profiling requires SERPENT_PROFILE_PAUSE_QUEUE_CONFIRM=I_ACKNOWLEDGE_DISPOSABLE_FIXTURE.");
  }
  const manifestPath = path.join(libraryPath, ".serpent", "large-library-fixture.json");
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("Queue-pause profiling is allowed only for a generated large-library fixture.");
  }
  if (!manifest || typeof manifest !== "object") {
    throw new Error("The large-library fixture manifest is invalid.");
  }
  const fixture = manifest as {
    version?: unknown;
    assetCount?: unknown;
    assetProfile?: unknown;
    libraryPath?: unknown;
  };
  if (
    fixture.version !== LARGE_LIBRARY_FIXTURE_VERSION
    || fixture.assetCount !== 20_000
    || fixture.assetProfile !== "mixed"
    || typeof fixture.libraryPath !== "string"
    || path.resolve(fixture.libraryPath) !== path.resolve(libraryPath)
  ) {
    throw new Error("Queue-pause profiling requires the current 20,000-asset mixed disposable fixture.");
  }
}

async function controlMediaQueue(window: Page, action: "pause" | "resume"): Promise<number> {
  return window.evaluate(async (queueAction) => {
    type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
          pauseMediaJobs(input: { libraryId: string }): Promise<Result<{ pausedCount: number }>>;
          resumeMediaJobs(input: { libraryId: string }): Promise<Result<{ resumedCount: number }>>;
        };
      };
    };
    const opened = await bridge.serpent.library.listOpen();
    const libraryId = opened.ok ? opened.value[0]?.libraryId : undefined;
    if (!libraryId) throw new Error("Expected one open fixture library while controlling its media queue.");
    if (queueAction === "pause") {
      const result = await bridge.serpent.library.pauseMediaJobs({ libraryId });
      if (!result.ok) throw new Error(`Could not pause the fixture media queue: ${result.error.code}`);
      return result.value.pausedCount;
    }
    const result = await bridge.serpent.library.resumeMediaJobs({ libraryId });
    if (!result.ok) throw new Error(`Could not resume the fixture media queue: ${result.error.code}`);
    return result.value.resumedCount;
  }, action);
}

async function waitForMediaQueuePaused(window: Page, timeoutMs: number): Promise<{
  elapsedMs: number;
  snapshot: Awaited<ReturnType<typeof readMediaQueueSnapshot>>;
}> {
  const startedAt = Date.now();
  let snapshot = await readMediaQueueSnapshot(window);
  while ((snapshot.queued > 0 || snapshot.running > 0) && Date.now() - startedAt < timeoutMs) {
    await window.waitForTimeout(100);
    snapshot = await readMediaQueueSnapshot(window);
  }
  return { elapsedMs: Date.now() - startedAt, snapshot };
}

test("profile navigation hotspots on a real library", async () => {
  const libraryPath = library!;
  // Capture the starting queue before the Worker opens this database. The
  // final breakdown is captured only after the Worker shuts down in `finally`;
  // the test runner must never become a second live database owner.
  const jobGroupsBeforeObservation = idleMs > 0
    ? readPersistedJobGroups(libraryPath)
    : null;
  if (pauseQueueBeforeNavigation) {
    assertDisposableFixtureForQueuePause(libraryPath);
    if (idleMs <= 0 || navTarget || contended || includeJumps || wheelMs > 0 || switches <= 0) {
      throw new Error("Queue-pause profiling requires an idle build-up, folder switches only, and no jumps or wheel probe.");
    }
  }
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "serpent-nav-profile-"));
  const userDataPath = path.join(temporaryRoot, "user-data");
  seedRecentLibraries(userDataPath, [libraryPath], libraryPath);

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: electronLaunchEnv({
      SERPENT_E2E: "1",
      SERPENT_E2E_HIDE_WINDOW: "1",
      SERPENT_E2E_PERF_OFFSCREEN: "1",
      SERPENT_E2E_RESTORE_RECENT: "1",
      SERPENT_E2E_USER_DATA_PATH: userDataPath,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_WORKER_INSPECT: String(workerInspectPort),
      ...benchmarkLogEnv(path.join(userDataPath, "logs")),
    }),
  });

  const timings: Record<string, number[]> = {};
  const timeouts: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  // Every measured folder switch records the real DOM click time here so the
  // Main / Worker navigation spans can be joined to it after the run.
  const navigationClicks: Array<{ prefix: string; clickEpochMs: number; commitEpochMs: number | null }> = [];
  // Failure evidence for jumps that never changed the visible set.
  const jumpDiagnostics: Array<Record<string, unknown>> = [];
  // Jump attempts that produced a real sample, so "all attempts skipped" cannot
  // pass as a green run.
  let jumpMeasured = 0;
  let jumpsScrollable = false;
  // Correctness oracle for the cached task summary (see readMediaJobCounts).
  let statusCountsCached: Record<string, number> | null = null;
  let statusCountsFromSql: Record<string, number> | null = null;
  let statusCountsComparable = false;
  const record = (key: string, value: number): void => {
    (timings[key] ??= []).push(value);
  };
  const recordTimeout = (key: string): void => {
    timeouts[key] = (timeouts[key] ?? 0) + 1;
  };
  let workerProfile: unknown;
  let rendererProfile: unknown;
  let windowForCleanup: Page | undefined;
  let queuePausedForProfile = false;
  let profileReport: Record<string, unknown> | undefined;
  let queueDiagnosticSnapshot: Record<string, unknown> | undefined;

  try {
    const window = await application.firstWindow();
    windowForCleanup = window;
    await window.waitForLoadState("domcontentloaded");
    await installRendererProbe(window);
    await installNavigationClickProbe(window);
    await expect(window.locator(".asset-card").first()).toBeVisible({ timeout: 240_000 });
    const mediaQueueBefore = idleMs > 0 ? await readMediaQueueSnapshot(window) : null;

    // Attach both profilers before the measured journey.
    const workerProfiler = await connectWorkerProfiler(workerInspectPort);
    const cdp = await window.context().newCDPSession(window);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.start");
    await workerProfiler?.start();
    const profileWindowStartedAt = Date.now();

    // Background-only mode keeps the visible library idle while both CPU
    // profilers and queue diagnostics sample a real backlog. Set SWITCHES=0,
    // WHEEL_MS=0, and INCLUDE_JUMPS=0 to isolate throughput.
    if (idleMs > 0) {
      await window.waitForTimeout(idleMs);
      record("background.observedMs", Date.now() - profileWindowStartedAt);
    }

    let mediaQueueAtNavigationStart = idleMs > 0 ? await readMediaQueueSnapshot(window) : null;
    let mediaQueueAtNavigationEnd: Awaited<ReturnType<typeof readMediaQueueSnapshot>> | null = null;
    let queuePauseTransition: { pausedCount: number; elapsedMs: number; settleMs: number } | null = null;
    let queueResumeTransition: { resumedCount: number; elapsedMs: number } | null = null;
    if (
      idleMs > 0
      && minimumQueueSize > 0
      && (mediaQueueAtNavigationStart?.queued ?? 0) + (mediaQueueAtNavigationStart?.running ?? 0) < minimumQueueSize
    ) {
      queueDiagnosticSnapshot = {
        result: "queue-below-minimum",
        minimumQueueSize,
        mediaQueueBefore,
        mediaQueueAtNavigationStart,
        jobGroupsBeforeObservation,
      };
      throw new Error(`The navigation profile requires at least ${minimumQueueSize} queued/running jobs after the idle interval.`);
    }
    if (pauseQueueBeforeNavigation) {
      const beforePause = mediaQueueAtNavigationStart!;
      if (beforePause.paused > 0) {
        throw new Error("Queue-pause A/B requires a fixture with no pre-existing paused media jobs.");
      }
      if (beforePause.queued + beforePause.running < minimumPauseQueueSize) {
        throw new Error(`Queue-pause A/B requires at least ${minimumPauseQueueSize} queued/running jobs after the idle interval.`);
      }
      const pauseStartedAt = Date.now();
      const pausedCount = await controlMediaQueue(window, "pause");
      queuePausedForProfile = true;
      const paused = await waitForMediaQueuePaused(window, 30_000);
      queuePauseTransition = {
        pausedCount,
        elapsedMs: Date.now() - pauseStartedAt,
        settleMs: paused.elapsedMs,
      };
      mediaQueueAtNavigationStart = paused.snapshot;
      if (paused.snapshot.queued > 0 || paused.snapshot.running > 0 || paused.snapshot.paused === 0) {
        throw new Error("The media queue did not reach a fully paused state before navigation profiling.");
      }
    }

    if (navTarget) {
      // 用户复现路径：先回「所有资产」，再点目标 scope（例如 Media > Images > 绘画）
      await window.locator(".navigation-pane button.nav-row").first().click();
      await window.waitForTimeout(1_500);
      const row = window.locator(".navigation-pane button.nav-row").filter({ hasText: navTarget }).first();
      if (await row.count() === 0) {
        recordTimeout("target.scopeUnavailable");
      } else {
        const expectedScope = await row.evaluate((element) => {
          const button = element as HTMLButtonElement;
          return [button.dataset.navFolderKind ?? "", button.dataset.navFolderId ?? "", button.dataset.navCollectionId ?? "", button.querySelector(".nav-row-label")?.textContent?.trim() ?? ""].join("\u0000");
        });
        const beforeIds = await visibleCardIds(window);
        const clickAt = Date.now();
        await row.click();
        const changed = await waitForScopeContentChange(window, expectedScope, beforeIds, 120_000, clickAt);
        if (changed.timedOut) {
          recordTimeout("target.contentChanged");
        } else {
          const thumbs = await waitForAllVisibleThumbnails(window, 120_000);
          if (thumbs.timedOut) recordTimeout("target.allThumbnails");
          else {
            record("target.contentChangedMs", changed.elapsedMs);
            record("target.allThumbnailsMs", thumbs.elapsedMs);
            record("target.imageCards", thumbs.imageCards);
            record("target.undecoded", thumbs.imageCards - thumbs.decoded);
            record("target.placeholders", thumbs.placeholders);
            record("target.totalMs", Date.now() - clickAt);
            console.info(`NAV_TARGET ${JSON.stringify({ changedMs: changed.elapsedMs, thumbs, totalMs: Date.now() - clickAt })}`);
          }
        }
      }
    }

    if (contended) {
      // 复现用户实例日志里的争用：media.get-preview-artifact（viewer-upgrade）单次跑
      // 5.6–15.7 秒时，切文件夹是否还能拿到交互槽。
      await window.locator(".navigation-pane button.nav-row").first().click();
      await window.waitForTimeout(1_500);
      const rows = window.locator(".navigation-pane button.nav-row");
      const scopes = await nonEmptyNavigationScopes(window);
      for (let index = 0; index < 3; index += 1) {
        const card = window.locator(".asset-card[data-media-type='image']").first();
        const scope = scopes[index % Math.max(1, scopes.length)];
        if (!scope || await card.count() === 0) break;
        await card.dblclick();
        // 不等待查看器渲染完：立刻切文件夹，模拟“预览在解码时导航”。
        const before = await visibleCardIds(window);
        const startedAt = Date.now();
        await rows.nth(scope.index).click();
        const changed = await waitForScopeContentChange(window, scope.identity, before, 60_000, startedAt);
        if (changed.timedOut) recordTimeout("contended.contentChanged");
        else {
          const thumbs = await waitForAllVisibleThumbnails(window, 60_000);
          if (thumbs.timedOut) recordTimeout("contended.allThumbnails");
          else {
            record("contended.contentChangedMs", changed.elapsedMs);
            record("contended.allThumbnailsMs", thumbs.elapsedMs);
            record("contended.totalMs", Date.now() - startedAt);
            record("contended.imageCards", thumbs.imageCards);
          }
        }
        await window.keyboard.press("Escape").catch(() => undefined);
        await window.waitForTimeout(500);
      }
    }

    // --- folder switches, measured by real content change ---
    const scopes = await nonEmptyNavigationScopes(window);
    const profiledScopeCounts = scopes.slice(0, Math.min(switches, scopes.length)).map((scope) => scope.count);
    const switchPasses = repeatSwitchesForWarmCache ? 2 : 1;
    for (let pass = 0; pass < switchPasses; pass += 1) {
      const metricPrefix = pauseQueueBeforeNavigation
        ? (pass === 0 ? "folderSwitch.paused" : "folderSwitchRepeat.paused")
        : (pass === 0 ? "folderSwitch" : "folderSwitchRepeat");
      for (let index = 0; index < Math.min(switches, scopes.length); index += 1) {
        const scope = scopes[index]!;
        const before = await visibleCardIds(window);
        const actionStartedAt = Date.now();
        const previousSequence = await window.evaluate(() =>
          (window as typeof window & { __serpentNavigationClickSequence?: number })
            .__serpentNavigationClickSequence ?? 0,
        );
        await window.locator(".navigation-pane button.nav-row").nth(scope.index).click();
        const clickMarker = await readNavigationClickMarker(window, previousSequence);
        if (!clickMarker || clickMarker.identity !== scope.identity) {
          recordTimeout(`${metricPrefix}.clickNotObserved`);
          continue;
        }
        const clickRecord = {
          prefix: metricPrefix,
          clickEpochMs: clickMarker.atEpochMs,
          commitEpochMs: null as number | null,
        };
        navigationClicks.push(clickRecord);
        const changed = await waitForScopeContentChange(
          window,
          scope.identity,
          before,
          60_000,
          clickMarker.atEpochMs,
        );
        if (changed.timedOut) {
          recordTimeout(`${metricPrefix}.contentChanged`);
          continue;
        }
        clickRecord.commitEpochMs = clickMarker.atEpochMs + changed.elapsedMs;
        const thumbnails = await waitForAllVisibleThumbnails(window, 90_000);
        if (thumbnails.timedOut) {
          recordTimeout(`${metricPrefix}.allThumbnails`);
          continue;
        }
        const stats = await visibleImageStats(window);
        record(`${metricPrefix}.clickDispatchMs`, clickMarker.atEpochMs - actionStartedAt);
        record(`${metricPrefix}.totalMs`, Date.now() - clickMarker.atEpochMs);
        record(`${metricPrefix}.activeMs`, changed.activeElapsedMs ?? changed.elapsedMs);
        record(`${metricPrefix}.contentChangedMs`, changed.elapsedMs);
        if (thumbnails.firstDecodedMs !== null) {
          record(`${metricPrefix}.firstThumbnailMs`, thumbnails.firstDecodedMs);
        }
        if (thumbnails.decoded90Ms !== null) {
          record(`${metricPrefix}.thumbnails90Ms`, thumbnails.decoded90Ms);
        }
        record(`${metricPrefix}.thumbnailsLoadedMs`, thumbnails.elapsedMs);
        record(`${metricPrefix}.visibleImageCards`, thumbnails.imageCards);
        record(`${metricPrefix}.undecodedAtTimeout`, thumbnails.imageCards - thumbnails.decoded);
        record(`${metricPrefix}.coveragePct`, Math.round(stats.coverage * 100));
      }
    }
    if (scopes.length === 0) skipped.folderSwitch = switches;
    // Serpent-e97c00: a burst of task-status reads reproduces the panel's ~1 Hz
    // polling without opening the panel, so the summary cache can be A/B'd on
    // the exact command the panel uses.
    if (statusSamples > 0) {
      const samplingLibraryId = await openLibraryId(window);
      for (let index = 0; index < statusSamples; index += 1) {
        record("status.sampleMs", await sampleMediaJobStatus(window, samplingLibraryId));
        if (index < statusSamples - 1 && statusSampleIntervalMs > 0) {
          await window.waitForTimeout(statusSampleIntervalMs);
        }
      }
      // Correctness oracle: the cached summary must equal the counts the full
      // (SQL) path reports. A live queue moves counters between the two reads,
      // so the comparison is only asserted when the queue state did not change
      // in between — otherwise a churning queue would fail a correct cache.
      const queueBeforeOracle = await readMediaQueueSnapshot(window);
      statusCountsCached = await readMediaJobCounts(window, samplingLibraryId, true);
      statusCountsFromSql = await readMediaJobCounts(window, samplingLibraryId, false);
      const queueAfterOracle = await readMediaQueueSnapshot(window);
      statusCountsComparable =
        JSON.stringify(queueBeforeOracle) === JSON.stringify(queueAfterOracle);
    }
    mediaQueueAtNavigationEnd = idleMs > 0 ? await readMediaQueueSnapshot(window) : null;
    if (pauseQueueBeforeNavigation && mediaQueueAtNavigationEnd?.running !== 0) {
      throw new Error("A background media job ran during the paused navigation measurement.");
    }

    if (queuePausedForProfile) {
      const resumeStartedAt = Date.now();
      const resumedCount = await controlMediaQueue(window, "resume");
      queuePausedForProfile = false;
      queueResumeTransition = { resumedCount, elapsedMs: Date.now() - resumeStartedAt };
    }

    // --- 8 s wheel scroll: frame pacing + churn ---
    const canvas = window.locator(".workspace-canvas");
    let wheelProbe: Awaited<ReturnType<typeof readRendererProbe>> | null = null;
    if (wheelMs > 0) {
      // Scope-switch samples may end in a short collection. Measure wheel churn
      // over the library-wide canvas instead of timing an idle, unscrollable view.
      if (switches > 0 && scopes.length > 0) {
        const libraryRow = window.locator(".navigation-pane button.nav-row").first();
        const expectedScope = await libraryRow.evaluate((element) => {
          const button = element as HTMLButtonElement;
          return [button.dataset.navFolderKind ?? "", button.dataset.navFolderId ?? "", button.dataset.navCollectionId ?? "", button.querySelector(".nav-row-label")?.textContent?.trim() ?? ""].join("\u0000");
        });
        const beforeIds = await visibleCardIds(window);
        await libraryRow.click();
        const changed = await waitForScopeContentChange(window, expectedScope, beforeIds, 30_000);
        expect(changed.timedOut, "Wheel profiling must return to the library-wide scope").toBe(false);
      }
      const canvasIsScrollable = await canvas.evaluate((element) => element.scrollHeight > element.clientHeight + 1);
      if (!canvasIsScrollable) skipped.wheelNotScrollable = 1;
      else {
        const ablationRules: Record<string, string> = {
          "hide-live-video": ".asset-card-media-live:is(video) { display: none !important; }",
          "remove-isolation": ".asset-preview { isolation: auto !important; }",
          "remove-rounded-clips": ".asset-preview, .asset-card-media { overflow: visible !important; border-radius: 0 !important; }",
          "no-card-pointer": ".asset-card { pointer-events: none !important; }",
          "hide-covers": ".asset-thumbnail { display: none !important; }",
          "hide-media": ".asset-card-media { display: none !important; }",
        };
        if (styleAblation) {
          const rule = ablationRules[styleAblation];
          if (!rule) throw new Error(`Unsupported style ablation: ${styleAblation}`);
          await window.addStyleTag({ content: rule });
        }
        await resetRendererCounters(window);
        const box = await canvas.boundingBox();
        if (box) await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const wheelTraceEvents: Array<Record<string, unknown>> = [];
        if (traceWheel) {
          cdp.on("Tracing.dataCollected", (payload: { value?: unknown }) => {
            if (Array.isArray(payload.value)) wheelTraceEvents.push(...payload.value);
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
        const wheelStartedAt = Date.now();
        let direction = 1;
        while (Date.now() - wheelStartedAt < wheelMs) {
          if (!suppressWheelInput) {
            await window.mouse.wheel(0, direction * (80 + Math.floor(Math.random() * 260)));
          }
          await window.waitForTimeout(60 + Math.floor(Math.random() * 90));
          if (Math.random() < 0.3) direction *= -1;
        }
        wheelProbe = await readRendererProbe(window);
        if (traceWheel) {
          const complete = new Promise<void>((resolve) => {
            cdp.once("Tracing.tracingComplete", () => resolve());
          });
          await cdp.send("Tracing.end");
          await complete;
          mkdirSync(outDir!, { recursive: true });
          writeFileSync(path.join(outDir!, "wheel-trace.json"), JSON.stringify(wheelTraceEvents));
        }
        if (wheelMs >= 1_000) {
          expect(wheelProbe.frameSamples, "Hidden performance windows must render frames during wheel profiling")
            .toBeGreaterThan(5);
        }
      }
    }
    const wheelDom = await window.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>(".workspace-canvas");
      const grid = document.querySelector<HTMLElement>(".asset-grid");
      return {
        gridClass: grid?.className ?? "",
        mountedCards: grid?.querySelectorAll(".asset-card").length ?? 0,
        mountedSlots: grid?.querySelectorAll("[data-layout-asset-id]").length ?? 0,
        mountedImages: grid?.querySelectorAll("img.asset-thumbnail").length ?? 0,
        mountedVideos: grid?.querySelectorAll("video.asset-card-media-live").length ?? 0,
        canvasHeight: canvas?.clientHeight ?? 0,
        scrollHeight: canvas?.scrollHeight ?? 0,
      };
    });
    if (process.env.SERPENT_PROFILE_SCREENSHOT === "1") {
      mkdirSync(outDir!, { recursive: true });
      await window.screenshot({ path: path.join(outDir!, "wheel.png") });
    }
    const jobStatusStats = await window.evaluate(() =>
      (globalThis as typeof globalThis & { __serpentJobStatusStats?: unknown })
        .__serpentJobStatusStats ?? null,
    );
    const mediaJobsDialogOpen = await window.evaluate(() =>
      document.querySelector("#media-jobs-dialog") !== null,
    );

    // --- random jumps: input → painted decoded content ---
    // Background-only profiles omit this entire interaction to keep the queue
    // observation uncontended.
    if (includeJumps) {
      // Jump timing is meaningful only on a scrollable library-wide scope.
      await window.locator(".navigation-pane button.nav-row").first().click();
      await window.waitForTimeout(1_000);
      const canvasIsScrollable = await canvas.evaluate((element) => element.scrollHeight > element.clientHeight + 1).catch(() => false);
      jumpsScrollable = canvasIsScrollable;
      // Alternate direction and magnitude: a no-op wheel (app still settling,
      // pointer over a covered region) is not evidence either way, so a
      // `no-scroll` attempt is retried with the next delta instead of being
      // counted as a failed jump.
      const maximumScroll = await canvas.evaluate((element) =>
        Math.max(0, element.scrollHeight - element.clientHeight));
      const jumpDeltas = percentJump
        ? [Math.round(maximumScroll * 0.05), Math.round(maximumScroll * 0.5)]
        : [6_000, -9_000, 12_000, -15_000];
      for (const deltaPx of jumpDeltas) {
        if (!canvasIsScrollable || jumpMeasured >= 3) break;
        const jump = await measureScrollJump(window, deltaPx, 30_000);
        if (jump.outcome === "changed") {
          jumpMeasured += 1;
          record("jump.changedMs", jump.elapsedMs);
          record("jump.scrolledPx", jump.scrolledPx);
          const thumbnails = await waitForAllVisibleThumbnails(window, 30_000);
          const decodedBaseMs = jump.elapsedMs;
          if (thumbnails.firstDecodedMs != null) {
            record("jump.firstDecodedMs", decodedBaseMs + thumbnails.firstDecodedMs);
          }
          if (thumbnails.decoded90Ms != null) {
            record("jump.decoded90Ms", decodedBaseMs + thumbnails.decoded90Ms);
          }
          if (!thumbnails.timedOut) {
            record("jump.allDecodedMs", decodedBaseMs + thumbnails.elapsedMs);
          } else {
            recordTimeout("jump.allDecoded");
          }
          record("jump.visibleImageCards", thumbnails.imageCards);
          continue;
        }
        jumpDiagnostics.push({
          deltaPx,
          outcome: jump.outcome,
          scrolledPx: jump.scrolledPx,
          observedCount: jump.observedCount,
          elapsedMs: jump.elapsedMs,
        });
        if (jump.outcome === "no-commit") {
          // The position held for the whole budget and the content never came:
          // that is a real failure, not a harness precondition.
          recordTimeout("jump.contentChanged");
          continue;
        }
        const skipKey = jump.outcome === "unsettled"
          ? "jumpsUnsettled"
          : jump.outcome === "no-scroll"
            ? "jumpsNoScroll"
            : "jumpsRestored";
        skipped[skipKey] = (skipped[skipKey] ?? 0) + 1;
      }
      if (!canvasIsScrollable) skipped.jumps = 3;
    }

    // --- stop profilers ---
    const profileWindowEndedAt = Date.now();
    rendererProfile = await cdp.send("Profiler.stop").then((result: { profile?: unknown }) => result.profile);
    workerProfile = await workerProfiler?.stop() ?? null;
    const mediaQueueAfter = idleMs > 0 ? await readMediaQueueSnapshot(window) : null;

    const rendererRows = rendererProfile
      ? topFunctions(rendererProfile as Parameters<typeof topFunctions>[0])
      : [];
    const workerRows = workerProfile
      ? topFunctions(workerProfile as Parameters<typeof topFunctions>[0])
      : [];
    const sessionLog = readSessionLog(userDataPath);
    const log = summarizeBenchLog(sessionLog);
    // Serpent-217028: join each measured click to the navigation Main and the
    // Worker actually ran. Both sides now log the same navigation id, so the
    // renderer start is derived from Main's own clock stamp minus the measured
    // renderer -> Main hop rather than assuming synchronised clocks.
    const navigationChain = navigationClicks.map((click) => {
      const candidates = log.navigations.stages
        .filter((stage) => stage.mainEnteredAtEpochMs !== null && stage.rendererToMainMs !== null)
        .map((stage) => ({
          stage,
          rendererStartEpochMs: stage.mainEnteredAtEpochMs! - stage.rendererToMainMs!,
        }))
        .filter(({ rendererStartEpochMs }) =>
          Math.abs(rendererStartEpochMs - click.clickEpochMs) <= 10_000)
        .sort((left, right) =>
          Math.abs(left.rendererStartEpochMs - click.clickEpochMs)
          - Math.abs(right.rendererStartEpochMs - click.clickEpochMs));
      const match = candidates[0];
      if (!match) return { prefix: click.prefix, matched: false as const };
      const { stage, rendererStartEpochMs } = match;
      const segments: Record<string, number> = {
        // Click -> the renderer actually issuing the browse request.
        rendererDispatchMs: Math.max(0, rendererStartEpochMs - click.clickEpochMs),
      };
      if (stage.rendererToMainMs !== null) segments.mainReceiveMs = stage.rendererToMainMs;
      if (stage.mainElapsedMs !== null) segments.mainWorkerMs = stage.mainElapsedMs;
      if (stage.workerRoundTripMs !== null) segments.workerRoundTripMs = stage.workerRoundTripMs;
      if (stage.workerSchedulerWaitMs !== null) segments.workerSchedulerWaitMs = stage.workerSchedulerWaitMs;
      if (stage.workerRunMs !== null) segments.workerRunMs = stage.workerRunMs;
      if (stage.mainPostProcessMs !== null) segments.mainPostProcessMs = stage.mainPostProcessMs;
      if (stage.mainToIpcReturnMs !== null) segments.mainToIpcReturnMs = stage.mainToIpcReturnMs;
      if (click.commitEpochMs !== null && stage.mainReturnedAtEpochMs !== null) {
        // Main returned the response -> the renderer committed the new cards.
        segments.mainReturnToCommitMs = Math.max(0, click.commitEpochMs - stage.mainReturnedAtEpochMs);
      }
      for (const [key, value] of Object.entries(segments)) record(`${click.prefix}.${key}`, value);
      return { prefix: click.prefix, matched: true as const, navigation: stage.label, segments };
    });
    const navigationChainMatched = navigationChain.filter((entry) => entry.matched).length;
    const navigationChainMisses = navigationClicks.length - navigationChainMatched;
    if (pauseQueueBeforeNavigation) {
      const resumeCommand = log.commands.find((command) => command.commandType === "media.resume-jobs");
      expect(resumeCommand?.runMs.maxMs, "Resuming durable jobs must not synchronously refill the whole catalogue").toBeLessThan(2_000);
      expect(queueResumeTransition?.elapsedMs, "The user-visible resume request must return promptly").toBeLessThan(2_000);
      expect(queueResumeTransition?.resumedCount).toBe(mediaQueueAtNavigationStart?.paused);
      const boundedQueueCeiling = (mediaQueueAtNavigationStart?.paused ?? 0)
        + (mediaQueueAtNavigationEnd?.queued ?? 0)
        + 1_000;
      expect(mediaQueueAfter?.queued, "Resume may add only the bounded queue-pump continuation, not a whole-catalogue fill")
        .toBeLessThanOrEqual(boundedQueueCeiling);
    }
    const backgroundObservation = idleMs > 0
      ? summarizeMediaQueueWindow(sessionLog, profileWindowStartedAt, profileWindowEndedAt)
      : null;
    const report = {
      suite: "navigation-profile",
      wheelMs,
      switches,
      previewCacheForced: (process.env.SERPENT_PREVIEW_CACHE_FORCE ?? "1") === "1",
      includeJumps,
      idleMs,
      minimumQueueSize,
      repeatSwitchesForWarmCache,
      minScopeAssets,
      minVisibleImages,
      profileWindowMs: profileWindowEndedAt - profileWindowStartedAt,
      profileWindowStartedAt: new Date(profileWindowStartedAt).toISOString(),
      profileWindowEndedAt: new Date(profileWindowEndedAt).toISOString(),
      profiledScopeCounts,
      timings: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summarizeTimings(values)])),
      timeouts,
      skipped,
      wheelProbe,
      wheelDom,
      jobStatusStats,
      mediaJobsDialogOpen,
      backgroundObservation,
      mediaQueueBefore,
      jobGroupsBeforeObservation,
      mediaQueueAtNavigationStart,
      jobGroupsAfterProfile: null,
      jobGroupTransitions: null,
      mediaQueueAtNavigationEnd,
      mediaQueueAfter,
      queuePauseTransition,
      queueResumeTransition,
      queuePausedForNavigation: pauseQueueBeforeNavigation,
      rendererTop: rendererRows,
      workerTop: workerRows,
      workerProfilerAttached: workerProfile !== null,
      navigationChain,
      navigationChainMatched,
      navigationChainMisses,
      jumpDiagnostics,
      jumpMeasured,
      jumpsScrollable,
      statusSamples,
      statusSampleIntervalMs,
      statusCountsCached,
      statusCountsFromSql,
      statusCountsComparable,
      log,
    };
    profileReport = report;
    writeBenchReport(path.join(outDir!, "nav-profile.json"), report);
    if (rendererProfile) writeFileSync(path.join(outDir!, "renderer.cpuprofile"), JSON.stringify(rendererProfile));
    if (workerProfile) writeFileSync(path.join(outDir!, "worker.cpuprofile"), JSON.stringify(workerProfile));
    console.info(`NAV_PROFILE ${JSON.stringify({
      timings: report.timings,
      wheel: wheelProbe
        ? {
            longTaskMax: wheelProbe.longTaskMaxMs,
            frameP95: wheelProbe.frameP95Ms,
            frameMax: wheelProbe.frameMaxMs,
            srcWrites: wheelProbe.mediaSrcWrites,
          }
        : null,
      rendererTop: rendererRows.slice(0, 10),
      workerTop: workerRows.slice(0, 10),
      workerAttached: workerProfile !== null,
    })}`);
    // Keep the session log next to the profiles for offline attribution.
    try {
      writeFileSync(path.join(outDir!, "session.log"), sessionLog);
    } catch {
      // Diagnostics only.
    }
    expect(timeouts, "Navigation profile timeouts are failures and are excluded from latency percentiles").toEqual({});
    // Navigation tracing is produced by the Main-side `performance.navigation`
    // spans. When the build under test has no producer the chain cannot be
    // established at all: record that as a coverage gap (the report keeps
    // `log.navigations.count`) instead of failing the run, but never accept a
    // partial join when tracing is present.
    if (log.navigations.count > 0) {
      expect(
        navigationChainMisses,
        "Every measured switch must be attributable to a Main/Worker navigation span (Serpent-217028 navigationId join)",
      ).toBe(0);
    }
    if (includeJumps && jumpsScrollable) {
      expect(
        jumpMeasured,
        "A scrollable library-wide scope must yield at least one real jump sample; skipped preconditions are not a green jump result",
      ).toBeGreaterThan(0);
    }
    if (statusCountsCached !== null && statusCountsFromSql !== null && statusCountsComparable) {
      expect(
        statusCountsCached,
        "The cached task summary must equal the counts the full SQL path reports (Serpent-e97c00)",
      ).toEqual(statusCountsFromSql);
    }
    if (switches > 0) {
      const contentChangedKey = pauseQueueBeforeNavigation
        ? "folderSwitch.paused.contentChangedMs"
        : "folderSwitch.contentChangedMs";
      const visibleImagesKey = pauseQueueBeforeNavigation
        ? "folderSwitch.paused.visibleImageCards"
        : "folderSwitch.visibleImageCards";
      expect(timings[contentChangedKey]?.length ?? 0, "Profile must complete at least one non-empty folder switch").toBeGreaterThan(0);
      expect(Math.min(...profiledScopeCounts), "Profile must use non-empty scopes with enough assets").toBeGreaterThanOrEqual(minScopeAssets);
      expect(Math.min(...(timings[visibleImagesKey] ?? [])), "Profile must observe a representative visible image set").toBeGreaterThanOrEqual(minVisibleImages);
    }
  } finally {
    if (queuePausedForProfile && windowForCleanup) {
      await controlMediaQueue(windowForCleanup, "resume").catch((error: unknown) => {
        console.error("Could not resume media jobs after queue-pause profiling on the disposable fixture.", error);
      });
    }
    await application.close().catch(() => undefined);
    let jobGroupsAfterProfile: PersistedJobGroup[] | null = null;
    if (idleMs > 0) {
      try {
        jobGroupsAfterProfile = readPersistedJobGroups(libraryPath);
      } catch {
        // The performance result still stands if a read-only post-shutdown
        // snapshot is unavailable; the gap is explicit in the report.
      }
    }
    if (profileReport) {
      profileReport.jobGroupsAfterProfile = jobGroupsAfterProfile;
      profileReport.jobGroupTransitions = diffPersistedJobGroups(
        jobGroupsBeforeObservation,
        jobGroupsAfterProfile,
      );
      writeBenchReport(path.join(outDir!, "nav-profile.json"), profileReport);
    }
    if (queueDiagnosticSnapshot) {
      queueDiagnosticSnapshot.jobGroupsAfterProfile = jobGroupsAfterProfile;
      queueDiagnosticSnapshot.jobGroupTransitions = diffPersistedJobGroups(
        jobGroupsBeforeObservation,
        jobGroupsAfterProfile,
      );
      writeBenchReport(path.join(outDir!, "queue-snapshot.json"), queueDiagnosticSnapshot);
    }
    try {
      // Windows keeps handles on the isolated profile for a moment after the app
      // exits (Defender/indexer). Retry, and never let cleanup replace the real
      // failure: a masked error here once hid the actual cause of a red run.
      rmSync(temporaryRoot, { force: true, recursive: true, maxRetries: 20, retryDelay: 250 });
    } catch (error) {
      console.error("Could not remove the isolated navigation-profile userData directory.", error);
    }
  }
});





