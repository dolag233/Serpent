import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statSync,
  statfsSync,
  unlinkSync,
} from 'node:fs';
import { execFileSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { test, type ElectronApplication, type Page } from '@playwright/test';
import type { SerpentLibraryApi } from '../../src/shared/library-api';
import { launchBenchmarkApp } from './perf-bench-helpers';
import { resolveSessionLogPath } from './electron-test-helpers';

const sourceRoot = process.env.SERPENT_REAL_ONLINE_DERIVATIVES_SOURCE_ROOT;
const targetUniqueThumbnailArtifacts = 100;
const observationWindowMs = 30_000;
const mediaJobPageSize = 500;
const mediaJobPageLimit = 4;
const maxRememberedTaskRows = 4_000;
const maxUniqueThumbnailArtifacts = 300;
const maxPaletteReadyEvents = 1_000;
const maxSnapshots = 48;
const maxRevisionLookupAssets = 1_000;
const maxQueueLogBytes = 16 * 1024 * 1024;
const maxQueueLogRecords = 20_000;

test.skip(!sourceRoot, 'Set SERPENT_REAL_ONLINE_DERIVATIVES_SOURCE_ROOT to a read-only real media directory.');
test.setTimeout(12 * 60_000);

type ThumbnailEventItem = {
  assetId: string;
  artifactId: string;
  revisionId: string | null;
  mediaType: string | null;
  imageReady: boolean;
};

type EventObservation =
  | {
    kind: 'thumbnail';
    observedAtMs: number;
    itemCount: number;
    items: ThumbnailEventItem[];
    verificationFailed: boolean;
  }
  | {
    kind: 'palette-ready';
    observedAtMs: number;
    assetId: string;
  };

type EventTracker = {
  flush(): Promise<void>;
  dispose(): Promise<{
    droppedThumbnailBatches: number;
    droppedPaletteReadyEvents: number;
    forwardingFailed: boolean;
  }>;
};

type MediaJobLite = {
  jobId: string;
  assetId: string;
  revisionId: string | null;
  kind: string;
  status: string;
};

type QueueSnapshot = {
  sampledAtMs: number;
  queuePaused: boolean | null;
  queued: number;
  running: number;
  primaryQueuedObserved: number;
  primaryRunningObserved: number;
  paletteQueuedObserved: number;
  paletteRunningObserved: number;
  pagesRead: number;
  scanComplete: boolean;
  jobs: MediaJobLite[];
};

type QueueLogRecord = {
  line: number;
  timestampMs: number;
  libraryId: string;
  stage: string;
  jobId: string;
  assetId: string;
  kind: string;
  elapsedMs?: number;
};

type JobMeta = MediaJobLite & { revisionId: string };

type ProbeState = {
  windowStartMs: number | null;
  windowEndMs: number | null;
  initialQueuePaused: boolean | null;
  stopReason: 'thumbnail-target' | 'time-window' | 'unexpected-pause' | null;
  thumbnailArtifacts: Map<string, ThumbnailEventItem & { observedAtMs: number }>;
  paletteReadyEvents: Array<{ assetId: string; observedAtMs: number }>;
  snapshots: QueueSnapshot[];
  taskRows: Map<string, MediaJobLite>;
  thumbnailReadyEvents: number;
  thumbnailItemsSeen: number;
  thumbnailItemsUnverified: number;
  nonImageThumbnailItems: number;
  eventVerificationFailures: number;
  droppedThumbnailBatches: number;
  droppedPaletteReadyEvents: number;
  importCompletedAtMs: number | null;
  taskRowsEvicted: number;
  snapshotsEvicted: number;
};

function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertSourceAndWorkspaceAreSeparate(source: string): string {
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    throw new Error('The configured real media source is unavailable.');
  }
  const resolvedSource = realpathSync(source);
  const workspace = realpathSync(process.cwd());
  if (isWithin(resolvedSource, workspace) || isWithin(workspace, resolvedSource)) {
    throw new Error('The read-only source and isolated test workspace must be separate trees.');
  }
  return resolvedSource;
}

function removeOwnedTemporaryRoot(root: string): void {
  const workspace = realpathSync(process.cwd());
  const resolvedRoot = path.resolve(root);
  if (
    path.dirname(resolvedRoot) !== workspace
    || !path.basename(resolvedRoot).startsWith('.tmp-real-online-derivatives-')
  ) {
    throw new Error('Refusing to clean outside the test-owned temporary root.');
  }
  const rootInfo = lstatSync(resolvedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Refusing to clean a missing or reparse-point temporary root.');
  }
  const realRoot = realpathSync(resolvedRoot);
  if (path.dirname(realRoot) !== workspace || path.basename(realRoot) !== path.basename(resolvedRoot)) {
    throw new Error('The test root no longer resolves as a direct workspace child.');
  }

  const assertNoReparsePoints = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const entry = path.join(directory, name);
      const info = lstatSync(entry);
      if (info.isSymbolicLink()) throw new Error('Refusing to clean a tree that contains a reparse point.');
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
  let quitRequestTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    application.evaluate(({ app }) => app.quit()).catch(() => undefined),
    new Promise<void>((resolve) => { quitRequestTimer = setTimeout(resolve, 2_000); }),
  ]);
  if (quitRequestTimer !== undefined) clearTimeout(quitRequestTimer);
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
      } else child.kill('SIGKILL');
    } catch {
      // The owned process may exit between the state check and termination request.
    }
    if (!processHasExited(child)) {
      let forcedExitTimer: ReturnType<typeof setTimeout> | undefined;
      const exited = await Promise.race([
        once(child, 'exit').then(() => true),
        new Promise<boolean>((resolve) => { forcedExitTimer = setTimeout(() => resolve(false), 10_000); }),
      ]);
      if (forcedExitTimer !== undefined) clearTimeout(forcedExitTimer);
      if (!exited) throw new Error('The isolated application process did not exit.');
    }
  }
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    application.close().catch(() => undefined),
    new Promise<void>((resolve) => { closeTimer = setTimeout(resolve, 1_000); }),
  ]);
  if (closeTimer !== undefined) clearTimeout(closeTimer);
  if (!processHasExited(child)) throw new Error('The isolated application process is still alive.');
  return !forced && child.exitCode === 0;
}

