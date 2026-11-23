import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

interface TestDatabaseConnection {
  close(): void;
  prepare(source: string): {
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
}

const require = createRequire(import.meta.url);
const TestDatabase = require('better-sqlite3') as new (
  filename: string,
) => TestDatabaseConnection;

const temporaryRoots: string[] = [];
const services: LibraryService[] = [];

// Same small native PNG fixture used by the thumbnail Worker tests. The
// dimensions exceed the source-direct card policy so queue admission is real.
const THUMBNAIL_REQUIRED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAACAEAAAABCAIAAAAqtLKbAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAOklEQVRYhe3YQQ0AAAgDMeRMImInBh+kySno8yZbESBAgAABAgQIECBAgAABAgQIECBAgAABAnk3zA9mXOIiDxU7WQAAAABJRU5ErkJggg==',
  'base64',
);

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

function newService(options?: ConstructorParameters<typeof LibraryService>[0]): LibraryService {
  const service = new LibraryService(options);
  services.push(service);
  return service;
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-media-queue-pause-'));
  temporaryRoots.push(root);
  return root;
}

function createImageAsset(
  service: LibraryService,
  libraryId: string,
  root: string,
  name: string,
): string {
  const sourcePath = path.join(root, `${name}.png`);
  writeFileSync(sourcePath, Buffer.concat([THUMBNAIL_REQUIRED_PNG, Buffer.from(name)]));
  const imported = importNoConflict(service, libraryId, sourcePath);
  const assetId = imported.assets[0]?.assetId;
  if (!assetId) throw new Error('Image fixture import did not return an asset.');
  return assetId;
}

function isQueuePaused(service: LibraryService, libraryId: string): boolean {
  const queueApi = service as LibraryService & {
    isMediaQueuePaused(libraryId: string): boolean;
  };
  return queueApi.isMediaQueuePaused(libraryId);
}

function summaryQueuePaused(service: LibraryService, libraryId: string): boolean | undefined {
  const summary = service.listMediaJobs(libraryId, { summaryOnly: true }) as ReturnType<
    LibraryService['listMediaJobs']
  > & { queuePaused?: boolean };
  return summary.queuePaused;
}

function enqueueExplicitThumbnail(
  service: LibraryService,
  libraryId: string,
  assetId: string,
): number {
  return service.enqueueThumbnailJobs(libraryId, {
    assetIds: [assetId],
    origin: 'explicit',
    skipStaleRepair: true,
  } as unknown as Parameters<LibraryService['enqueueThumbnailJobs']>[1]);
}

function thumbnailJob(service: LibraryService, libraryId: string, assetId: string) {
  return service.listMediaJobs(libraryId).jobs.find(
    (job) => job.assetId === assetId && job.kind === 'generate_thumbnail',
  );
}

function databaseFor(libraryPath: string): TestDatabaseConnection {
  return new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
}

