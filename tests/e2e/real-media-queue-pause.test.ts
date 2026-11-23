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
import { execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { SerpentLibraryApi } from '../../src/shared/library-api';
import {
  launchBenchmarkApp,
  visibleImageStats,
  type VisibleImageStats,
} from './perf-bench-helpers';

const sourceRoot = process.env.SERPENT_REAL_PAUSE_SOURCE_ROOT;
const targetBatchReadyArtifacts = 100;
const storedImageCandidateLimit = 20;
const quietObservationMs = 8_000;
const testTimeoutMs = 8 * 60_000;

test.skip(!sourceRoot, 'Set SERPENT_REAL_PAUSE_SOURCE_ROOT to a read-only real media directory.');
test.setTimeout(testTimeoutMs);

type ReadyArtifact = { assetId: string; artifactId: string };
type ReadyEventPayload = {
  source: 'batch' | 'single';
  items: ReadyArtifact[];
  verifiedImages: ReadyArtifact[];
  batchItemCount: number;
};
type QueueSnapshot = {
  queuePaused?: boolean;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  paused: number;
  activeJobs: Array<{ assetId: string; status: string }>;
};
type AssetPreviewState = {
  assetId: string;
  mediaType: string;
  thumbnailStatus: string | null;
  thumbnailArtifactId: string | null;
} | null;

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
    || !path.basename(resolvedRoot).startsWith('.tmp-media-queue-pause-')
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

function processHasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function closeOwnedApplication(application: ElectronApplication, child: ChildProcess): Promise<boolean> {
  let exitPromise: Promise<unknown> = Promise.resolve();
  if (!processHasExited(child)) exitPromise = once(child, 'exit');
  let forced = false;

  await application.evaluate(({ app }) => app.quit()).catch(() => undefined);
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  const exitedGracefully = await Promise.race([
    exitPromise.then(() => true),
    new Promise<boolean>((resolve) => { exitTimer = setTimeout(() => resolve(false), 15_000); }),
  ]);
  if (exitTimer !== undefined) clearTimeout(exitTimer);

  if (!exitedGracefully && !processHasExited(child)) {
    forced = true;
    try {
      if (process.platform === 'win32' && child.pid !== undefined) {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      // The owned process may exit between the check and the termination request.
    }
    if (!processHasExited(child)) {
      let forcedExitTimer: ReturnType<typeof setTimeout> | undefined;
      const exitedAfterTermination = await Promise.race([
        once(child, 'exit').then(() => true),
        new Promise<boolean>((resolve) => { forcedExitTimer = setTimeout(() => resolve(false), 10_000); }),
      ]);
      if (forcedExitTimer !== undefined) clearTimeout(forcedExitTimer);
      if (!exitedAfterTermination) throw new Error('The test-launched application did not exit.');
    }
  }

  await application.close().catch(() => undefined);
  if (!processHasExited(child)) throw new Error('The test-launched application process is still alive.');
  return !forced && child.exitCode === 0;
}

async function readOpenLibraryId(window: Page): Promise<string> {
  return window.evaluate(async () => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const opened = await api.listOpen();
    if (!opened.ok || !opened.value[0]) throw new Error('No isolated library is open.');
    return opened.value[0].libraryId;
  });
}

async function readQueueSnapshot(window: Page, libraryId: string): Promise<QueueSnapshot> {
  return window.evaluate(async (activeLibraryId) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const [summary, page] = await Promise.all([
      api.getMediaJobSummary({ libraryId: activeLibraryId }),
      api.listMediaJobs({ libraryId: activeLibraryId, limit: 100 }),
    ]);
    if (!summary.ok || !page.ok) throw new Error('Could not inspect the media queue.');
    return {
      ...summary.value,
      activeJobs: page.value.jobs
        .filter((job) => job.status === 'queued' || job.status === 'running')
        .map((job) => ({ assetId: job.assetId, status: job.status })),
    };
  }, libraryId);
}