async function readOpenLibraryId(window: Page): Promise<string> {
  return window.evaluate(async () => {
    const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
    const opened = await api.listOpen();
    if (!opened.ok || !opened.value[0]) throw new Error('No isolated library is open.');
    return opened.value[0].libraryId;
  });
}

function addBoundedJobRows(state: ProbeState, rows: readonly MediaJobLite[]): void {
  const candidateAssetIds = new Set([...state.thumbnailArtifacts.values()].map((item) => item.assetId));
  for (const row of rows) {
    const candidate = candidateAssetIds.has(row.assetId);
    if (row.kind !== 'extract_palette' && !candidate && !(row.kind === 'generate_thumbnail' && row.status === 'running')
      && !(row.kind === 'generate_video_poster' && row.status === 'running')) continue;
    if (state.taskRows.has(row.jobId)) state.taskRows.delete(row.jobId);
    state.taskRows.set(row.jobId, row);
    if (state.taskRows.size > maxRememberedTaskRows) {
      const oldest = state.taskRows.keys().next().value;
      if (oldest !== undefined) {
        state.taskRows.delete(oldest);
        state.taskRowsEvicted += 1;
      }
    }
  }
}

async function readQueueSnapshot(
  window: Page,
  libraryId: string,
  candidateAssetIds: readonly string[],
): Promise<QueueSnapshot> {
  const snapshot = await window.evaluate(async ({ activeLibraryId, trackedAssetIds, pageSize, pageLimit }) => {
    type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    type Job = { jobId: string; assetId: string; revisionId: string | null; kind: string; status: string };
    type PageResult = {
      queuePaused?: boolean;
      queued: number;
      running: number;
      jobs: Job[];
      nextCursor?: { createdAt: string; jobId: string } | null;
      hasMore?: boolean;
    };
    const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
    const tracked = new Set(trackedAssetIds);
    const jobs: Job[] = [];
    let cursor: PageResult['nextCursor'] = null;
    let queuePaused: boolean | null = null;
    let queued = 0;
    let running = 0;
    let primaryQueuedObserved = 0;
    let primaryRunningObserved = 0;
    let paletteQueuedObserved = 0;
    let paletteRunningObserved = 0;
    let pagesRead = 0;
    let scanComplete = false;
    for (let pageIndex = 0; pageIndex < pageLimit; pageIndex += 1) {
      const result: Result<PageResult> = await api.listMediaJobs({
        libraryId: activeLibraryId,
        limit: pageSize,
        ...(cursor ? { cursor } : {}),
      });
      if (!result.ok) throw new Error('Could not inspect isolated media work.');
      const page = result.value;
      if (pageIndex === 0) {
        queuePaused = typeof page.queuePaused === 'boolean' ? page.queuePaused : null;
        queued = page.queued;
        running = page.running;
      }
      pagesRead += 1;
      for (const job of page.jobs) {
        if (
          (job.kind === 'generate_thumbnail' || job.kind === 'generate_video_poster')
          && job.status === 'queued'
        ) primaryQueuedObserved += 1;
        if (
          (job.kind === 'generate_thumbnail' || job.kind === 'generate_video_poster')
          && job.status === 'running'
        ) primaryRunningObserved += 1;
        if (job.kind === 'extract_palette' && job.status === 'queued') paletteQueuedObserved += 1;
        if (job.kind === 'extract_palette' && job.status === 'running') paletteRunningObserved += 1;
        if (
          job.kind === 'extract_palette'
          || tracked.has(job.assetId)
          || ((job.kind === 'generate_thumbnail' || job.kind === 'generate_video_poster') && job.status === 'running')
        ) jobs.push({
          jobId: job.jobId,
          assetId: job.assetId,
          revisionId: job.revisionId,
          kind: job.kind,
          status: job.status,
        });
      }
      if (!page.hasMore) {
        scanComplete = true;
        break;
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return {
      queuePaused,
      queued,
      running,
      primaryQueuedObserved,
      primaryRunningObserved,
      paletteQueuedObserved,
      paletteRunningObserved,
      pagesRead,
      scanComplete,
      jobs,
    };
  }, {
    activeLibraryId: libraryId,
    trackedAssetIds: [...new Set(candidateAssetIds)].slice(0, maxUniqueThumbnailArtifacts),
    pageSize: mediaJobPageSize,
    pageLimit: mediaJobPageLimit,
  });
  return { sampledAtMs: Date.now(), ...snapshot };
}

async function readCurrentRevisions(
  window: Page,
  libraryId: string,
  assetIds: readonly string[],
): Promise<{ revisions: Map<string, string>; missingCount: number; failed: boolean }> {
  const ids = [...new Set(assetIds)].slice(0, maxRevisionLookupAssets);
  const lookup = await window.evaluate(async ({ activeLibraryId, targetAssetIds, chunkSize }) => {
    type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
    const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
    const revisions: Array<{ assetId: string; revisionId: string }> = [];
    let missingCount = 0;
    let failed = false;
    for (let index = 0; index < targetAssetIds.length; index += chunkSize) {
      const chunk = targetAssetIds.slice(index, index + chunkSize);
      const result: Result<Array<{ assetId: string; currentRevisionId: string }>> = await api.listAssets({
        libraryId: activeLibraryId,
        recursive: true,
        assetIds: chunk,
      });
      if (!result.ok) {
        failed = true;
        missingCount += chunk.length;
        continue;
      }
      const byId = new Map(result.value.map((asset) => [asset.assetId, asset.currentRevisionId]));
      for (const assetId of chunk) {
        const revisionId = byId.get(assetId);
        if (revisionId) revisions.push({ assetId, revisionId });
        else missingCount += 1;
      }
    }
    return { revisions, missingCount, failed };
  }, { activeLibraryId: libraryId, targetAssetIds: ids, chunkSize: 100 });
  return {
    revisions: new Map(lookup.revisions.map(({ assetId, revisionId }) => [assetId, revisionId])),
    missingCount: lookup.missingCount + Math.max(0, new Set(assetIds).size - ids.length),
    failed: lookup.failed,
  };
}

async function installEventTracker(
  window: Page,
  libraryId: string,
  observe: (event: EventObservation) => void,
): Promise<EventTracker> {
  await window.exposeBinding('__realOnlineDerivativesReceive', (_source, payload: EventObservation) => observe(payload));
  const installed = await window.evaluate(async (activeLibraryId) => {
    type ReadyItem = { assetId: string; artifactId: string };
    type BindingPayload = EventObservation;
    const root = globalThis as typeof globalThis & {
      __realOnlineDerivativesReceive?: (payload: BindingPayload) => Promise<void>;
      __realOnlineDerivativesFlush?: () => Promise<void>;
      __realOnlineDerivativesDispose?: () => Promise<{
        droppedThumbnailBatches: number;
        droppedPaletteReadyEvents: number;
        forwardingFailed: boolean;
      }>;
    };
    const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
    let active = true;
    let pending = 0;
    let droppedThumbnailBatches = 0;
    let droppedPaletteReadyEvents = 0;
    let forwardingFailed = false;
    const maxPendingEventForwarders = 8;
    const flushWaiters = new Set<() => void>();
    const finishPending = (): void => {
      pending -= 1;
      if (pending !== 0) return;
      for (const resolve of flushWaiters) resolve();
      flushWaiters.clear();
    };
    const send = async (payload: BindingPayload): Promise<void> => {
      try {
        if (!root.__realOnlineDerivativesReceive) throw new Error('Host receiver is unavailable.');
        await root.__realOnlineDerivativesReceive(payload);
      } catch {
        forwardingFailed = true;
      }
    };
    const unsubscribe = api.onThumbnailEvent((event) => {
      if (!active || event.libraryId !== activeLibraryId) return;
      if (event.type === 'asset.thumbnail.batch-ready' || event.type === 'asset.thumbnail.ready') {
        const observedAtMs = Date.now();
        const items: ReadyItem[] = event.type === 'asset.thumbnail.batch-ready'
          ? event.ready.map(({ assetId, artifactId }) => ({ assetId, artifactId }))
          : [{ assetId: event.assetId, artifactId: event.artifactId }];
        if (items.length === 0) return;
        if (pending >= maxPendingEventForwarders) {
          droppedThumbnailBatches += 1;
          return;
        }
        pending += 1;
        void Promise.resolve().then(() => api.listAssets({
          libraryId: activeLibraryId,
          recursive: true,
          assetIds: items.map((item) => item.assetId),
        })).then((result) => {
          if (!result.ok) {
            return send({
              kind: 'thumbnail',
              observedAtMs,
              itemCount: items.length,
              items: [],
              verificationFailed: true,
            });
          }
          const byId = new Map(result.value.map((asset) => [asset.assetId, asset]));
          return send({
            kind: 'thumbnail',
            observedAtMs,
            itemCount: items.length,
            verificationFailed: false,
            items: items.map((item) => {
              const asset = byId.get(item.assetId);
              return {
                assetId: item.assetId,
                artifactId: item.artifactId,
                revisionId: asset?.currentRevisionId ?? null,
                mediaType: asset?.mediaType ?? null,
                imageReady: asset?.mediaType === 'image'
                  && asset.thumbnailStatus === 'ready'
                  && asset.thumbnailArtifactId === item.artifactId,
              };
            }),
          });
        }).catch(() => {
          forwardingFailed = true;
        }).finally(finishPending);
        return;
      }
      if (event.type === 'asset.derived.ready' && event.kind === 'extract_palette') {
        if (pending >= maxPendingEventForwarders) {
          droppedPaletteReadyEvents += 1;
          return;
        }
        pending += 1;
        void send({ kind: 'palette-ready', observedAtMs: Date.now(), assetId: event.assetId })
          .finally(finishPending);
      }
    });
    const flush = async (): Promise<void> => {
      if (pending > 0) await new Promise<void>((resolve) => flushWaiters.add(resolve));
    };
    root.__realOnlineDerivativesFlush = flush;
    root.__realOnlineDerivativesDispose = async () => {
      active = false;
      unsubscribe();
      await flush();
      return { droppedThumbnailBatches, droppedPaletteReadyEvents, forwardingFailed };
    };
    return true;
  }, libraryId);
  if (!installed) throw new Error('Could not subscribe to real media events.');

  return {
    flush: async () => window.evaluate(async () => {
      const root = globalThis as typeof globalThis & { __realOnlineDerivativesFlush?: () => Promise<void> };
      await root.__realOnlineDerivativesFlush?.();
    }),
    dispose: async () => window.evaluate(async () => {
      const root = globalThis as typeof globalThis & {
        __realOnlineDerivativesDispose?: () => Promise<{
          droppedThumbnailBatches: number;
          droppedPaletteReadyEvents: number;
          forwardingFailed: boolean;
        }>;
      };
      return await root.__realOnlineDerivativesDispose?.()
        ?? { droppedThumbnailBatches: 0, droppedPaletteReadyEvents: 0, forwardingFailed: true };
    }),
  };
}

function readQueueLog(userDataPath: string): { records: QueueLogRecord[]; missing: boolean; truncated: boolean } {
  let logPath: string;
  try {
    logPath = resolveSessionLogPath(path.join(userDataPath, 'logs'));
  } catch {
    return { records: [], missing: true, truncated: false };
  }
  if (!existsSync(logPath)) return { records: [], missing: true, truncated: false };
  const size = statSync(logPath).size;
  const start = Math.max(0, size - maxQueueLogBytes);
  const buffer = Buffer.allocUnsafe(size - start);
  const descriptor = openSync(logPath, 'r');
  let bytesRead = 0;
  try {
    while (bytesRead < buffer.length) {
      const read = readSync(descriptor, buffer, bytesRead, buffer.length - bytesRead, start + bytesRead);
      if (read === 0) break;
      bytesRead += read;
    }
  } finally {
    closeSync(descriptor);
  }
  let text = buffer.subarray(0, bytesRead).toString('utf8');
  let truncated = start > 0;
  if (truncated) {
    const firstNewline = text.indexOf('\n');
    text = firstNewline < 0 ? '' : text.slice(firstNewline + 1);
  }
  const records: QueueLogRecord[] = [];
  const lines = text.split(/\r?\n/u);
  for (let line = 0; line < lines.length; line += 1) {
    try {
      const entry = JSON.parse(lines[line]!) as {
        timestamp?: unknown;
        scope?: unknown;
        context?: Record<string, unknown>;
      };
      if (entry.scope !== 'worker.media-queue' || !entry.context) continue;
      const context = entry.context;
      const stage = context.mediaStage;
      const libraryId = context.libraryId;
      const jobId = context.jobId;
      const assetId = context.assetId;
      const kind = context.kind;
      const timestampMs = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
      if (
        typeof stage !== 'string'
        || typeof libraryId !== 'string'
        || !['job-start', 'job-finish', 'job-generated'].includes(stage)
        || typeof jobId !== 'string'
        || typeof assetId !== 'string'
        || typeof kind !== 'string'
        || !Number.isFinite(timestampMs)
      ) continue;
      records.push({
        line,
        timestampMs,
        libraryId,
        stage,
        jobId,
        assetId,
        kind,
        ...(typeof context.elapsedMs === 'number' && Number.isFinite(context.elapsedMs)
          ? { elapsedMs: context.elapsedMs }
          : {}),
      });
      if (records.length > maxQueueLogRecords) {
        records.shift();
        truncated = true;
      }
    } catch {
      // Non-JSON and unrelated log records are ignored without being emitted.
    }
  }
  return { records, missing: false, truncated };
}

function quantiles(values: readonly number[]): { count: number; p50Ms: number | null; p95Ms: number | null } {
  if (values.length === 0) return { count: 0, p50Ms: null, p95Ms: null };
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return { count: 0, p50Ms: null, p95Ms: null };
  const at = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
  return {
    count: sorted.length,
    p50Ms: Math.round(at(0.5) * 10) / 10,
    p95Ms: Math.round(at(0.95) * 10) / 10,
  };
}

function analyzeProbe(input: {
  state: ProbeState;
  logs: ReturnType<typeof readQueueLog>;
  libraryId: string;
  currentRevisions: Map<string, string>;
  currentRevisionLookupMissing: number;
  currentRevisionLookupFailed: boolean;
}): Record<string, unknown> {
  const { state, logs, libraryId, currentRevisions } = input;
  const startMs = state.windowStartMs ?? 0;
  const endMs = state.windowEndMs ?? Date.now();
  const records = logs.records
    .filter((record) => record.libraryId === libraryId && record.timestampMs <= endMs)
    .sort((left, right) => left.timestampMs - right.timestampMs || left.line - right.line);
  const inWindow = (record: QueueLogRecord) => record.timestampMs >= startMs && record.timestampMs <= endMs;
  const primaryKind = (kind: string) => kind === 'generate_thumbnail' || kind === 'generate_video_poster';
  const taskMeta = (record: QueueLogRecord): JobMeta | null => {
    const row = state.taskRows.get(record.jobId);
    if (
      !row
      || row.assetId !== record.assetId
      || row.kind !== record.kind
      || !row.revisionId
    ) return null;
    return { ...row, revisionId: row.revisionId };
  };
  const revisionMatchesCurrent = (record: QueueLogRecord, meta: JobMeta) => {
    const current = currentRevisions.get(record.assetId);
    return current !== undefined && current === meta.revisionId;
  };

  const paletteStarts = records.filter((record) =>
    record.stage === 'job-start' && record.kind === 'extract_palette' && inWindow(record));
  const paletteFinishes = records.filter((record) =>
    record.stage === 'job-finish' && record.kind === 'extract_palette' && inWindow(record));
  const primaryStarts = records.filter((record) =>
    record.stage === 'job-start' && primaryKind(record.kind));
  const primaryFinishes = records.filter((record) =>
    record.stage === 'job-finish' && primaryKind(record.kind));
  const primaryGenerated = records.filter((record) =>
    record.stage === 'job-generated' && primaryKind(record.kind));

  let matchedPaletteTaskRows = 0;
  let missingPaletteTaskRows = 0;
  let missingPaletteAssetRevisions = 0;
  let stalePaletteRevisions = 0;
  const validPaletteStarts = new Set<string>();
  for (const record of paletteStarts) {
    const meta = taskMeta(record);
    if (!meta) {
      missingPaletteTaskRows += 1;
      continue;
    }
    const currentRevision = currentRevisions.get(record.assetId);
    if (!currentRevision) {
      missingPaletteAssetRevisions += 1;
      continue;
    }
    if (currentRevision !== meta.revisionId) {
      stalePaletteRevisions += 1;
      continue;
    }
    matchedPaletteTaskRows += 1;
    validPaletteStarts.add(record.jobId);
  }

  const queueStateAt = (timestampMs: number, beforeLine?: number): {
    activeKnown: number;
    activeUnknown: number;
    activeObserved: number;
    queuedObserved: number;
    snapshotAgeMs: number | null;
    snapshotFresh: boolean;
    queueUnknown: boolean;
  } => {
    const active = new Set<string>();
    const activeUnknown = new Set<string>();
    for (const record of records) {
      if (
        record.timestampMs > timestampMs
        || (record.timestampMs === timestampMs && (beforeLine === undefined || record.line >= beforeLine))
      ) break;
      if (record.stage === 'job-start' && primaryKind(record.kind)) {
        const meta = taskMeta(record);
        if (meta && revisionMatchesCurrent(record, meta)) active.add(record.jobId);
        else activeUnknown.add(record.jobId);
      } else if (record.stage === 'job-finish' && primaryKind(record.kind)) {
        active.delete(record.jobId);
        activeUnknown.delete(record.jobId);
      }
    }
    const snapshot = [...state.snapshots]
      .filter((item) => item.sampledAtMs < timestampMs)
      .sort((left, right) => right.sampledAtMs - left.sampledAtMs)[0];
    const snapshotAgeMs = snapshot ? timestampMs - snapshot.sampledAtMs : null;
    const fresh = snapshot !== undefined && snapshotAgeMs !== null && snapshotAgeMs <= 2_000;
    const queuedObserved = fresh ? snapshot.primaryQueuedObserved : 0;
    const activeObserved = fresh ? snapshot.primaryRunningObserved : 0;
    const queueUnknown = !fresh || (
      !snapshot!.scanComplete
      && (
        (snapshot!.queued > 0 && snapshot!.primaryQueuedObserved === 0)
        || (snapshot!.running > 0 && snapshot!.primaryRunningObserved === 0)
      )
    );
    return {
      activeKnown: active.size,
      activeUnknown: activeUnknown.size,
      activeObserved,
      queuedObserved,
      snapshotAgeMs: fresh ? snapshotAgeMs : null,
      snapshotFresh: fresh,
      queueUnknown,
    };
  };

  let paletteStartsWhilePrimaryActive = 0;
  let paletteStartsWhilePrimaryQueued = 0;
  let paletteStartsWithUnknownPrimaryState = 0;
  let freshQueueSnapshotsAtPaletteStarts = 0;
  const queueSampleAgesAtPaletteStart: number[] = [];
  for (const record of paletteStarts) {
    const stateAtStart = queueStateAt(record.timestampMs, record.line);
    if (stateAtStart.snapshotFresh && stateAtStart.snapshotAgeMs !== null) {
      freshQueueSnapshotsAtPaletteStarts += 1;
      queueSampleAgesAtPaletteStart.push(stateAtStart.snapshotAgeMs);
    }
    if (stateAtStart.activeKnown > 0 || stateAtStart.activeObserved > 0) paletteStartsWhilePrimaryActive += 1;
    if (stateAtStart.queuedObserved > 0) {
      paletteStartsWhilePrimaryQueued += 1;
    }
    if (
      stateAtStart.activeKnown === 0
      && stateAtStart.activeObserved === 0
      && stateAtStart.queuedObserved === 0
      && (stateAtStart.activeUnknown > 0 || stateAtStart.queueUnknown)
    ) paletteStartsWithUnknownPrimaryState += 1;
  }

  const paletteReady = state.paletteReadyEvents.filter((event) =>
    event.observedAtMs >= startMs && event.observedAtMs <= endMs);
  let matchedPaletteReadyEvents = 0;
  const consumedReadyEvents = new Set<number>();
  const paletteDurationMs: number[] = [];
  for (const start of paletteStarts) {
    if (!validPaletteStarts.has(start.jobId)) continue;
    const meta = taskMeta(start);
    if (!meta) continue;
    const readyIndex = paletteReady.findIndex((event, index) =>
      !consumedReadyEvents.has(index)
      && event.assetId === start.assetId
      && event.observedAtMs >= start.timestampMs
      && currentRevisions.get(event.assetId) === meta.revisionId);
    const finish = paletteFinishes.find((record) => record.jobId === start.jobId);
    if (readyIndex < 0 || !finish) continue;
    consumedReadyEvents.add(readyIndex);
    matchedPaletteReadyEvents += 1;
    const ready = paletteReady[readyIndex]!;
    if (ready.observedAtMs >= start.timestampMs && finish.elapsedMs !== undefined) {
      paletteDurationMs.push(finish.elapsedMs);
    }
  }
  const unmatchedPaletteReadyEvents = paletteReady.length - matchedPaletteReadyEvents;

  const paletteWaitMs: number[] = [];
  let paletteStartsWithoutPrimaryGeneration = 0;
  let paletteWaitMissingRevision = 0;
  for (const start of paletteStarts) {
    if (!validPaletteStarts.has(start.jobId)) continue;
    const paletteMeta = taskMeta(start);
    if (!paletteMeta) continue;
    const matchingGeneration = primaryGenerated
      .filter((record) =>
        record.assetId === start.assetId
        && record.timestampMs <= start.timestampMs,
      )
      .reverse()
      .find((record) => {
        const primaryMeta = taskMeta(record);
        return primaryMeta !== null
          && primaryMeta.revisionId === paletteMeta.revisionId
          && revisionMatchesCurrent(record, primaryMeta);
      });
    if (!matchingGeneration) {
      const candidate = primaryGenerated.some((record) =>
        record.assetId === start.assetId && record.timestampMs <= start.timestampMs);
      if (candidate) paletteWaitMissingRevision += 1;
      else paletteStartsWithoutPrimaryGeneration += 1;
      continue;
    }
    paletteWaitMs.push(Math.max(0, start.timestampMs - matchingGeneration.timestampMs));
  }

  let paletteReadyWhilePrimaryActive = 0;
  let paletteReadyWhilePrimaryQueued = 0;
  for (const event of paletteReady) {
    const stateAtReady = queueStateAt(event.observedAtMs);
    if (stateAtReady.activeKnown > 0 || stateAtReady.activeObserved > 0) paletteReadyWhilePrimaryActive += 1;
    if (stateAtReady.queuedObserved > 0) paletteReadyWhilePrimaryQueued += 1;
  }

  const snapshotAgeSummary = quantiles(queueSampleAgesAtPaletteStart);
  const firstSnapshot = state.snapshots[0];
  const lastSnapshot = state.snapshots.at(-1);
  const snapshotSummary = (snapshot: QueueSnapshot | undefined) => snapshot ? {
    primaryQueuedObserved: snapshot.primaryQueuedObserved,
    primaryRunningObserved: snapshot.primaryRunningObserved,
    paletteQueuedObserved: snapshot.paletteQueuedObserved,
    paletteRunningObserved: snapshot.paletteRunningObserved,
    scanComplete: snapshot.scanComplete,
  } : null;
  const paletteQueuedSnapshotCount = state.snapshots.filter((snapshot) => snapshot.paletteQueuedObserved > 0).length;
  const paletteRunningSnapshotCount = state.snapshots.filter((snapshot) => snapshot.paletteRunningObserved > 0).length;
  const maxPaletteQueuedObserved = Math.max(0, ...state.snapshots.map((snapshot) => snapshot.paletteQueuedObserved));
  const maxPaletteRunningObserved = Math.max(0, ...state.snapshots.map((snapshot) => snapshot.paletteRunningObserved));
  const logsComplete = !logs.missing && !logs.truncated;
  const taskRevisionCoverage = !logsComplete || input.currentRevisionLookupFailed
    ? 'insufficient'
    : (
      missingPaletteTaskRows
      + missingPaletteAssetRevisions
      + stalePaletteRevisions
      + input.currentRevisionLookupMissing > 0
        ? 'partial'
        : (state.snapshots.some((snapshot) => !snapshot.scanComplete) || state.taskRowsEvicted > 0
          ? 'partial'
          : 'matched')
    );
  return {
    stopReason: state.stopReason ?? 'time-window',
    windowMs: Math.max(0, Math.round(endMs - startMs)),
    thumbnail: {
      uniqueVerifiedImageArtifacts: state.thumbnailArtifacts.size,
      target: targetUniqueThumbnailArtifacts,
      readyEvents: state.thumbnailReadyEvents,
      readyItemsSeen: state.thumbnailItemsSeen,
      readyItemsUnverified: state.thumbnailItemsUnverified,
      nonImageReadyItems: state.nonImageThumbnailItems,
      eventVerificationFailures: state.eventVerificationFailures,
    },
    primary: {
      jobStarts: logsComplete ? primaryStarts.filter(inWindow).length : null,
      generated: logsComplete ? primaryGenerated.filter(inWindow).length : null,
      jobFinishes: logsComplete ? primaryFinishes.filter(inWindow).length : null,
    },
    palette: {
      jobStarts: logsComplete ? paletteStarts.length : null,
      startsMatchedToCurrentRevision: matchedPaletteTaskRows,
      startsMissingTaskRevision: missingPaletteTaskRows,
      startsMissingCurrentAssetRevision: missingPaletteAssetRevisions,
      startsWithStaleRevision: stalePaletteRevisions,
      startsWhilePrimaryActive: paletteStartsWhilePrimaryActive,
      startsWhilePrimaryQueuedObserved: paletteStartsWhilePrimaryQueued,
      startsWithPrimaryStateInsufficient: paletteStartsWithUnknownPrimaryState,
      startsWithoutMatchingPrimaryGeneration: paletteStartsWithoutPrimaryGeneration,
      waitFromPrimaryGenerationMs: logsComplete ? quantiles(paletteWaitMs) : { count: null, p50Ms: null, p95Ms: null },
      waitMissingRevision: paletteWaitMissingRevision,
      successfulReadyEvents: matchedPaletteReadyEvents,
      readyEventsUnmatched: unmatchedPaletteReadyEvents,
      readyWhilePrimaryActive: paletteReadyWhilePrimaryActive,
      readyWhilePrimaryQueuedObserved: paletteReadyWhilePrimaryQueued,
      successfulJobDurationMs: logsComplete ? quantiles(paletteDurationMs) : { count: null, p50Ms: null, p95Ms: null },
      finishLogCount: logsComplete ? paletteFinishes.length : null,
    },
    queue: {
      snapshots: state.snapshots.length,
      snapshotsEvicted: state.snapshotsEvicted,
      truncatedSnapshots: state.snapshots.filter((snapshot) => !snapshot.scanComplete).length,
      snapshotCoverage: state.snapshots.length === 0
        ? 'insufficient'
        : (state.snapshots.every((snapshot) => snapshot.scanComplete) ? 'complete' : 'partial'),
      firstSnapshotObserved: snapshotSummary(firstSnapshot),
      lastSnapshotObserved: snapshotSummary(lastSnapshot),
      paletteQueuedObservedSnapshots: paletteQueuedSnapshotCount,
      maxPaletteQueuedObserved: maxPaletteQueuedObserved,
      paletteRunningObservedSnapshots: paletteRunningSnapshotCount,
      maxPaletteRunningObserved: maxPaletteRunningObserved,
      freshSnapshotAtPaletteStarts: freshQueueSnapshotsAtPaletteStarts,
      staleOrMissingSnapshotAtPaletteStarts: paletteStarts.length - freshQueueSnapshotsAtPaletteStarts,
      sampleAgeAtQueuedPaletteStartMs: snapshotAgeSummary,
      taskRowsRetained: state.taskRows.size,
      taskRowsEvicted: state.taskRowsEvicted,
      currentRevisionLookupMissing: input.currentRevisionLookupMissing,
      currentRevisionLookupFailed: input.currentRevisionLookupFailed,
      taskRevisionCoverage,
      taskListKindStatusFiltersAvailable: false,
      oldPaletteRowsMayBeOutsideScannedPages: state.snapshots.some((snapshot) => !snapshot.scanComplete),
      note: 'Palette queue counts are observed rows from bounded pages; zero is not a full-queue claim when coverage is partial.',
    },
    evidenceLimits: {
      originFieldObserved: false,
      explicitOperationsIssuedByProbe: 0,
      queuePausedAtWindowStart: state.initialQueuePaused,
      queuePauseSamples: state.snapshots.length,
      queuePauseStateDuringWindow: state.snapshots.length === 0
        ? 'insufficient'
        : (state.snapshots.every((snapshot) => snapshot.queuePaused === false) ? 'observed-false' : 'changed'),
      logMissing: logs.missing,
      logTruncated: logs.truncated,
      eventBatchesDropped: state.droppedThumbnailBatches,
      paletteEventsDropped: state.droppedPaletteReadyEvents,
      note: 'Admission origin is not exposed; only the isolated import-and-browse path was measured.',
    },
    queueLogRecords: logsComplete ? records.filter(inWindow).length : null,
  };
}

function createProbeState(): ProbeState {
  return {
    windowStartMs: null,
    windowEndMs: null,
    initialQueuePaused: null,
    stopReason: null,
    thumbnailArtifacts: new Map(),
    paletteReadyEvents: [],
    snapshots: [],
    taskRows: new Map(),
    thumbnailReadyEvents: 0,
    thumbnailItemsSeen: 0,
    thumbnailItemsUnverified: 0,
    nonImageThumbnailItems: 0,
    eventVerificationFailures: 0,
    droppedThumbnailBatches: 0,
    droppedPaletteReadyEvents: 0,
    importCompletedAtMs: null,
    taskRowsEvicted: 0,
    snapshotsEvicted: 0,
  };
}

function recordEvent(state: ProbeState, event: EventObservation): void {
  if (event.kind === 'thumbnail') {
    if (event.observedAtMs < (state.windowStartMs ?? Number.POSITIVE_INFINITY)) return;
    if (state.windowEndMs !== null && event.observedAtMs > state.windowEndMs) return;
    state.thumbnailReadyEvents += 1;
    state.thumbnailItemsSeen += event.itemCount;
    if (event.verificationFailed) {
      state.eventVerificationFailures += 1;
      state.thumbnailItemsUnverified += event.itemCount;
      return;
    }
    for (const item of event.items) {
      if (item.mediaType !== null && item.mediaType !== 'image') {
        state.nonImageThumbnailItems += 1;
        continue;
      }
      if (!item.imageReady || !item.revisionId) {
        state.thumbnailItemsUnverified += 1;
        continue;
      }
      const key = JSON.stringify([item.assetId, item.revisionId, item.artifactId]);
      if (state.thumbnailArtifacts.has(key)) continue;
      if (state.thumbnailArtifacts.size >= maxUniqueThumbnailArtifacts) {
        state.droppedThumbnailBatches += 1;
        continue;
      }
      state.thumbnailArtifacts.set(key, { ...item, observedAtMs: event.observedAtMs });
      if (state.thumbnailArtifacts.size >= targetUniqueThumbnailArtifacts && state.windowEndMs === null) {
        state.windowEndMs = event.observedAtMs;
        state.stopReason = 'thumbnail-target';
      }
    }
    return;
  }
  if (event.observedAtMs < (state.windowStartMs ?? Number.POSITIVE_INFINITY)) return;
  if (state.windowEndMs !== null && event.observedAtMs > state.windowEndMs) return;
  if (state.paletteReadyEvents.length >= maxPaletteReadyEvents) {
    state.droppedPaletteReadyEvents += 1;
    return;
  }
  state.paletteReadyEvents.push({ assetId: event.assetId, observedAtMs: event.observedAtMs });
}

function recordSnapshot(state: ProbeState, snapshot: QueueSnapshot): void {
  addBoundedJobRows(state, snapshot.jobs);
  if (state.snapshots.length >= maxSnapshots) {
    state.snapshots.shift();
    state.snapshotsEvicted += 1;
  }
  state.snapshots.push({ ...snapshot, jobs: [] });
}

async function pauseForCleanup(window: Page, libraryId: string): Promise<void> {
  await window.evaluate(async (activeLibraryId) => {
    const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
    await api.pauseMediaJobs({ libraryId: activeLibraryId });
  }, libraryId).catch(() => undefined);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !window.isClosed()) {
    const idle = await window.evaluate(async (activeLibraryId) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
      const result = await api.getMediaJobSummary({ libraryId: activeLibraryId });
      return result.ok && result.value.queued === 0 && result.value.running === 0;
    }, libraryId).catch(() => true);
    if (idle) return;
    await window.waitForTimeout(250);
  }
}

