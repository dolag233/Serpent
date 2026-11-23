import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statfsSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { SerpentLibraryApi } from '../../src/shared/library-api';
import {
  createThumbnailMemoryProbe,
} from './thumbnail-memory-probe';
import {
  launchBenchmarkApp,
  visibleImageStats,
} from './perf-bench-helpers';

const sourceRoot = process.env.SERPENT_REAL_MEMORY_SOURCE_ROOT;
const targetCompletions = parsePositiveInteger(process.env.SERPENT_REAL_MEMORY_TARGET, 5_000);
const memoryTimeoutMs = parsePositiveInteger(process.env.SERPENT_REAL_MEMORY_TIMEOUT_MS, 20 * 60_000);
const idleSeconds = parseIdleSeconds(
  process.env.SERPENT_REAL_MEMORY_IDLE_SECONDS,
  targetCompletions <= 100 ? [5, 15] : [15, 45, 90],
);
const collectFinalGarbage = process.env.SERPENT_REAL_MEMORY_COLLECT_GC === '1';
const captureFinalHeap = process.env.SERPENT_REAL_MEMORY_HEAP === '1';
// Keep the pause-control reproducer separate from the natural-drain memory run.
const pauseAtTarget = process.env.SERPENT_REAL_MEMORY_PAUSE_AT_TARGET === '1';

test.skip(!sourceRoot, 'Set SERPENT_REAL_MEMORY_SOURCE_ROOT to a read-only real media directory.');
test.setTimeout(memoryTimeoutMs + 180_000);

type ReadyArtifact = { assetId: string; artifactId: string };
type MediaJobCounts = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  paused: number;
  cancelled: number;
};
type HostCounts = {
  batchEvents: number;
  readyEntries: number;
  uniqueAssets: number;
  uniqueArtifactCompletions: number;
  maxBatchSize: number;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('Real thumbnail memory numeric settings must be positive integers.');
  }
  return parsed;
}

function parseIdleSeconds(value: string | undefined, fallback: number[]): number[] {
  if (!value) return fallback;
  const parsed = value.split(',').map((part) => Number(part.trim()));
  if (
    parsed.length === 0
    || parsed.some((item) => !Number.isSafeInteger(item) || item <= 0)
    || parsed.some((item, index) => index > 0 && item <= parsed[index - 1]!)
  ) {
    throw new Error('Idle sample seconds must be positive and strictly increasing.');
  }
  return parsed;
}

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertSourceAndWorkspaceAreSeparate(source: string): string {
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error('Configured real media source is unavailable.');
  }
  const resolvedSource = realpathSync(source);
  const workspace = realpathSync(process.cwd());
  if (isWithin(resolvedSource, workspace) || isWithin(workspace, resolvedSource)) {
    throw new Error('The read-only source and temporary workspace must be separate trees.');
  }
  return resolvedSource;
}

function removeOwnedTemporaryRoot(root: string): void {
  const workspace = realpathSync(process.cwd());
  const resolvedRoot = path.resolve(root);
  if (
    path.dirname(resolvedRoot) !== workspace
    || !path.basename(resolvedRoot).startsWith('.tmp-thumbnail-memory-')
  ) {
    throw new Error('Refusing to clean a directory outside this test-owned root.');
  }
  const rootInfo = lstatSync(resolvedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Refusing to clean a missing or reparse-point test root.');
  }
  const realRoot = realpathSync(resolvedRoot);
  if (path.dirname(realRoot) !== workspace || path.basename(realRoot) !== path.basename(resolvedRoot)) {
    throw new Error('The test root no longer resolves as a direct workspace child.');
  }

  const assertNoReparsePoints = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const entry = path.join(directory, name);
      const info = lstatSync(entry);
      if (info.isSymbolicLink()) {
        throw new Error('Refusing to clean a tree that contains a reparse point.');
      }
      if (info.isDirectory()) assertNoReparsePoints(entry);
    }
  };
  assertNoReparsePoints(resolvedRoot);

  const removeContents = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const entry = path.join(directory, name);
      const info = lstatSync(entry);
      if (info.isDirectory()) removeContents(entry);
      else unlinkSync(entry);
    }
    rmdirSync(directory);
  };
  removeContents(resolvedRoot);
}

