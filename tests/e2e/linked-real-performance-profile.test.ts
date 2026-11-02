import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statfsSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";

import { openLinkedFolderImportMenu, resolveElectronExecutablePath, waitForLibraryLoadingToFinish } from "./electron-test-helpers";
import { installRendererProbe, readRendererProbe, resetRendererCounters, waitForVisibleDecoded } from "./perf-bench-helpers";

/** Opt-in diagnostic: the source tree is only read; the catalog lives in an owned temporary directory. */
const sourcePath = process.env.SERPENT_LINK_PROFILE_SOURCE;
const tempParentPath = process.env.SERPENT_LINK_PROFILE_TEMP_PARENT;

test.describe.configure({ timeout: 600_000 });
test.skip(!sourcePath || !tempParentPath, "Set a real linked source and a separate temporary parent directory.");

function removeOwnedTree(directory: string, parent: string): void {
  if (path.dirname(directory) !== parent || !path.basename(directory).startsWith("serpent-linked-profile-")) {
    throw new Error("Refusing to remove a directory outside this test's temporary parent.");
  }
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const entry = path.join(current, name);
      const info = lstatSync(entry);
      if (info.isSymbolicLink()) {
        throw new Error("Refusing to traverse a reparse point in the test directory.");
      }
      if (info.isDirectory()) walk(entry);
      else unlinkSync(entry);
    }
    rmdirSync(current);
  };
  if (lstatSync(directory).isSymbolicLink()) throw new Error("The test directory became a reparse point.");
  walk(directory);
}

/** Keep only sanitized function/file names from the renderer's V8 self-time samples. */
function topRendererFunctions(profile: {
  nodes: Array<{ id: number; callFrame: { functionName: string; url: string; columnNumber?: number }; children?: number[] }>;
  samples?: number[];
  timeDeltas?: number[];
}): Array<{ functionName: string; bundle: string; selfMs: number }> {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map<string, { functionName: string; bundle: string; selfMs: number }>();
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    const node = nodes.get(profile.samples![index]!);
    if (!node) continue;
    const functionName = node.callFrame.functionName || "(anonymous)";
    const bundle = node.callFrame.url.replace(/^.*[/\\]/, "");
    const key = `${functionName}\u0000${bundle}`;
    const row = totals.get(key) ?? { functionName, bundle, selfMs: 0 };
    row.selfMs += (profile.timeDeltas?.[index] ?? 0) / 1000;
    totals.set(key, row);
  }
  return [...totals.values()]
    .sort((left, right) => right.selfMs - left.selfMs)
    .slice(0, 15)
    .map((row) => ({ ...row, selfMs: Number(row.selfMs.toFixed(1)) }));
}

/** Attribute a hot helper to its direct callers without logging local URLs. */
function rendererCallers(profile: Parameters<typeof topRendererFunctions>[0], functionName: string) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id);
  }
  const totals = new Map<string, { caller: string; column: number; selfMs: number }>();
  for (let index = 0; index < (profile.samples?.length ?? 0); index += 1) {
    const id = profile.samples![index]!;
    if (nodes.get(id)?.callFrame.functionName !== functionName) continue;
    const frame = nodes.get(parents.get(id) ?? -1)?.callFrame;
    const caller = frame?.functionName || "(anonymous)";
    const column = frame?.columnNumber ?? -1;
    const key = `${caller}:${column}`;
    const row = totals.get(key) ?? { caller, column, selfMs: 0 };
    row.selfMs += (profile.timeDeltas?.[index] ?? 0) / 1000;
    totals.set(key, row);
  }
  return [...totals.values()]
    .sort((left, right) => right.selfMs - left.selfMs)
    .slice(0, 10)
    .map((row) => ({ ...row, selfMs: Number(row.selfMs.toFixed(1)) }));
}

function hotRendererCallers(profile: Parameters<typeof topRendererFunctions>[0]) {
  return topRendererFunctions(profile)
    .filter((row) => row.bundle && row.functionName !== "(anonymous)")
    .slice(0, 3)
    .map((row) => ({ functionName: row.functionName, callers: rendererCallers(profile, row.functionName) }));
}

async function readMediaJobSummary(window: Page) {
  return window.evaluate(async () => {
    type Counts = { queued: number; running: number; succeeded: number; failed: number; paused: number; cancelled: number };
    type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    const bridge = globalThis as typeof globalThis & {
      serpent: { library: {
        listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
        getMediaJobSummary(input: { libraryId: string }): Promise<Result<Counts>>;
      } };
    };
    const opened = await bridge.serpent.library.listOpen();
    const libraryId = opened.ok ? opened.value[0]?.libraryId : undefined;
    if (!libraryId) throw new Error("No open library while reading job counts.");
    const result = await bridge.serpent.library.getMediaJobSummary({ libraryId });
    if (!result.ok) throw new Error(`Could not read job counts: ${result.error.code}`);
    return result.value;
  });
}