test('observes online palette scheduling against real linked thumbnails', async () => {
  if (!sourceRoot) return;
  const resolvedSource = assertSourceAndWorkspaceAreSeparate(sourceRoot);
  const workspace = realpathSync(process.cwd());
  const workspaceDisk = statfsSync(workspace);
  if (workspaceDisk.bavail * workspaceDisk.bsize < 10 * 1024 ** 3) {
    throw new Error('At least 10 GiB of free workspace space is required for the isolated real-media probe.');
  }

  const root = mkdtempSync(path.join(workspace, '.tmp-real-online-derivatives-'));
  const userDataPath = path.join(root, 'profile');
  const libraryName = 'OnlineDerivativesFixture';
  const libraryPath = path.join(root, libraryName);
  let application: ElectronApplication | undefined;
  let child: ChildProcess | undefined;
  let launchAttempted = false;
  let tracker: EventTracker | undefined;
  let libraryId: string | undefined;
  let phase = 'launch';
  let cleanupFailed = false;
  const state = createProbeState();
  const runStartedAt = Date.now();

  const reportProgress = (stopReason: string) => ({
    phase,
    elapsedMs: Date.now() - runStartedAt,
    stopReason,
    uniqueThumbnailArtifacts: state.thumbnailArtifacts.size,
    paletteReadyEvents: state.paletteReadyEvents.length,
    queueSnapshots: state.snapshots.length,
  });

  try {
    phase = 'launch-isolated-library';
    launchAttempted = true;
    const launched = await launchBenchmarkApp({
      userDataPath,
      extraEnv: {
        SERPENT_E2E_HIDE_WINDOW: '1',
        SERPENT_E2E_CREATE_PARENT_PATH: root,
        SERPENT_E2E_LINKED_SOURCE: resolvedSource,
      },
    });
    application = launched.application;
    child = application.process();
    const { window } = launched;
    await window.setViewportSize({ width: 1360, height: 980 });
    const visibleWindow = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((browserWindow) => browserWindow.isVisible()),
    );
    if (visibleWindow) throw new Error('The media diagnostic application window must remain hidden.');

    await window.getByRole('button', { name: '创建资源库', exact: true }).click();
    await window.getByRole('textbox', { name: '名称', exact: true }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    const createDeadline = Date.now() + 60_000;
    while (!existsSync(libraryPath) && Date.now() < createDeadline) await window.waitForTimeout(100);
    if (!existsSync(libraryPath)) throw new Error('The isolated library was not created.');
    await window.locator('.workspace-canvas').waitFor({ state: 'visible', timeout: 60_000 });
    libraryId = await readOpenLibraryId(window);

    tracker = await installEventTracker(window, libraryId, (event) => recordEvent(state, event));
    phase = 'ordinary-browse';
    await window.getByRole('button', { name: '所有资产', exact: true }).click();
    await window.locator('.workspace-canvas').waitFor({ state: 'visible', timeout: 30_000 });
    await tracker.flush();
    const initialQueue = await readQueueSnapshot(window, libraryId, []);
    if (initialQueue.queuePaused !== false) {
      throw new Error('The isolated media queue was paused or its state was unavailable before measurement.');
    }
    state.initialQueuePaused = initialQueue.queuePaused;

    type ImportOutcome = { ok: boolean; assetCount: number; completedAtMs: number };
    let settleImport!: (outcome: ImportOutcome) => void;
    const importState: { outcome: ImportOutcome | null } = { outcome: null };
    const importResultPromise = new Promise<ImportOutcome>((resolve) => { settleImport = resolve; });
    await window.exposeBinding('__realOnlineDerivativesImportComplete', (_source, outcome: ImportOutcome) => {
      state.importCompletedAtMs = outcome.completedAtMs;
      importState.outcome = outcome;
      settleImport(outcome);
    });
    state.windowStartMs = Date.now();
    const deadline = state.windowStartMs + observationWindowMs;
    phase = 'linked-source-import-and-online-observation';
    const importStarted = await window.evaluate((activeLibraryId) => {
      const root = globalThis as typeof globalThis & {
        __realOnlineDerivativesImportComplete?: (outcome: { ok: boolean; assetCount: number; completedAtMs: number }) => Promise<void>;
      };
      const api = (globalThis as typeof globalThis & { serpent: { library: SerpentLibraryApi } }).serpent.library;
      void api.importFolderAsLinked({
        libraryId: activeLibraryId,
        displayName: 'ReadOnlyMediaFixture',
      }).then((result) => root.__realOnlineDerivativesImportComplete?.({
        ok: result.ok,
        assetCount: result.ok ? result.value.assetCount : 0,
        completedAtMs: Date.now(),
      })).catch(() => root.__realOnlineDerivativesImportComplete?.({
        ok: false,
        assetCount: 0,
        completedAtMs: Date.now(),
      }));
      return true;
    }, libraryId);
    if (!importStarted) throw new Error('Could not start linked source import.');

    phase = 'online-observation';
    let lastSnapshotAt = 0;
    let lastProgressAt = Date.now();
    let unexpectedPause = false;
    while (
      state.thumbnailArtifacts.size < targetUniqueThumbnailArtifacts
      && Date.now() < deadline
      && !unexpectedPause
    ) {
      await window.waitForTimeout(250);
      await tracker.flush();
      if (state.windowEndMs !== null) break;
      const now = Date.now();
      if (importState.outcome?.ok && now - lastSnapshotAt >= 1_000) {
        const snapshot = await readQueueSnapshot(
          window,
          libraryId,
          [...new Set([...state.thumbnailArtifacts.values()].map((item) => item.assetId))],
        );
        if (state.windowEndMs === null && snapshot.sampledAtMs <= deadline) {
          recordSnapshot(state, snapshot);
        }
        lastSnapshotAt = Date.now();
        if (state.windowEndMs === null && snapshot.sampledAtMs <= deadline && snapshot.queuePaused !== false) {
          unexpectedPause = true;
          state.stopReason = 'unexpected-pause';
          state.windowEndMs = Math.min(lastSnapshotAt, deadline);
          break;
        }
      }
      if (Date.now() - lastProgressAt >= 10_000) {
        console.log('real online derivative progress', JSON.stringify(reportProgress('in-progress')));
        lastProgressAt = Date.now();
      }
    }
    if (state.windowEndMs === null) {
      state.windowEndMs = Math.min(Date.now(), deadline);
      if (state.stopReason === null) state.stopReason = unexpectedPause ? 'unexpected-pause' : 'time-window';
    }
    await tracker.flush();
    const trackerDiagnostics = await tracker.dispose();
    tracker = undefined;
    state.droppedThumbnailBatches += trackerDiagnostics.droppedThumbnailBatches;
    state.droppedPaletteReadyEvents += trackerDiagnostics.droppedPaletteReadyEvents;
    if (trackerDiagnostics.forwardingFailed) state.eventVerificationFailures += 1;

    phase = 'linked-import-settlement-after-measurement';
    const importResult = await importResultPromise;
    if (!importResult.ok || importResult.assetCount <= 0) {
      throw new Error('Linked source import did not complete successfully.');
    }

    phase = 'freeze-and-correlate-evidence';
    const queueLog = readQueueLog(userDataPath);
    const relevantAssetIds = new Set<string>();
    for (const event of state.paletteReadyEvents) relevantAssetIds.add(event.assetId);
    for (const row of state.taskRows.values()) {
      if (row.kind === 'extract_palette' || row.kind === 'generate_thumbnail' || row.kind === 'generate_video_poster') {
        relevantAssetIds.add(row.assetId);
      }
    }
    const watchedAssetIds = new Set([...state.thumbnailArtifacts.values()].map((item) => item.assetId));
    for (const record of queueLog.records) {
      if (record.libraryId !== libraryId || record.timestampMs > state.windowEndMs) continue;
      if (
        record.kind === 'extract_palette'
        || record.kind === 'generate_thumbnail'
        || record.kind === 'generate_video_poster'
        || watchedAssetIds.has(record.assetId)
      ) relevantAssetIds.add(record.assetId);
    }
    const revisionLookup = await readCurrentRevisions(window, libraryId, [...relevantAssetIds]);
    const summary = analyzeProbe({
      state,
      logs: queueLog,
      libraryId,
      currentRevisions: revisionLookup.revisions,
      currentRevisionLookupMissing: revisionLookup.missingCount,
      currentRevisionLookupFailed: revisionLookup.failed,
    });
    console.log('real online derivatives result', JSON.stringify({
      result: 'observed',
      importedAssets: importResult.assetCount,
      importCompletedBeforeWindowEnd: state.importCompletedAtMs !== null
        && state.importCompletedAtMs <= (state.windowEndMs ?? Date.now()),
      ...summary,
    }));

    phase = 'pause-after-measurement-for-cleanup';
    await pauseForCleanup(window, libraryId);
  } catch {
    console.log('real online derivatives result', JSON.stringify({
      result: 'failed',
      ...reportProgress(state.stopReason ?? 'incomplete'),
    }));
    throw new Error(`The real online derivatives probe failed during ${phase}.`);
  } finally {
    if (tracker && application && application.windows().some((window) => !window.isClosed())) {
      await tracker.dispose().catch(() => undefined);
    }
    if (application && child && !processHasExited(child)) {
      try {
        if (!await closeOwnedApplication(application, child)) cleanupFailed = true;
      } catch {
        cleanupFailed = true;
      }
    }
    let removed = false;
    if (!launchAttempted || (child !== undefined && processHasExited(child))) {
      try {
        removeOwnedTemporaryRoot(root);
        removed = true;
      } catch {
        cleanupFailed = true;
      }
    } else cleanupFailed = true;
    console.log('real online derivatives cleanup', JSON.stringify({ removed, graceful: !cleanupFailed }));
  }
  if (cleanupFailed) throw new Error('The test-owned temporary root could not be safely cleaned.');
});