async function readAssetPreviewState(
  window: Page,
  libraryId: string,
  assetId: string,
): Promise<AssetPreviewState> {
  return window.evaluate(async ({ activeLibraryId, targetAssetId }) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const result = await api.listAssets({
      libraryId: activeLibraryId,
      recursive: true,
      assetIds: [targetAssetId],
    });
    if (!result.ok) throw new Error('Could not inspect the selected asset.');
    const asset = result.value.find((candidate) => candidate.assetId === targetAssetId);
    return asset ? {
      assetId: asset.assetId,
      mediaType: asset.mediaType,
      thumbnailStatus: asset.thumbnailStatus,
      thumbnailArtifactId: asset.thumbnailArtifactId,
    } : null;
  }, { activeLibraryId: libraryId, targetAssetId: assetId });
}

type ReadyTracker = { flush(): Promise<void>; dispose(): Promise<void> };

async function installReadyTracker(
  window: Page,
  libraryId: string,
  onReady: (payload: ReadyEventPayload) => void,
): Promise<ReadyTracker> {
  await window.exposeBinding(
    '__realMediaPauseReceiveReady',
    (_source, payload: ReadyEventPayload) => onReady(payload),
  );
  const installed = await window.evaluate(async (activeLibraryId) => {
    type ReadyItem = { assetId: string; artifactId: string };
    type ReceivePayload = {
      source: 'batch' | 'single';
      items: ReadyItem[];
      verifiedImages: ReadyItem[];
      batchItemCount: number;
    };
    const root = globalThis as typeof globalThis & {
      __realMediaPauseReceiveReady?: (payload: ReceivePayload) => Promise<void>;
      __realMediaPauseFlush?: () => Promise<boolean>;
      __realMediaPauseDispose?: () => Promise<boolean>;
    };
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    let pending = 0;
    let forwardingFailed = false;
    const flushWaiters = new Set<() => void>();
    const finishForward = (): void => {
      pending -= 1;
      if (pending !== 0) return;
      for (const resolve of flushWaiters) resolve();
      flushWaiters.clear();
    };
    const unsubscribe = api.onThumbnailEvent((event) => {
      if (event.libraryId !== activeLibraryId) return;
      let source: 'batch' | 'single';
      let items: ReadyItem[];
      let batchItemCount: number;
      if (event.type === 'asset.thumbnail.batch-ready') {
        source = 'batch';
        items = event.ready.map(({ assetId, artifactId }) => ({ assetId, artifactId }));
        batchItemCount = event.completedCount;
      } else if (event.type === 'asset.thumbnail.ready') {
        source = 'single';
        items = [{ assetId: event.assetId, artifactId: event.artifactId }];
        batchItemCount = 0;
      } else {
        return;
      }
      if (items.length === 0) return;
      pending += 1;
      void api.listAssets({
        libraryId: activeLibraryId,
        recursive: true,
        assetIds: items.map((item) => item.assetId),
      }).then(async (result) => {
        if (!result.ok) throw new Error('Could not verify completed image assets.');
        const byId = new Map(result.value.map((asset) => [asset.assetId, asset]));
        const verifiedImages = items.filter((item) => {
          const asset = byId.get(item.assetId);
          return asset?.mediaType === 'image'
            && asset.thumbnailStatus === 'ready'
            && asset.thumbnailArtifactId === item.artifactId;
        });
        const receive = root.__realMediaPauseReceiveReady;
        if (!receive) throw new Error('The host event receiver is unavailable.');
        await receive({
          source,
          items,
          verifiedImages,
          batchItemCount,
        });
      }).catch(() => {
        forwardingFailed = true;
      }).finally(finishForward);
    });
    const flush = async (): Promise<boolean> => {
      if (pending > 0) await new Promise<void>((resolve) => flushWaiters.add(resolve));
      return forwardingFailed;
    };
    root.__realMediaPauseFlush = flush;
    root.__realMediaPauseDispose = async () => {
      unsubscribe();
      return flush();
    };
    return true;
  }, libraryId);
  if (!installed) throw new Error('Could not subscribe to thumbnail completion events.');

  const flush = async (): Promise<void> => {
    const failed = await window.evaluate(async () => {
      const root = globalThis as typeof globalThis & {
        __realMediaPauseFlush?: () => Promise<boolean>;
      };
      return await root.__realMediaPauseFlush?.() ?? false;
    });
    if (failed) throw new Error('Could not process thumbnail completion events.');
  };
  const dispose = async (): Promise<void> => {
    const failed = await window.evaluate(async () => {
      const root = globalThis as typeof globalThis & {
        __realMediaPauseDispose?: () => Promise<boolean>;
      };
      return await root.__realMediaPauseDispose?.() ?? false;
    });
    if (failed) throw new Error('Could not drain thumbnail completion events.');
  };
  return { flush, dispose };
}