async function readMediaJobGroups(window: Page) {
  return window.evaluate(async () => {
    type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    type JobPage = {
      jobs: Array<{ kind: string; status: string }>;
      nextCursor: { createdAt: string; jobId: string } | null;
      hasMore: boolean;
    };
    const bridge = globalThis as typeof globalThis & {
      serpent: { library: {
        listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
        listMediaJobs(input: { libraryId: string; limit: number; cursor?: JobPage["nextCursor"] }): Promise<Result<JobPage>>;
      } };
    };
    const opened = await bridge.serpent.library.listOpen();
    const libraryId = opened.ok ? opened.value[0]?.libraryId : undefined;
    if (!libraryId) throw new Error("No open library while reading job groups.");
    const groups: Record<string, number> = {};
    let cursor: JobPage["nextCursor"] = null;
    let pages = 0;
    do {
      const result: Result<JobPage> = await bridge.serpent.library.listMediaJobs({
        libraryId,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      if (!result.ok) throw new Error(`Could not read job groups: ${result.error.code}`);
      for (const job of result.value.jobs) {
        const key = `${job.kind}:${job.status}`;
        groups[key] = (groups[key] ?? 0) + 1;
      }
      cursor = result.value.hasMore ? result.value.nextCursor : null;
      pages += 1;
    } while (cursor && pages < 30);
    return { groups, pages, truncated: cursor !== null };
  });
}

test("profile first linked-folder browse with real external images", async () => {
  const source = realpathSync(sourcePath!);
  const parent = realpathSync(tempParentPath!);
  const disjoint = source !== parent
    && !source.startsWith(parent + path.sep)
    && !parent.startsWith(source + path.sep);
  expect(disjoint, "Temporary catalog and linked source must be separate trees").toBe(true);
  const disk = statfsSync(parent);
  expect(disk.bavail * disk.bsize, "Provide at least 10 GiB free for a real linked-folder profile")
    .toBeGreaterThan(10 * 1024 ** 3);

  const candidate = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      children: readdirSync(path.join(source, entry.name), { withFileTypes: true }),
    }))
    .map((entry) => ({
      name: entry.name,
      directFiles: entry.children.filter((child) => child.isFile()).length,
      imageFiles: entry.children.filter((child) =>
        child.isFile() && /\.(?:jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(child.name),
      ).length,
      directFolders: entry.children.filter((child) => child.isDirectory()).length,
    }))
    // The image-scroll profile needs images at the top of the viewport.
    // A folder-heavy directory can place its asset grid many screens below
    // the folder-card row, which measures folder rendering instead.
    .filter((entry) => entry.directFolders === 0
      && entry.imageFiles > 100
      && entry.imageFiles / entry.directFiles >= 0.8)
    .sort((left, right) => right.imageFiles - left.imageFiles)[0];
  expect(candidate?.imageFiles ?? 0, "A representative subfolder must contain real image files")
    .toBeGreaterThan(100);

  const temporaryRoot = mkdtempSync(path.join(parent, "serpent-linked-profile-"));
  const libraryName = "Performance Fixture";
  const libraryPath = path.join(temporaryRoot, libraryName);
  let application: ElectronApplication | undefined;
  try {
    const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
    application = await electron.launch({
      args: [applicationDirectory],
      cwd: applicationDirectory,
      executablePath: resolveElectronExecutablePath(),
      env: {
        ...process.env,
        SERPENT_E2E: "1",
        SERPENT_E2E_HIDE_WINDOW: "1",
        SERPENT_E2E_PERF_OFFSCREEN: "1",
        SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, "user-data"),
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_LINKED_SOURCE: source,
      },
    });
    const window = await application.firstWindow();
    const createStartedAt = Date.now();
    await window.getByRole("button", { name: "创建资源库" }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole("button", { name: "创建", exact: true }).click();
    await expect(window.getByRole("heading", { name: "导入资产以开始整理" })).toBeVisible();
    await waitForLibraryLoadingToFinish(window);
    const createMs = Date.now() - createStartedAt;

    const linkStartedAt = Date.now();
    await window.evaluate(() => {
      type ProgressMark = { phase: string; at: number; filesProcessed: number };
      const target = globalThis as unknown as Window & {
        serpent?: { library?: { onProgress: (listener: (event: {
          type: string;
          phase?: string;
          copiesFiles?: boolean;
          filesProcessed?: number;
        }) => void) => () => void } };
        __linkedProfileMarks?: ProgressMark[];
      };
      target.__linkedProfileMarks = [];
      target.serpent?.library?.onProgress((event) => {
        if (event.type !== "import.progress" || event.copiesFiles !== false || !event.phase) return;
        target.__linkedProfileMarks?.push({
          phase: event.phase,
          at: Date.now(),
          filesProcessed: event.filesProcessed ?? 0,
        });
      });
    });
    await openLinkedFolderImportMenu(application, window);
    const rootRow = window.locator(".navigation-pane button.nav-row")
      .filter({ hasText: path.basename(source) }).first();
    await expect(rootRow).toBeVisible({ timeout: 240_000 });
    const rootVisibleMs = Date.now() - linkStartedAt;
    const jobsAtRoot = await readMediaJobSummary(window);
    await rootRow.click();
    const childRow = window.locator(".navigation-pane button.nav-row")
      .filter({ hasText: candidate!.name }).first();
    await expect(childRow).toBeVisible({ timeout: 240_000 });
    const childStartedAt = Date.now();
    await childRow.click();
    await expect(window.locator(".asset-card[data-media-type='image']").first())
      .toBeVisible({ timeout: 240_000 });
    const firstImageCardMs = Date.now() - childStartedAt;
    const decoded = await waitForVisibleDecoded(window, 0.8, 120_000);
    expect(decoded.timedOut, "At least 80% of visible real images must decode").toBe(false);

    await installRendererProbe(window);
    await resetRendererCounters(window);
    const rendererProfiler = await window.context().newCDPSession(window);
    await rendererProfiler.send("Profiler.enable");
    const canvas = window.locator(".workspace-canvas");
    const scrollableStartedAt = Date.now();
    await expect.poll(() => canvas.evaluate((element) => element.scrollHeight > element.clientHeight + 1), {
      timeout: 120_000,
    }).toBe(true);
    const scrollableMs = Date.now() - scrollableStartedAt;
    const box = await canvas.boundingBox();
    if (box) await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await rendererProfiler.send("Profiler.start");
    const wheelStartedAt = Date.now();
    while (Date.now() - wheelStartedAt < 2_500) {
      await window.mouse.wheel(0, 260);
      await window.waitForTimeout(90);
    }
    const firstProfile = (await rendererProfiler.send("Profiler.stop") as {
      profile: Parameters<typeof topRendererFunctions>[0];
    }).profile;
    const wheel = await readRendererProbe(window);
    const jobsAfterFirstWheel = await readMediaJobSummary(window);
    expect(wheel.frameSamples, "The hidden profile must actually render frames").toBeGreaterThan(5);
    await window.waitForTimeout(5_000);
    await resetRendererCounters(window);
    const reverseStartedAt = Date.now();
    while (Date.now() - reverseStartedAt < 2_500) {
      await window.mouse.wheel(0, -260);
      await window.waitForTimeout(90);
    }
    const reverseWheel = await readRendererProbe(window);
    // Revisit the same forward range after its summary pages have entered the
    // browse cache. This separates first-page hydration from repeated image
    // mounts and decoding on an otherwise comparable scroll gesture.
    await canvas.evaluate((element) => { element.scrollTop = 0; });
    await expect.poll(() => canvas.evaluate((element) => element.scrollTop), {
      timeout: 10_000,
    }).toBeLessThan(2);
    await window.waitForTimeout(500);
    await resetRendererCounters(window);
    await rendererProfiler.send("Profiler.start");
    const warmedForwardStartedAt = Date.now();
    while (Date.now() - warmedForwardStartedAt < 2_500) {
      await window.mouse.wheel(0, 260);
      await window.waitForTimeout(90);
    }
    const warmedProfile = (await rendererProfiler.send("Profiler.stop") as {
      profile: Parameters<typeof topRendererFunctions>[0];
    }).profile;
    await rendererProfiler.detach();
    const warmedForward = await readRendererProbe(window);
    await resetRendererCounters(window);
    await window.waitForTimeout(2_500);
    const idle = await readRendererProbe(window);
    const jobsAfterIdle = await readMediaJobSummary(window);
    const jobGroupsAfterIdle = await readMediaJobGroups(window);
    const afterScrollDecoded = await waitForVisibleDecoded(window, 0.8, 15_000);
    expect(afterScrollDecoded.timedOut, "Scrolled real images must remain visible and decode")
      .toBe(false);
    const progressMarks = await window.evaluate(() => (globalThis as unknown as {
      __linkedProfileMarks?: Array<{ phase: string; at: number; filesProcessed: number }>;
    }).__linkedProfileMarks ?? []);
    const firstPhase = (phase: string) => progressMarks.find((mark) => mark.phase === phase);
    const progress = {
      firstValidateMs: firstPhase("validate")?.at ? firstPhase("validate")!.at - linkStartedAt : null,
      copyStartedMs: firstPhase("copy")?.at ? firstPhase("copy")!.at - linkStartedAt : null,
      completeMs: firstPhase("complete")?.at ? firstPhase("complete")!.at - linkStartedAt : null,
      lastCopyCount: progressMarks.filter((mark) => mark.phase === "copy").at(-1)?.filesProcessed ?? null,
    };
    console.info(`LINKED_REAL_PROFILE ${JSON.stringify({
      sourceFilesEstimate: candidate!.directFiles,
      createMs,
      rootVisibleMs,
      jobsAtRoot,
      jobsAfterFirstWheel,
      jobsAfterIdle,
      jobGroupsAfterIdle,
      progress,
      firstImageCardMs,
      decoded80Ms: decoded.elapsedMs,
      visibleCoverage: decoded.stats.coverage,
      scrollableMs,
      wheel: {
        frameSamples: wheel.frameSamples,
        frameP95Ms: wheel.frameP95Ms,
        frameMaxMs: wheel.frameMaxMs,
        longTaskCount: wheel.longTaskCount,
        longTaskMaxMs: wheel.longTaskMaxMs,
        longTaskTotalMs: wheel.longTaskTotalMs,
        slotCreated: wheel.slotCreated,
        slotRemoved: wheel.slotRemoved,
        mediaSrcWrites: wheel.mediaSrcWrites,
        maxSrcWritesOnOneElement: wheel.maxSrcWritesOnOneElement,
        distinctMediaUrls: wheel.distinctMediaUrls,
        browseRequests: wheel.browseRequests,
        browseResults: wheel.browseResults,
        browsePages: wheel.browsePages,
      },
      reverseWheel: {
        frameSamples: reverseWheel.frameSamples,
        frameP95Ms: reverseWheel.frameP95Ms,
        longTaskCount: reverseWheel.longTaskCount,
        longTaskTotalMs: reverseWheel.longTaskTotalMs,
        slotCreated: reverseWheel.slotCreated,
        slotRemoved: reverseWheel.slotRemoved,
        mediaSrcWrites: reverseWheel.mediaSrcWrites,
        maxSrcWritesOnOneElement: reverseWheel.maxSrcWritesOnOneElement,
        distinctMediaUrls: reverseWheel.distinctMediaUrls,
        browseRequests: reverseWheel.browseRequests,
        browseResults: reverseWheel.browseResults,
        browsePages: reverseWheel.browsePages,
      },
      warmedForward: {
        frameSamples: warmedForward.frameSamples,
        frameP95Ms: warmedForward.frameP95Ms,
        longTaskCount: warmedForward.longTaskCount,
        longTaskTotalMs: warmedForward.longTaskTotalMs,
        slotCreated: warmedForward.slotCreated,
        slotRemoved: warmedForward.slotRemoved,
        mediaSrcWrites: warmedForward.mediaSrcWrites,
        maxSrcWritesOnOneElement: warmedForward.maxSrcWritesOnOneElement,
        distinctMediaUrls: warmedForward.distinctMediaUrls,
        browseRequests: warmedForward.browseRequests,
        browseResults: warmedForward.browseResults,
        browsePages: warmedForward.browsePages,
      },
      idle: {
        frameSamples: idle.frameSamples,
        frameP95Ms: idle.frameP95Ms,
        longTaskCount: idle.longTaskCount,
        browseRequests: idle.browseRequests,
        browseResults: idle.browseResults,
        browsePages: idle.browsePages,
      },
      afterScrollVisibleCoverage: afterScrollDecoded.stats.coverage,
      firstRendererTop: topRendererFunctions(firstProfile),
      warmedRendererTop: topRendererFunctions(warmedProfile),
      firstHotCallers: hotRendererCallers(firstProfile),
      warmedHotCallers: hotRendererCallers(warmedProfile),
    })}`);
  } finally {
    try {
      await application?.close();
    } finally {
      removeOwnedTree(temporaryRoot, parent);
    }
  }
});