function jobAdmissionOrigin(libraryPath: string, jobId: string): string | undefined {
  const db = databaseFor(libraryPath);
  try {
    return (db.prepare(
      'SELECT media_admission_origin AS origin FROM jobs WHERE job_id = ?',
    ).get(jobId) as { origin: string } | undefined)?.origin;
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('library-scoped media queue pause', () => {
  it('persists an empty-queue pause and exposes it immediately in the summary', () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Empty media queue pause',
      selectedParentPath: root,
    });

    expect(isQueuePaused(service, library.libraryId)).toBe(false);
    expect(summaryQueuePaused(service, library.libraryId)).toBe(false);

    expect(service.pauseMediaJobs(library.libraryId)).toEqual({ pausedCount: 0 });
    expect(isQueuePaused(service, library.libraryId)).toBe(true);
    expect(summaryQueuePaused(service, library.libraryId)).toBe(true);
    expect(service.listMediaJobs(library.libraryId, { summaryOnly: true }).paused).toBe(0);

    service.closeAll();
    const reopened = newService();
    reopened.openLibrary(library.libraryPath);

    expect(isQueuePaused(reopened, library.libraryId)).toBe(true);
    expect(summaryQueuePaused(reopened, library.libraryId)).toBe(true);
    expect(reopened.resumeMediaJobs(library.libraryId)).toEqual({ resumedCount: 0 });
    expect(isQueuePaused(reopened, library.libraryId)).toBe(false);
  });

  it('keeps selected controls scoped and lets cancel leave the global mode unchanged', () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Selected media queue controls',
      selectedParentPath: root,
    });
    const firstAssetId = createImageAsset(service, library.libraryId, root, 'first-image');
    const secondAssetId = createImageAsset(service, library.libraryId, root, 'second-image');

    expect(service.enqueueThumbnailJobs(library.libraryId, {
      assetIds: [firstAssetId, secondAssetId],
      skipStaleRepair: true,
    })).toBe(2);
    const firstJob = thumbnailJob(service, library.libraryId, firstAssetId)!;

    expect(service.pauseMediaJobs(library.libraryId, [firstJob.jobId])).toEqual({ pausedCount: 1 });
    expect(thumbnailJob(service, library.libraryId, firstAssetId)?.status).toBe('paused');
    expect(thumbnailJob(service, library.libraryId, secondAssetId)?.status).toBe('queued');
    expect(isQueuePaused(service, library.libraryId)).toBe(false);

    expect(service.resumeMediaJobs(library.libraryId, [firstJob.jobId])).toEqual({ resumedCount: 1 });
    expect(thumbnailJob(service, library.libraryId, firstAssetId)?.status).toBe('queued');
    expect(isQueuePaused(service, library.libraryId)).toBe(false);

    expect(service.pauseMediaJobs(library.libraryId)).toEqual({ pausedCount: 2 });
    expect(isQueuePaused(service, library.libraryId)).toBe(true);
    expect(service.cancelMediaJobs(library.libraryId)).toEqual({ cancelledCount: 2 });
    expect(isQueuePaused(service, library.libraryId)).toBe(true);
    expect(service.resumeMediaJobs(library.libraryId)).toEqual({ resumedCount: 0 });
    expect(isQueuePaused(service, library.libraryId)).toBe(false);
  });

  it('rejects empty ID arrays instead of broadening a selected action', () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Empty selected media queue controls',
      selectedParentPath: root,
    });

    expect(() => service.pauseMediaJobs(library.libraryId, [])).toThrow(TypeError);
    expect(() => service.resumeMediaJobs(library.libraryId, [])).toThrow(TypeError);
    expect(() => service.cancelMediaJobs(library.libraryId, [])).toThrow(TypeError);
    expect(() => service.retryMediaJobs(library.libraryId, [])).toThrow(TypeError);
    expect(isQueuePaused(service, library.libraryId)).toBe(false);
  });

  it('blocks automatic admission for only the paused library and resumes admission when cleared', () => {
    const root = temporaryRoot();
    const service = newService();
    const firstLibrary = service.createLibrary({
      displayName: 'Paused library',
      selectedParentPath: root,
    });
    const secondLibrary = service.createLibrary({
      displayName: 'Active library',
      selectedParentPath: root,
    });
    const firstAssetId = createImageAsset(service, firstLibrary.libraryId, root, 'paused-image');
    const secondAssetId = createImageAsset(service, secondLibrary.libraryId, root, 'active-image');

    expect(service.pauseMediaJobs(firstLibrary.libraryId)).toEqual({ pausedCount: 0 });
    expect(service.enqueueThumbnailJobs(firstLibrary.libraryId, {
      assetIds: [firstAssetId],
      skipStaleRepair: true,
    })).toBe(0);
    expect(service.enqueueThumbnailJobs(secondLibrary.libraryId, {
      assetIds: [secondAssetId],
      skipStaleRepair: true,
    })).toBe(1);
    expect(isQueuePaused(service, firstLibrary.libraryId)).toBe(true);
    expect(isQueuePaused(service, secondLibrary.libraryId)).toBe(false);

    expect(service.resumeMediaJobs(firstLibrary.libraryId)).toEqual({ resumedCount: 0 });
    expect(service.enqueueThumbnailJobs(firstLibrary.libraryId, {
      assetIds: [firstAssetId],
      skipStaleRepair: true,
    })).toBe(1);
  });

  it('allows exact explicit admission, selected resume, and selected retry without resuming the library', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Explicit media queue work',
      selectedParentPath: root,
    });
    const firstAssetId = createImageAsset(service, library.libraryId, root, 'resume-image');
    const retryAssetId = createImageAsset(service, library.libraryId, root, 'retry-image');
    const explicitAssetId = createImageAsset(service, library.libraryId, root, 'explicit-image');

    expect(service.enqueueThumbnailJobs(library.libraryId, {
      assetIds: [firstAssetId, retryAssetId],
      skipStaleRepair: true,
    })).toBe(2);
    const firstJob = thumbnailJob(service, library.libraryId, firstAssetId)!;
    const retryJob = thumbnailJob(service, library.libraryId, retryAssetId)!;
    const db = databaseFor(library.libraryPath);
    db.prepare("UPDATE jobs SET status = 'failed', error_code = 'TEST_FAILURE' WHERE job_id = ?")
      .run(retryJob.jobId);
    db.close();

    expect(service.pauseMediaJobs(library.libraryId)).toEqual({ pausedCount: 1 });
    expect(isQueuePaused(service, library.libraryId)).toBe(true);
    expect(thumbnailJob(service, library.libraryId, firstAssetId)?.status).toBe('paused');
    expect(thumbnailJob(service, library.libraryId, retryAssetId)?.status).toBe('failed');
    expect(await service.processThumbnailQueue(library.libraryId, {
      maxJobs: 1,
      jobKinds: ['generate_thumbnail'],
    })).toBe(0);

    expect(service.enqueueThumbnailJobs(library.libraryId, {
      assetIds: [explicitAssetId],
      skipStaleRepair: true,
    })).toBe(0);
    expect(enqueueExplicitThumbnail(service, library.libraryId, explicitAssetId)).toBe(1);
    const explicitJob = thumbnailJob(service, library.libraryId, explicitAssetId)!;
    expect(jobAdmissionOrigin(library.libraryPath, explicitJob.jobId)).toBe('explicit');
    expect(await service.processThumbnailQueue(library.libraryId, {
      maxJobs: 1,
      jobKinds: ['generate_thumbnail'],
      assetIds: [explicitAssetId],
    })).toBe(1);
    expect(thumbnailJob(service, library.libraryId, explicitAssetId)?.status).toBe('succeeded');
    expect(jobAdmissionOrigin(library.libraryPath, explicitJob.jobId)).toBe('automatic');
    expect(thumbnailJob(service, library.libraryId, firstAssetId)?.status).toBe('paused');
    expect(isQueuePaused(service, library.libraryId)).toBe(true);

    expect(service.resumeMediaJobs(library.libraryId, [firstJob.jobId])).toEqual({ resumedCount: 1 });
    expect(jobAdmissionOrigin(library.libraryPath, firstJob.jobId)).toBe('explicit');
    expect(await service.processThumbnailQueue(library.libraryId, {
      maxJobs: 1,
      jobKinds: ['generate_thumbnail'],
      assetIds: [firstAssetId],
    })).toBe(1);
    expect(thumbnailJob(service, library.libraryId, firstAssetId)?.status).toBe('succeeded');
    expect(thumbnailJob(service, library.libraryId, retryAssetId)?.status).toBe('failed');

    expect(service.retryMediaJobs(library.libraryId, [retryJob.jobId])).toEqual({ retriedCount: 1 });
    expect(jobAdmissionOrigin(library.libraryPath, retryJob.jobId)).toBe('explicit');
    expect(await service.processThumbnailQueue(library.libraryId, {
      maxJobs: 1,
      jobKinds: ['generate_thumbnail'],
      assetIds: [retryAssetId],
    })).toBe(1);
    expect(thumbnailJob(service, library.libraryId, retryAssetId)?.status).toBe('succeeded');
    expect(isQueuePaused(service, library.libraryId)).toBe(true);
    expect(service.listMediaJobs(library.libraryId, { summaryOnly: true }).queued).toBe(0);
  });

  it('keeps an explicit pump bounded to grants even when automatic work is enabled', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'Explicit pump scope', selectedParentPath: root });
    const automaticId = createImageAsset(service, library.libraryId, root, 'ordinary-backlog');
    const explicitId = createImageAsset(service, library.libraryId, root, 'exact-retry');
    service.enqueueThumbnailJobs(library.libraryId, { assetIds: [automaticId], skipStaleRepair: true });
    enqueueExplicitThumbnail(service, library.libraryId, explicitId);
    expect(await service.processThumbnailQueue(library.libraryId, {
      maxJobs: 10, jobKinds: ['generate_thumbnail'], origin: 'explicit',
    })).toBe(1);
    expect(thumbnailJob(service, library.libraryId, explicitId)?.status).toBe('succeeded');
    expect(thumbnailJob(service, library.libraryId, automaticId)?.status).toBe('queued');
    expect(isQueuePaused(service, library.libraryId)).toBe(false);
  });

  it('retries only the current revision when an older paused job exists', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'Current revision retry', selectedParentPath: root });
    const assetId = createImageAsset(service, library.libraryId, root, 'revision-retry');
    service.enqueueThumbnailJobs(library.libraryId, { assetIds: [assetId], skipStaleRepair: true });
    const oldJob = thumbnailJob(service, library.libraryId, assetId)!;
    service.pauseMediaJobs(library.libraryId);
    const db = databaseFor(library.libraryPath);
    try {
      db.prepare(`INSERT INTO revisions
        (revision_id, asset_id, parent_revision_id, byte_size, modified_at, original_filename, origin, accepted_at)
        SELECT 'current-revision-fixture', asset_id, revision_id, byte_size, modified_at, original_filename, 'replace', accepted_at
          FROM revisions WHERE revision_id = ?`).run(oldJob.revisionId);
      db.prepare('UPDATE assets SET current_revision_id = ? WHERE asset_id = ?')
        .run('current-revision-fixture', assetId);
    } finally { db.close(); }
    expect(service.enqueueThumbnailJobs(library.libraryId, {
      assetIds: [assetId], origin: 'explicit', skipStaleRepair: true, limit: 0,
    })).toBe(0);
    expect(jobAdmissionOrigin(library.libraryPath, oldJob.jobId)).toBe('automatic');
    const retryJobId = service.enqueueArtifactRetry({ libraryId: library.libraryId, assetId, kind: 'thumbnail' });
    expect(retryJobId).not.toBe(oldJob.jobId);
    expect(jobAdmissionOrigin(library.libraryPath, oldJob.jobId)).toBe('automatic');
    expect(await service.processThumbnailQueue(library.libraryId, {
      maxJobs: 10, jobKinds: ['generate_thumbnail'], origin: 'explicit',
    })).toBe(1);
    const jobs = service.listMediaJobs(library.libraryId).jobs;
    expect(jobs.find(job => job.jobId === retryJobId)).toMatchObject({
      revisionId: 'current-revision-fixture', status: 'succeeded',
    });
    expect(jobs.find(job => job.jobId === oldJob.jobId)?.status).toBe('paused');
    expect(isQueuePaused(service, library.libraryId)).toBe(true);
  });

  it('rejects late automatic SQL admission and requeue even if a producer bypasses the service guard', () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'SQL pause boundary', selectedParentPath: root });
    const assetId = createImageAsset(service, library.libraryId, root, 'sql-policy');
    service.enqueueThumbnailJobs(library.libraryId, { assetIds: [assetId], skipStaleRepair: true });
    const job = thumbnailJob(service, library.libraryId, assetId)!;
    service.pauseMediaJobs(library.libraryId);
    const db = databaseFor(library.libraryPath);
    try {
      const inserted = db.prepare(
        `INSERT INTO jobs
          (job_id, library_id, asset_id, revision_id, kind, status, priority, progress, attempt_count, created_at, updated_at)
         SELECT 'late-automatic-fixture', library_id, asset_id, revision_id, kind, 'queued', 0, 0, 0, created_at, updated_at
           FROM jobs WHERE job_id = ?`,
      ).run(job.jobId) as { changes: number };
      expect(inserted.changes).toBe(0);
      const requeued = db.prepare("UPDATE jobs SET status = 'queued' WHERE job_id = ?")
        .run(job.jobId) as { changes: number };
      expect(requeued.changes).toBe(0);
      expect(thumbnailJob(service, library.libraryId, assetId)?.status).toBe('paused');
      expect(service.listMediaJobs(library.libraryId, { summaryOnly: true }).queued).toBe(0);
    } finally { db.close(); }
  });

  it('rolls the mode back with the rows when a pause transaction fails', () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'Atomic pause rollback', selectedParentPath: root });
    const assetId = createImageAsset(service, library.libraryId, root, 'rollback-policy');
    service.enqueueThumbnailJobs(library.libraryId, { assetIds: [assetId], skipStaleRepair: true });
    const db = databaseFor(library.libraryPath);
    try {
      db.prepare(`CREATE TRIGGER reject_pause_fixture BEFORE UPDATE OF status ON jobs
        WHEN NEW.status = 'paused' BEGIN SELECT RAISE(ABORT, 'pause-rejected'); END`).run();
      expect(() => service.pauseMediaJobs(library.libraryId)).toThrow('pause-rejected');
      expect(isQueuePaused(service, library.libraryId)).toBe(false);
      expect(thumbnailJob(service, library.libraryId, assetId)?.status).toBe('queued');
      expect((db.prepare('SELECT media_queue_paused AS paused FROM library').get() as { paused: number }).paused)
        .toBe(0);
    } finally { db.close(); }
  });

  it('aborts an active automatic render and keeps its late completion paused', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Pause active model render',
      selectedParentPath: root,
    });
    const modelPath = fileURLToPath(new URL('../fixtures/models/cube.obj', import.meta.url));
    const imported = importNoConflict(service, library.libraryId, modelPath);
    const assetId = imported.assets[0]!.assetId;
    expect(service.enqueueThumbnailJobs(library.libraryId, {
      assetIds: [assetId],
      skipStaleRepair: true,
    })).toBe(1);
    const job = thumbnailJob(service, library.libraryId, assetId)!;

    let releaseRender!: () => void;
    const renderGate = new Promise<void>((resolve) => { releaseRender = resolve; });
    let notifyStarted!: () => void;
    const rendererStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
    let renderSignal!: AbortSignal;
    const processing = service.processThumbnailQueue(library.libraryId, {
      maxJobs: 1,
      jobKinds: ['generate_thumbnail'],
      assetIds: [assetId],
      modelThumbnailRenderer: async (input) => {
        renderSignal = input.signal;
        notifyStarted();
        await renderGate;
        return { status: 'ok', pngBytes: VALID_1X1_PNG, width: 1, height: 1 };
      },
    });

    await rendererStarted;
    expect(service.listMediaJobs(library.libraryId).jobs.find((item) => item.jobId === job.jobId)?.status)
      .toBe('running');
    expect(service.pauseMediaJobs(library.libraryId)).toEqual({ pausedCount: 1 });
    expect(renderSignal.aborted).toBe(true);
    expect(service.listMediaJobs(library.libraryId).jobs.find((item) => item.jobId === job.jobId)?.status)
      .toBe('paused');

    releaseRender();
    await processing;

    expect(service.listMediaJobs(library.libraryId).jobs.find((item) => item.jobId === job.jobId)?.status)
      .toBe('paused');
    expect(service.getCurrentArtifact(library.libraryId, assetId, 'thumbnail')).toBeNull();
    expect(isQueuePaused(service, library.libraryId)).toBe(true);
  });

  it('runs an explicit proxy retry while paused, then blocks background retry after failure', async () => {
    const root = temporaryRoot();
    const spawnCalls: string[] = [];
    const service = newService({
      mediaComponentProbe: () => true,
      spawnFn: async (command) => {
        spawnCalls.push(command);
        return { stdout: Buffer.alloc(0), stderr: 'synthetic media failure', exitCode: 1 };
      },
    });
    const library = service.createLibrary({
      displayName: 'Explicit proxy retry during pause',
      selectedParentPath: root,
    });
    const videoPath = path.join(root, 'explicit-proxy.mp4');
    writeFileSync(videoPath, Buffer.alloc(1024));
    const imported = importNoConflict(service, library.libraryId, videoPath);
    const assetId = imported.assets[0]!.assetId;

    expect(service.pauseMediaJobs(library.libraryId)).toEqual({ pausedCount: 0 });
    const jobId = service.enqueueArtifactRetry({
      libraryId: library.libraryId,
      assetId,
      kind: 'webm_proxy',
    });
    expect(jobAdmissionOrigin(library.libraryPath, jobId)).toBe('explicit');
    expect(await service.processThumbnailQueue(library.libraryId, {
      maxJobs: 1,
      jobKinds: ['generate_webm_proxy'],
      assetIds: [assetId],
    })).toBe(1);
    expect(spawnCalls.length).toBeGreaterThan(0);

    const proxyJob = service.listMediaJobs(library.libraryId).jobs.find((job) => job.jobId === jobId);
    expect(proxyJob?.status).toBe('failed');
    expect(isQueuePaused(service, library.libraryId)).toBe(true);
    expect(service.enqueueThumbnailJobs(library.libraryId, {
      assetIds: [assetId],
      retryFailed: true,
      skipStaleRepair: true,
    })).toBe(0);
    expect(await service.processThumbnailQueue(library.libraryId, {
      maxJobs: 1,
      jobKinds: ['generate_webm_proxy'],
      assetIds: [assetId],
    })).toBe(0);
    expect(service.listMediaJobs(library.libraryId).jobs.find((job) => job.jobId === jobId)?.status)
      .toBe('failed');
    expect(isQueuePaused(service, library.libraryId)).toBe(true);
  });
});