async function waitForVisibleDecoded(window: Page, timeoutMs: number): Promise<VisibleImageStats> {
  const deadline = Date.now() + timeoutMs;
  let stats = await visibleImageStats(window);
  while (Date.now() < deadline) {
    if (stats.imageCards > 0 && stats.decodedImages > 0) return stats;
    await window.waitForTimeout(250);
    stats = await visibleImageStats(window);
  }
  throw new Error('No visible image was decoded to non-zero pixels.');
}

async function pauseAll(window: Page, libraryId: string): Promise<number> {
  return window.evaluate(async (activeLibraryId) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const result = await api.pauseMediaJobs({ libraryId: activeLibraryId });
    if (!result.ok) throw new Error('Could not pause automatic media work.');
    return result.value.pausedCount;
  }, libraryId);
}

async function waitForQueueIdle(
  window: Page,
  libraryId: string,
  timeoutMs: number,
): Promise<QueueSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await readQueueSnapshot(window, libraryId);
    if (snapshot.queued === 0 && snapshot.running === 0) return snapshot;
    await window.waitForTimeout(250);
  }
  throw new Error('The paused media queue did not settle.');
}

async function observePausedQueue(input: {
  window: Page;
  libraryId: string;
  tracker: ReadyTracker;
  readyCount: () => number;
  expectedSucceeded?: number;
  durationMs: number;
}): Promise<QueueSnapshot> {
  await waitForQueueIdle(input.window, input.libraryId, 30_000);
  await input.tracker.flush();
  let quietReadyCount = input.readyCount();
  let quietStartedAt = Date.now();
  while (Date.now() - quietStartedAt < 1_000) {
    await input.window.waitForTimeout(250);
    await input.tracker.flush();
    const snapshot = await readQueueSnapshot(input.window, input.libraryId);
    assertPausedAndIdle(snapshot);
    if (input.expectedSucceeded !== undefined && snapshot.succeeded !== input.expectedSucceeded) {
      throw new Error('A media job completed after the queue paused.');
    }
    if (input.readyCount() !== quietReadyCount) {
      quietReadyCount = input.readyCount();
      quietStartedAt = Date.now();
    }
  }

  const baselineReadyCount = input.readyCount();
  const baseline = await readQueueSnapshot(input.window, input.libraryId);
  assertPausedAndIdle(baseline);
  const startedAt = Date.now();
  let snapshot = baseline;
  while (Date.now() - startedAt < input.durationMs) {
    await input.window.waitForTimeout(Math.min(1_000, input.durationMs - (Date.now() - startedAt)));
    await input.tracker.flush();
    snapshot = await readQueueSnapshot(input.window, input.libraryId);
    assertPausedAndIdle(snapshot);
    if (input.expectedSucceeded !== undefined && snapshot.succeeded !== input.expectedSucceeded) {
      throw new Error('A media job completed during the paused observation.');
    }
    if (input.readyCount() !== baselineReadyCount) {
      throw new Error('A new thumbnail artifact arrived during the paused observation.');
    }
  }
  return snapshot;
}

function assertPausedAndIdle(snapshot: QueueSnapshot): void {
  if (snapshot.queuePaused !== true) throw new Error('The library pause mode was not retained.');
  if (snapshot.queued !== 0 || snapshot.running !== 0 || snapshot.activeJobs.length !== 0) {
    throw new Error('Automatic work remained active while the library was paused.');
  }
}

async function readRetryArtifactResult(
  window: Page,
  libraryId: string,
  assetId: string,
): Promise<boolean> {
  return window.evaluate(async ({ activeLibraryId, targetAssetId }) => {
    const api = (globalThis as typeof globalThis & {
      serpent: { library: SerpentLibraryApi };
    }).serpent.library;
    const result = await api.retryArtifact({
      libraryId: activeLibraryId,
      assetId: targetAssetId,
      kind: 'thumbnail',
    });
    return result.ok;
  }, { activeLibraryId: libraryId, targetAssetId: assetId });
}