function readHostCounts(input: {
  batchEvents: number;
  readyEntries: number;
  assetIds: Set<string>;
  artifactKeys: Set<string>;
  maxBatchSize: number;
}): HostCounts {
  return {
    batchEvents: input.batchEvents,
    readyEntries: input.readyEntries,
    uniqueAssets: input.assetIds.size,
    uniqueArtifactCompletions: input.artifactKeys.size,
    maxBatchSize: input.maxBatchSize,
  };
}

async function readOpenLibraryId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const opened = await api.listOpen();
    if (!opened.ok || !opened.value[0]) throw new Error('No isolated library is open.');
    return opened.value[0].libraryId;
  });
}

async function flushBatchReadyForwarders(page: Page): Promise<void> {
  const failed = await page.evaluate(async () => {
    const root = globalThis as typeof globalThis & {
      __thumbnailMemoryFlush?: () => Promise<boolean>;
    };
    return await root.__thumbnailMemoryFlush?.() ?? false;
  });
  if (failed) throw new Error('Could not forward thumbnail completion counters to the test host.');
}

async function disposeBatchReadyForwarder(page: Page): Promise<void> {
  const failed = await page.evaluate(async () => {
    const root = globalThis as typeof globalThis & {
      __thumbnailMemoryDispose?: () => Promise<boolean>;
    };
    return await root.__thumbnailMemoryDispose?.() ?? false;
  });
  if (failed) throw new Error('Could not drain the final thumbnail completion counters.');
}

async function readMediaJobSummary(page: Page, libraryId: string): Promise<MediaJobCounts> {
  return page.evaluate(async (activeLibraryId) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const result = await api.getMediaJobSummary({ libraryId: activeLibraryId });
    if (!result.ok) throw new Error('Could not read media job summary.');
    return result.value;
  }, libraryId);
}

async function pauseMediaJobs(page: Page, libraryId: string): Promise<number> {
  return page.evaluate(async (activeLibraryId) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const result = await api.pauseMediaJobs({ libraryId: activeLibraryId });
    if (!result.ok) throw new Error('Could not pause the isolated library media queue.');
    return result.value.pausedCount;
  }, libraryId);
}

