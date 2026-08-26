import { lstatSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];
const services: LibraryService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

// Keep the image outside the source-direct policy: this suite verifies that
// ignored folders suppress the derived-thumbnail queue.
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAACAEAAAABCAIAAAAqtLKbAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAOklEQVRYhe3YQQ0AAAgDMeRMImInBh+kySno8yZbESBAgAABAgQIECBAgAABAgQIECBAgAABAnk3zA9mXOIiDxU7WQAAAABJRU5ErkJggg==',
  'base64',
);

interface TestDbHandle {
  prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown };
  close(): void;
}

function openLibraryDb<T>(libraryPath: string, fn: (db: TestDbHandle) => T): T {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as new (filename: string) => TestDbHandle;
  const db = new Database(path.join(libraryPath, '.serpent', 'library.db'));
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

interface IgnoreFixture {
  service: LibraryService;
  created: { libraryId: string; libraryPath: string };
  linkedFolderId: string;
  rootAssetId: string;
  nestedAssetId: string;
  nestedVideoAssetId: string;
}

function buildLinkedFixture(name: string): IgnoreFixture {
  const root = mkdtempSync(path.join(tmpdir(), `serpent-ignore-${name}-`));
  roots.push(root);
  const sourceDir = path.join(root, 'link-source');
  const nestedDir = path.join(sourceDir, 'sub');
  mkdirSync(nestedDir, { recursive: true });
  writeFileSync(path.join(sourceDir, 'root.png'), VALID_PNG);
  writeFileSync(path.join(nestedDir, 'nested.png'), VALID_PNG);
  // The bytes do not need to decode for queue admission; the extension is
  // enough to exercise the video metadata scheduling path.
  writeFileSync(path.join(nestedDir, 'nested.mp4'), Buffer.from('test-video'));

  const service = new LibraryService();
  services.push(service);
  const created = service.createLibrary({ displayName: `Ignore ${name}`, selectedParentPath: root });
  const linked = service.importFolderAsLinked({
    libraryId: created.libraryId,
    sourceRootPath: sourceDir,
  });
  const assets = service.listAssets({
    libraryId: created.libraryId,
    folderId: linked.folderId,
    recursive: true,
  });
  const rootAsset = assets.find((a) => !a.relativeFilePath.replace(/\\/g, '/').includes('sub/'))!;
  const nestedAsset = assets.find((a) => a.relativeFilePath.replace(/\\/g, '/').includes('sub/'))!;
  const nestedVideoAsset = assets.find((a) => a.relativeFilePath.replace(/\\/g, '/') === 'sub/nested.mp4')!;
  return {
    service,
    created,
    linkedFolderId: linked.folderId,
    rootAssetId: rootAsset.assetId,
    nestedAssetId: nestedAsset.assetId,
    nestedVideoAssetId: nestedVideoAsset.assetId,
  };
}

function setFolderIgnored(fixture: IgnoreFixture, ignored: boolean): void {
  openLibraryDb(fixture.created.libraryPath, (db) => {
    if (ignored) {
      db.prepare(
        `INSERT INTO explicit_ignored_paths
           (location_kind, linked_folder_id, relative_path, path_kind, ignored_at)
         VALUES ('linked', ?, 'sub', 'folder', ?)`,
      ).run(fixture.linkedFolderId, new Date().toISOString());
    } else {
      db.prepare(
        "DELETE FROM explicit_ignored_paths WHERE location_kind = 'linked' AND linked_folder_id = ? AND relative_path = 'sub' AND path_kind = 'folder'",
      ).run(fixture.linkedFolderId);
    }
  });
}

function queuedCountFor(fixture: IgnoreFixture, assetId: string): number {
  return openLibraryDb(fixture.created.libraryPath, (db) => {
    const row = db.prepare(
      "SELECT COUNT(*) n FROM jobs WHERE asset_id = ? AND kind = 'generate_thumbnail' AND status = 'queued'",
    ).get(assetId) as { n: number };
    return row.n;
  });
}

/**
 * Serpent-4bc4ac: background media scheduling must respect ignore rules.
 * Before this fix, hidden folders kept generating/running thumbnail jobs and
 * resolveAssetPath threw ASSET_NOT_FOUND for them, looping failed→repair
 * forever (28k+ failed rows on a converted library).
 */
describe('media scheduling respects ignore rules', () => {
  it('does not enqueue thumbnails for ignored folders until un-ignored', () => {
    const fixture = buildLinkedFixture('enqueue');
    setFolderIgnored(fixture, true);

    fixture.service.enqueueThumbnailJobs(fixture.created.libraryId, {
      assetIds: [fixture.rootAssetId, fixture.nestedAssetId],
    });

    expect(queuedCountFor(fixture, fixture.rootAssetId)).toBe(1);
    expect(queuedCountFor(fixture, fixture.nestedAssetId)).toBe(0);

    // Un-ignoring re-opens normal scheduling.
    setFolderIgnored(fixture, false);
    fixture.service.enqueueThumbnailJobs(fixture.created.libraryId, {
      assetIds: [fixture.nestedAssetId],
    });
    expect(queuedCountFor(fixture, fixture.nestedAssetId)).toBe(1);
  });

  it('cancels queued jobs of newly ignored assets instead of failing them', async () => {
    const fixture = buildLinkedFixture('cancel');
    fixture.service.enqueueThumbnailJobs(fixture.created.libraryId, {
      assetIds: [fixture.nestedAssetId],
    });
    expect(queuedCountFor(fixture, fixture.nestedAssetId)).toBe(1);

    setFolderIgnored(fixture, true);
    const hiddenJobs = fixture.service.listMediaJobs(fixture.created.libraryId);
    expect(hiddenJobs.jobs.some((job) => job.assetId === fixture.nestedAssetId)).toBe(false);
    expect(hiddenJobs.cancelled).toBe(0);
    await fixture.service.processThumbnailQueue(fixture.created.libraryId, { maxJobs: 5 });

    openLibraryDb(fixture.created.libraryPath, (db) => {
      const job = db.prepare(
        "SELECT status, error_code FROM jobs WHERE asset_id = ? AND kind = 'generate_thumbnail'",
      ).get(fixture.nestedAssetId) as { status?: string; error_code?: string | null };
      expect(job.status).toBe('cancelled');
      expect(job.error_code).toBe('ASSET_IGNORED');
    });
    const afterClaim = fixture.service.listMediaJobs(fixture.created.libraryId);
    expect(afterClaim.jobs.some((job) => job.assetId === fixture.nestedAssetId)).toBe(false);
    expect(afterClaim.cancelled).toBe(0);
  });

  it('filters ignored ids for visible-window reporting', () => {
    const fixture = buildLinkedFixture('visible');
    setFolderIgnored(fixture, true);
    const kept = fixture.service.filterIgnoredAssetIds(fixture.created.libraryId, [
      fixture.rootAssetId,
      fixture.nestedAssetId,
    ]);
    expect(kept).toEqual([fixture.rootAssetId]);
  });

  it('does not enqueue secondary video or AI work for ignored assets', () => {
    const fixture = buildLinkedFixture('secondary');
    setFolderIgnored(fixture, true);

    fixture.service.enqueueThumbnailJobs(fixture.created.libraryId, {
      assetIds: [fixture.nestedVideoAssetId],
    });
    fixture.service.enqueueAiAnalysisJobs({
      libraryId: fixture.created.libraryId,
      assetIds: [fixture.nestedVideoAssetId],
    });

    openLibraryDb(fixture.created.libraryPath, (db) => {
      const rows = db.prepare(
        `SELECT kind, status FROM jobs
           WHERE asset_id = ?
             AND kind IN ('generate_thumbnail', 'extract_metadata', 'extract_palette',
                          'ai.image.analysis', 'ai.video.analysis')`,
      ).all(fixture.nestedVideoAssetId) as Array<{ kind: string; status: string }>;
      expect(rows).toEqual([]);
    });
  });

  it('hides stale ignored AI rows from the task panel but keeps batch status addressable', () => {
    const fixture = buildLinkedFixture('ai-list');
    const queued = fixture.service.enqueueAiAnalysisJobs({
      libraryId: fixture.created.libraryId,
      assetIds: [fixture.nestedVideoAssetId],
    });
    expect(queued.jobIds).toHaveLength(1);

    setFolderIgnored(fixture, true);
    const panel = fixture.service.getAiJobStatus(fixture.created.libraryId);
    expect(panel.jobs.some((job) => job.assetId === fixture.nestedVideoAssetId)).toBe(false);
    expect(panel.queued).toBe(0);

    const batch = fixture.service.getAiJobStatus(
      fixture.created.libraryId,
      queued.jobIds,
    );
    expect(batch.jobs).toHaveLength(1);
    expect(batch.jobs[0]?.assetId).toBe(fixture.nestedVideoAssetId);
  });

  it('does not stat existing assets inside an ignored folder during open reconciliation', async () => {
    const fixture = buildLinkedFixture('open-skip');
    setFolderIgnored(fixture, true);
    fixture.service.closeAll();

    const statPaths: string[] = [];
    const reopenedService = new LibraryService({
      assetLstat: (assetPath) => {
        statPaths.push(assetPath);
        return lstatSync(assetPath);
      },
    });
    services.push(reopenedService);
    const reopened = reopenedService.openLibrary(fixture.created.libraryPath);
    await reopenedService.runOpenBackgroundReconciliation(reopened.libraryId);

    expect(statPaths.some((assetPath) => assetPath.endsWith('root.png'))).toBe(true);
    expect(statPaths.some((assetPath) => assetPath.endsWith('nested.png'))).toBe(false);
  });
});