async function decodePreviewProtocolUrl(
  window: Page,
  libraryId: string,
  artifactId: string,
): Promise<{ complete: boolean; width: number; height: number; protocol: string }> {
  return window.evaluate(async ({ activeLibraryId, targetArtifactId }) => {
    const image = new Image();
    image.src = `serpent://preview/${encodeURIComponent(activeLibraryId)}/${encodeURIComponent(targetArtifactId)}`;
    try {
      await image.decode();
    } catch {
      return {
        complete: image.complete,
        width: image.naturalWidth,
        height: image.naturalHeight,
        protocol: new URL(image.src).protocol,
      };
    }
    return {
      complete: image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
      protocol: new URL(image.src).protocol,
    };
  }, { activeLibraryId: libraryId, targetArtifactId: artifactId });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

test('pauses real linked media work across restart while preserving exact thumbnail retry', async () => {
  if (!sourceRoot) return;
  const resolvedSource = assertSourceAndWorkspaceAreSeparate(sourceRoot);
  const workspace = realpathSync(process.cwd());
  const disk = statfsSync(workspace);
  if (disk.bavail * disk.bsize < 10 * 1024 ** 3) {
    throw new Error('At least 10 GiB of free workspace disk space is required.');
  }

  const root = mkdtempSync(path.join(workspace, '.tmp-media-queue-pause-'));
  const userDataPath = path.join(root, 'profile');
  const libraryName = 'MediaQueuePauseFixture';
  const libraryPath = path.join(root, libraryName);
  const applications = new Map<ElectronApplication, ChildProcess>();
  let activeApplication: ElectronApplication | undefined;
  let activeWindow: Page | undefined;
  let tracker: ReadyTracker | undefined;
  let phase = 'launch';
  const startedAt = Date.now();
  const readyArtifactKeys = new Set<string>();
  const batchReadyArtifactKeys = new Set<string>();
  const batchReadyItems = new Map<string, ReadyArtifact>();
  const imageCandidates = new Map<string, ReadyArtifact>();
  let batchEvents = 0;
  let singleReadyEvents = 0;
  let maxBatchItemCount = 0;
  let linkedAssetCount = 0;
  let firstVisible: VisibleImageStats | null = null;
  let pausedVisible: VisibleImageStats | null = null;
  let restartedVisible: VisibleImageStats | null = null;
  let completedAtPause = 0;
  let succeededAtPause: number;
  let pausedCount = 0;
  let resumedCount = 0;
  let explicitRetryArtifactId: string | null = null;
  let selectedAssetId: string | null = null;
  let previousArtifactId: string | null = null;
  let newReadyForSelectedAsset: string | null = null;
  let cleanupFailed = false;
  let explicitRetryDecoded = false;
  let pauseAckMs: number | null = null;

  const report = () => ({
    phase,
    elapsedMs: Date.now() - startedAt,
    targetBatchReadyArtifacts: targetBatchReadyArtifacts,
    batchReadyArtifacts: batchReadyArtifactKeys.size,
    batchEvents,
    singleReadyEvents,
    maxBatchItemCount,
    imageCandidates: imageCandidates.size,
    linkedAssetCount,
    pausedCount,
    resumedCount,
    completedAtPause,
    visibleDecodedBefore: firstVisible?.decodedImages ?? 0,
    visibleDecodedPaused: pausedVisible?.decodedImages ?? 0,
    visibleDecodedRestarted: restartedVisible?.decodedImages ?? 0,
    explicitRetryDecoded,
    pauseAckMs,
  });

  const onReadyEvent = (payload: ReadyEventPayload): void => {
    if (payload.source === 'batch') batchEvents += 1;
    else singleReadyEvents += 1;
    maxBatchItemCount = Math.max(maxBatchItemCount, payload.batchItemCount);
    for (const item of payload.items) {
      const key = JSON.stringify([item.assetId, item.artifactId]);
      readyArtifactKeys.add(key);
      if (payload.source === 'batch') {
        batchReadyArtifactKeys.add(key);
        batchReadyItems.set(key, item);
      }
      if (
        selectedAssetId === item.assetId
        && previousArtifactId !== null
        && item.artifactId !== previousArtifactId
      ) {
        newReadyForSelectedAsset = item.artifactId;
      }
    }
    for (const item of payload.verifiedImages) {
      if (imageCandidates.size >= storedImageCandidateLimit) break;
      if (!imageCandidates.has(item.assetId)) imageCandidates.set(item.assetId, item);
    }
  };

  try {
    phase = 'launch-and-create-isolated-library';
    const launched = await launchBenchmarkApp({
      userDataPath,
      extraEnv: {
        SERPENT_E2E_HIDE_WINDOW: '1',
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_LINKED_SOURCE: resolvedSource,
      },
    });
    activeApplication = launched.application;
    activeWindow = launched.window;
    applications.set(activeApplication, activeApplication.process());
    await activeWindow.setViewportSize({ width: 1360, height: 980 });
    const anyWindowVisible = await activeApplication.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((window) => window.isVisible()),
    );
    assert(!anyWindowVisible, 'The real media pause run must keep its application window hidden.');

    await activeWindow.getByRole('button', { name: '创建资源库', exact: true }).click();
    await activeWindow.getByRole('textbox', { name: '名称', exact: true }).fill(libraryName);
    await activeWindow.getByRole('button', { name: '创建', exact: true }).click();
    // The empty shell already has a canvas. Wait for the asynchronous create
    // command to materialize its own library before inspecting that canvas.
    await expect.poll(() => existsSync(libraryPath), { timeout: 60_000 }).toBe(true);
    await activeWindow.locator('.workspace-canvas').waitFor({ state: 'visible', timeout: 60_000 });
    assert(existsSync(libraryPath), 'The isolated library was not created at its owned path.');
    const libraryId = await readOpenLibraryId(activeWindow);

    phase = 'linked-real-source';
    const importResult = await activeWindow.evaluate(async (activeLibraryId) => {
      const api = (globalThis as typeof globalThis & {
        serpent: { library: SerpentLibraryApi };
      }).serpent.library;
      const result = await api.importFolderAsLinked({
        libraryId: activeLibraryId,
        displayName: 'ReadOnlySource',
      });
      if (!result.ok) throw new Error('Linked source ingestion failed.');
      return result.value.assetCount;
    }, libraryId);
    linkedAssetCount = importResult;
    assert(linkedAssetCount > targetBatchReadyArtifacts, 'The source is too small for the real pause sample.');
    await activeWindow.getByRole('button', { name: '所有资产', exact: true }).click();
    firstVisible = await waitForVisibleDecoded(activeWindow, 90_000);

    tracker = await installReadyTracker(activeWindow, libraryId, onReadyEvent);
    phase = 'wait-for-real-batch-completions';
    const completionDeadline = Date.now() + 240_000;
    let lastProgressAt = Date.now();
    while (
      batchReadyArtifactKeys.size < targetBatchReadyArtifacts
      || imageCandidates.size === 0
    ) {
      await activeWindow.waitForTimeout(250);
      await tracker.flush();
      if (Date.now() >= completionDeadline) {
        throw new Error('The real source did not produce enough batch-ready artifacts and image candidates.');
      }
      if (Date.now() - lastProgressAt >= 15_000) {
        console.log('real media queue pause probe', JSON.stringify(report()));
        lastProgressAt = Date.now();
      }
    }
    assert(maxBatchItemCount <= 100, 'A thumbnail batch exceeded the event payload bound.');

    phase = 'pause-and-settle';
    const pauseStartedAt = Date.now();
    pausedCount = await pauseAll(activeWindow, libraryId);
    pauseAckMs = Date.now() - pauseStartedAt;
    let queue = await readQueueSnapshot(activeWindow, libraryId);
    assert(queue.queuePaused === true, 'The library pause mode was not enabled.');
    assert(pausedCount > 0 || queue.paused > 0, 'No automatic work remained to test after the completion target.');
    queue = await waitForQueueIdle(activeWindow, libraryId, 60_000);
    await tracker.flush();
    completedAtPause = batchReadyArtifactKeys.size;
    pausedVisible = await waitForVisibleDecoded(activeWindow, 30_000);
    assert(pausedVisible.decodedImages > 0, 'Visible image pixels were not retained after pause.');

    phase = 'eight-second-paused-observation';
    queue = await observePausedQueue({
      window: activeWindow,
      libraryId,
      tracker,
      readyCount: () => batchReadyArtifactKeys.size,
      expectedSucceeded: queue.succeeded,
      durationMs: quietObservationMs,
    });
    succeededAtPause = queue.succeeded;
    console.log('real media queue pause probe', JSON.stringify({
      ...report(),
      phase,
      queuePaused: queue.queuePaused,
      queued: queue.queued,
      running: queue.running,
      paused: queue.paused,
    }));

    const selected = [...imageCandidates.values()][0];
    assert(selected !== undefined, 'No completed image candidate was recorded.');
    selectedAssetId = selected.assetId;
    previousArtifactId = selected.artifactId;
    const selectedDetails = await readAssetPreviewState(activeWindow, libraryId, selectedAssetId);
    assert(
      selectedDetails?.mediaType === 'image'
        && selectedDetails.thumbnailStatus === 'ready'
        && selectedDetails.thumbnailArtifactId === previousArtifactId,
      'The chosen retry candidate is not a ready generated image artifact.',
    );

    phase = 'full-application-restart';
    await tracker.dispose();
    tracker = undefined;
    assert(await closeOwnedApplication(activeApplication, applications.get(activeApplication)!),
      'The restart requires a complete graceful application exit.');
    activeApplication = undefined;
    activeWindow = undefined;

    const relaunched = await launchBenchmarkApp({
      userDataPath,
      openLibraryPath: libraryPath,
      extraEnv: { SERPENT_E2E_HIDE_WINDOW: '1' },
    });
    activeApplication = relaunched.application;
    activeWindow = relaunched.window;
    applications.set(activeApplication, activeApplication.process());
    await activeWindow.setViewportSize({ width: 1360, height: 980 });
    await activeWindow.locator('.workspace-canvas').waitFor({ state: 'visible', timeout: 60_000 });
    const reopenedLibraryId = await readOpenLibraryId(activeWindow);
    assert(reopenedLibraryId === libraryId, 'The isolated library identity changed after process restart.');
    await activeWindow.getByRole('button', { name: '所有资产', exact: true }).click();
    restartedVisible = await waitForVisibleDecoded(activeWindow, 90_000);
    assert(restartedVisible.decodedImages > 0, 'Visible image pixels were not decoded after restart.');

    const restartedQueue = await readQueueSnapshot(activeWindow, libraryId);
    assertPausedAndIdle(restartedQueue);
    assert(restartedQueue.succeeded === succeededAtPause, 'A media job completed during process restart.');
    const succeededBeforeRestartObservation = restartedQueue.succeeded;
    const restartedReadyBaseline = readyArtifactKeys.size;
    tracker = await installReadyTracker(activeWindow, libraryId, onReadyEvent);
    phase = 'eight-second-restart-observation';
    queue = await observePausedQueue({
      window: activeWindow,
      libraryId,
      tracker,
      readyCount: () => readyArtifactKeys.size,
      expectedSucceeded: succeededBeforeRestartObservation,
      durationMs: quietObservationMs,
    });
    assert(readyArtifactKeys.size === restartedReadyBaseline, 'A new artifact arrived after paused restart.');

    phase = 'explicit-thumbnail-retry';
    const retryAccepted = await readRetryArtifactResult(activeWindow, libraryId, selectedAssetId);
    assert(retryAccepted, 'The explicit thumbnail retry was rejected.');
    const retryDeadline = Date.now() + 60_000;
    while (Date.now() < retryDeadline && explicitRetryArtifactId === null) {
      await tracker.flush();
      queue = await readQueueSnapshot(activeWindow, libraryId);
      if (queue.queuePaused !== true) throw new Error('The explicit retry cleared the library pause mode.');
      if (queue.queued + queue.running > 1) {
        throw new Error('More than the selected asset became active during explicit retry.');
      }
      if (queue.activeJobs.some((job) => job.assetId !== selectedAssetId)) {
        throw new Error('Another asset became active during explicit retry.');
      }
      const state = await readAssetPreviewState(activeWindow, libraryId, selectedAssetId);
      if (
        state?.mediaType === 'image'
        && state.thumbnailStatus === 'ready'
        && state.thumbnailArtifactId !== previousArtifactId
      ) {
        explicitRetryArtifactId = state.thumbnailArtifactId;
      }
      if (explicitRetryArtifactId === null) await activeWindow.waitForTimeout(250);
    }
    await tracker.flush();
    assert(explicitRetryArtifactId !== null, 'The exact thumbnail retry did not produce a new ready artifact.');
    assert(newReadyForSelectedAsset === explicitRetryArtifactId, 'The retry artifact was not observed through the ready event.');
    const retryDecode = await decodePreviewProtocolUrl(activeWindow, libraryId, explicitRetryArtifactId);
    assert(
      retryDecode.complete
        && retryDecode.width > 0
        && retryDecode.height > 0
        && retryDecode.protocol === 'serpent:',
      'The retried preview protocol URL did not decode image pixels.',
    );
    explicitRetryDecoded = true;
    // A small image may finish between two reads. The new ready artifact and
    // pixel decode prove execution; observing a transient running row is optional.
    queue = await readQueueSnapshot(activeWindow, libraryId);
    assert(queue.queuePaused === true, 'The library pause mode was lost after explicit thumbnail completion.');
    if (queue.activeJobs.some((job) => job.assetId !== selectedAssetId)) {
      throw new Error('Another asset became active after the explicit retry.');
    }

    phase = 'resume-automatic-work';
    const automaticReadyBaseline = batchReadyArtifactKeys.size;
    const automaticArtifactBaseline = new Set(batchReadyArtifactKeys);
    resumedCount = await activeWindow.evaluate(async (activeLibraryId) => {
      const api = (globalThis as typeof globalThis & {
        serpent: { library: SerpentLibraryApi };
      }).serpent.library;
      const result = await api.resumeMediaJobs({ libraryId: activeLibraryId });
      if (!result.ok) throw new Error('Could not resume automatic media work.');
      return result.value.resumedCount;
    }, libraryId);
    assert(resumedCount > 0, 'Resuming the library did not release paused automatic jobs.');
    queue = await readQueueSnapshot(activeWindow, libraryId);
    assert(queue.queuePaused === false, 'The library pause mode remained enabled after resume.');

    const automaticDeadline = Date.now() + 60_000;
    let automaticReadyAssetSeen = false;
    while (Date.now() < automaticDeadline && !automaticReadyAssetSeen) {
      await activeWindow.waitForTimeout(250);
      await tracker.flush();
      queue = await readQueueSnapshot(activeWindow, libraryId);
      if (queue.queuePaused !== false) throw new Error('The resumed library unexpectedly became paused.');
      automaticReadyAssetSeen = [...batchReadyArtifactKeys].some((key) =>
        !automaticArtifactBaseline.has(key)
        && batchReadyItems.get(key)?.assetId !== selectedAssetId,
      );
    }
    assert(batchReadyArtifactKeys.size > automaticReadyBaseline, 'Resumed automatic work produced no new batch artifact.');
    assert(automaticReadyAssetSeen, 'Only the explicit asset completed after automatic resume.');

    phase = 'final-pause-and-cleanup';
    await pauseAll(activeWindow, libraryId);
    queue = await waitForQueueIdle(activeWindow, libraryId, 60_000);
    assert(queue.queuePaused === true, 'The final queue pause did not persist.');
    await tracker.flush();
    console.log('real media queue pause result', JSON.stringify({
      ...report(),
      phase: 'complete',
      queuePaused: queue.queuePaused,
      queued: queue.queued,
      running: queue.running,
      paused: queue.paused,
    }));
  } catch (error) {
    console.log('real media queue pause result', JSON.stringify({
      ...report(), result: 'failed', failure: error instanceof Error ? error.message : 'Unknown probe failure',
    }));
    throw new Error(`Real media queue pause probe failed during ${phase}.`, { cause: error });
  } finally {
    if (tracker && activeWindow && !activeWindow.isClosed()) {
      try {
        await tracker.dispose();
      } catch {
        cleanupFailed = true;
      }
    }
    for (const [application, child] of [...applications].reverse()) {
      if (processHasExited(child)) continue;
      try {
        if (!await closeOwnedApplication(application, child)) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
    }
    let removed = false;
    if ([...applications.values()].every(processHasExited)) {
      try {
        removeOwnedTemporaryRoot(root);
        removed = true;
      } catch {
        cleanupFailed = true;
      }
    } else cleanupFailed = true;
    console.log('real media queue pause cleanup', JSON.stringify({ removed, graceful: !cleanupFailed }));
  }
  if (cleanupFailed) throw new Error('The test-owned temporary root could not be safely cleaned.');
});