test('measures renderer memory after real offscreen thumbnail completions', async () => {
  if (!sourceRoot) return;
  const resolvedSource = assertSourceAndWorkspaceAreSeparate(sourceRoot);
  const workspace = realpathSync(process.cwd());
  const disk = statfsSync(workspace);
  if (disk.bavail * disk.bsize < 10 * 1024 ** 3) {
    throw new Error('At least 10 GiB of free workspace disk space is required.');
  }

  const root = mkdtempSync(path.join(workspace, '.tmp-thumbnail-memory-'));
  let application: ElectronApplication | undefined;
  let page: Page | undefined;
  let probe: Awaited<ReturnType<typeof createThumbnailMemoryProbe>> | undefined;
  let appClosed: boolean;
  let cleanupFailed = false;
  let phase = 'launch';
  let importMs: number | null = null;
  let linkedAssetCount: number | null = null;
  let visibleBefore: Awaited<ReturnType<typeof visibleImageStats>> | null = null;
  let visibleAfter: Awaited<ReturnType<typeof visibleImageStats>> | null = null;
  let finalJobSummary: MediaJobCounts | null = null;
  let pausedCount: number | null = null;
  let elapsedMs = 0;
  let heapSummary: unknown | null = null;
  let runStartedAt = 0;
  const assetIds = new Set<string>();
  const artifactKeys = new Set<string>();
  const memorySamples: Array<{ label: string; completed: number; snapshot: unknown }> = [];
  let batchEvents = 0;
  let readyEntries = 0;
  let maxBatchSize = 0;
  const hostCounts = () => readHostCounts({ batchEvents, readyEntries, assetIds, artifactKeys, maxBatchSize });
  const report = (result: 'complete' | 'failed' | 'incomplete', failurePhase?: string) => ({
    result,
    ...(failurePhase ? { failurePhase } : {}),
    targetUniqueAssets: targetCompletions,
    elapsedMs,
    linkedAssetCount,
    ...hostCounts(),
    importMs,
    memorySamples,
    visibleBefore,
    visibleAfter,
    finalJobSummary,
    pausedCount,
    idleSeconds,
    settleMode: pauseAtTarget ? 'pause-current-jobs' : 'natural-drain',
    heapSummary,
  });

  try {
    phase = 'launch';
    const launched = await launchBenchmarkApp({
      userDataPath: path.join(root, 'profile'),
      extraEnv: {
        SERPENT_E2E_HIDE_WINDOW: '1',
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_LINKED_SOURCE: resolvedSource,
      },
    });
    application = launched.application;
    const window = launched.window;
    page = window;
    await window.setViewportSize({ width: 1360, height: 980 });

    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    await window.getByRole('textbox', { name: '名称', exact: true }).fill('ThumbnailMemoryFixture');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.locator('.workspace-canvas')).toBeVisible({ timeout: 60_000 });
    const activeLibraryId = await readOpenLibraryId(window);
    const memoryProbe = await createThumbnailMemoryProbe(application, window);
    probe = memoryProbe;

    await window.exposeBinding(
      '__thumbnailMemoryReceiveBatch',
      (_source, payload: { items: ReadyArtifact[]; totalItemCount: number }) => {
        batchEvents += 1;
        readyEntries += payload.items.length;
        maxBatchSize = Math.max(maxBatchSize, payload.totalItemCount);
        for (const item of payload.items) {
          if (!item.assetId || !item.artifactId) continue;
          assetIds.add(item.assetId);
          artifactKeys.add(JSON.stringify([item.assetId, item.artifactId]));
        }
      },
    );
    await page.evaluate((expectedLibraryId) => {
      type ForwardingWindow = Window & {
        __thumbnailMemoryReceiveBatch?: (payload: { items: ReadyArtifact[]; totalItemCount: number }) => Promise<void>;
        __thumbnailMemoryFlush?: () => Promise<boolean>;
        __thumbnailMemoryDispose?: () => Promise<boolean>;
      };
      const root = globalThis as typeof globalThis & ForwardingWindow;
      const api = (globalThis as typeof globalThis & {
        serpent: { library: SerpentLibraryApi };
      }).serpent.library;
      let pendingForwarders = 0;
      let forwardingFailed = false;
      const flushWaiters = new Set<() => void>();
      const finishForward = () => {
        pendingForwarders -= 1;
        if (pendingForwarders !== 0) return;
        for (const resolve of flushWaiters) resolve();
        flushWaiters.clear();
      };
      const unsubscribe = api.onThumbnailEvent((event) => {
        if (event.type !== 'asset.thumbnail.batch-ready' || event.libraryId !== expectedLibraryId) return;
        const items = event.ready
          .filter((item) => item.assetId.length > 0 && item.artifactId.length > 0)
          .map(({ assetId, artifactId }) => ({ assetId, artifactId }));
        pendingForwarders += 1;
        const receive = root.__thumbnailMemoryReceiveBatch;
        if (!receive) {
          forwardingFailed = true;
          finishForward();
          return;
        }
        void receive({ items, totalItemCount: event.ready.length + event.failed.length }).catch(() => {
          forwardingFailed = true;
        }).finally(finishForward);
      });
      const flush = async () => {
        if (pendingForwarders > 0) {
          await new Promise<void>((resolve) => flushWaiters.add(resolve));
        }
        return forwardingFailed;
      };
      root.__thumbnailMemoryFlush = flush;
      root.__thumbnailMemoryDispose = async () => {
        unsubscribe();
        return flush();
      };
    }, activeLibraryId);

    const sample = async (label: string) => {
      const completed = assetIds.size;
      const snapshot = await memoryProbe.sample(label, completed);
      memorySamples.push({ label, completed, snapshot });
    };
    await sample('completed-0');

    phase = 'linked-import';
    runStartedAt = Date.now();
    const importStartedAt = Date.now();
    const linked = await window.evaluate(async (currentLibraryId) => {
      const api = (globalThis as typeof globalThis & {
        serpent: { library: SerpentLibraryApi };
      }).serpent.library;
      const result = await api.importFolderAsLinked({
        libraryId: currentLibraryId,
        displayName: 'MemorySource',
      });
      if (!result.ok) throw new Error('Linked source import failed.');
      return result.value.assetCount;
    }, activeLibraryId);
    importMs = Date.now() - importStartedAt;
    linkedAssetCount = linked;
    if (linkedAssetCount < targetCompletions) {
      throw new Error('The linked source contains fewer assets than the requested completion target.');
    }

    phase = 'visible-decode-warmup';
    await window.getByRole('button', { name: '所有资产', exact: true }).click();
    await expect(window.locator('.asset-card[data-media-type="image"]').first())
      .toBeVisible({ timeout: 120_000 });
    await expect.poll(async () => (await visibleImageStats(window)).decodedImages, {
      timeout: 120_000,
      message: 'The visible warmup must decode real image pixels.',
    }).toBeGreaterThan(0);
    await expect.poll(async () => (await visibleImageStats(window)).coverage, {
      timeout: 120_000,
      message: 'At least 90% of visible image cards must decode before measurement.',
    }).toBeGreaterThanOrEqual(0.9);
    visibleBefore = await visibleImageStats(window);
    expect(visibleBefore.decodedImages).toBeGreaterThan(0);
    expect(visibleBefore.coverage).toBeGreaterThanOrEqual(0.9);
    await flushBatchReadyForwarders(window);
    await sample('after-import-warmup');

    const startedAt = runStartedAt;
    const deadline = startedAt + memoryTimeoutMs;
    const milestones = [...new Set([100, 250, 1_000, 2_500, 5_000, targetCompletions])]
      .filter((value) => value <= targetCompletions)
      .sort((left, right) => left - right);
    let nextMilestone = 0;
    const sampleReachedMilestones = async () => {
      while (nextMilestone < milestones.length && assetIds.size >= milestones[nextMilestone]!) {
        const milestone = milestones[nextMilestone]!;
        await sample(`completed-${milestone}`);
        nextMilestone += 1;
      }
    };
    let nextProgressAt = startedAt + 30_000;
    await sampleReachedMilestones();
    phase = 'background-queue';
    while (assetIds.size < targetCompletions) {
      if (Date.now() >= deadline) {
        throw new Error('Timed out before reaching the requested unique thumbnail assets.');
      }
      await window.waitForTimeout(1_000);
      await flushBatchReadyForwarders(window);
      await sampleReachedMilestones();
      expect(maxBatchSize, 'Thumbnail batch events must stay within the event payload limit.').toBeLessThanOrEqual(100);
      if (Date.now() >= nextProgressAt) {
        finalJobSummary = await readMediaJobSummary(window, activeLibraryId);
        elapsedMs = Date.now() - startedAt;
        console.log('real thumbnail memory progress', JSON.stringify({
          elapsedMs,
          ...hostCounts(),
          jobs: finalJobSummary,
        }));
        nextProgressAt += 30_000;
      }
    }
    await flushBatchReadyForwarders(window);
    await sampleReachedMilestones();
    expect(assetIds.size).toBeGreaterThanOrEqual(targetCompletions);
    expect(maxBatchSize, 'All thumbnail batches must respect the payload limit.').toBeLessThanOrEqual(100);
    elapsedMs = Date.now() - startedAt;

    phase = pauseAtTarget ? 'pause-and-tail' : 'natural-queue-drain';
    if (pauseAtTarget) pausedCount = await pauseMediaJobs(window, activeLibraryId);
    const tailDeadline = pauseAtTarget ? Date.now() + Math.min(120_000, memoryTimeoutMs) : deadline;
    let quietSince: number | null = null;
    do {
      finalJobSummary = await readMediaJobSummary(window, activeLibraryId);
      if (pauseAtTarget && finalJobSummary.queued !== 0) {
        throw new Error('The all-jobs pause admitted new queued media work.');
      }
      if (pauseAtTarget && finalJobSummary.running === 0) break;
      if (finalJobSummary.running === 0 && finalJobSummary.queued === 0) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince >= 10_000) break;
      } else quietSince = null;
      if (Date.now() >= tailDeadline) throw new Error('Timed out waiting for the isolated media queue to become idle.');
      await window.waitForTimeout(1_000);
      await flushBatchReadyForwarders(window);
      if (Date.now() >= nextProgressAt) {
        elapsedMs = Date.now() - startedAt;
        console.log('real thumbnail memory drain progress', JSON.stringify({
          elapsedMs, ...hostCounts(), jobs: finalJobSummary,
        }));
        nextProgressAt += 30_000;
      }
    } while (Date.now() < tailDeadline);
    if (!pauseAtTarget && (quietSince === null || Date.now() - quietSince < 10_000)) {
      throw new Error('The natural queue drain did not reach a quiet observation window.');
    }
    await flushBatchReadyForwarders(window);
    // Natural drain has a ten-second quiet tail. In pause mode also give an
    // already committed fanout batch time to arrive before the idle baseline.
    if (pauseAtTarget) {
      await window.waitForTimeout(300);
      await flushBatchReadyForwarders(window);
    }
    const idleCompleted = assetIds.size;
    visibleAfter = await visibleImageStats(window);
    expect(visibleAfter.decodedImages, 'Visible image cards must still contain decoded pixels after the queue target.')
      .toBeGreaterThan(0);
    expect(visibleAfter.coverage, 'At least 90% of visible image cards must remain decoded after the queue target.')
      .toBeGreaterThanOrEqual(0.9);

    phase = 'idle-samples';
    const idleStartedAt = Date.now();
    for (const seconds of idleSeconds) {
      const targetAt = idleStartedAt + seconds * 1_000;
      while (Date.now() < targetAt) {
        await window.waitForTimeout(Math.min(1_000, targetAt - Date.now()));
        await flushBatchReadyForwarders(window);
      }
      finalJobSummary = await readMediaJobSummary(window, activeLibraryId);
      if (finalJobSummary.running !== 0 || finalJobSummary.queued !== 0 || assetIds.size !== idleCompleted) {
        throw new Error('The isolated library resumed thumbnail work during the idle observation.');
      }
      await sample(`idle-${seconds}s`);
    }

    if (collectFinalGarbage) {
      await memoryProbe.collectGarbage();
      await sample('post-forced-gc');
    }
    if (captureFinalHeap) {
      heapSummary = await memoryProbe.captureHeapSummary(path.join(root, 'renderer-heap.heapsnapshot'));
      await sample('post-snapshot');
    }
    elapsedMs = Date.now() - startedAt;
    expect(maxBatchSize).toBeLessThanOrEqual(100);
    console.log('real thumbnail memory result', JSON.stringify(report('complete')));
  } catch (error) {
    if (runStartedAt > 0) elapsedMs = Date.now() - runStartedAt;
    console.log('real thumbnail memory incomplete', JSON.stringify(report('failed', phase)));
    throw error;
  } finally {
    if (page) {
      try {
        await disposeBatchReadyForwarder(page);
      } catch {
        // The renderer may already have exited after a failed run.
      }
    }
    try {
      await probe?.dispose();
    } catch {
      // Still close the app and clean its owned temporary root below.
    }
    try {
      await application?.close();
      appClosed = true;
    } catch {
      appClosed = application === undefined;
    }
    if (appClosed) {
      try {
        removeOwnedTemporaryRoot(root);
        console.log('real thumbnail memory cleanup', JSON.stringify({ removed: true }));
      } catch {
        cleanupFailed = true;
        console.log('real thumbnail memory cleanup', JSON.stringify({ removed: false, reason: 'ownership-or-reparse-check-failed' }));
      }
    } else {
      cleanupFailed = true;
      console.log('real thumbnail memory cleanup', JSON.stringify({ removed: false, reason: 'application-close-unconfirmed' }));
    }
  }
  if (cleanupFailed) throw new Error('The test-owned temporary root could not be safely cleaned.');
});
