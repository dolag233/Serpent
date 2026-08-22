import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
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

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
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
}

function buildLinkedFixture(name: string): IgnoreFixture {
  const root = mkdtempSync(path.join(tmpdir(), `serpent-ignore-${name}-`));
  roots.push(root);
  const sourceDir = path.join(root, 'link-source');
  const nestedDir = path.join(sourceDir, 'sub');
  mkdirSync(nestedDir, { recursive: true });
  writeFileSync(path.join(sourceDir, 'root.png'), VALID_PNG);
  writeFileSync(path.join(nestedDir, 'nested.png'), VALID_PNG);

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
  return {
    service,
    created,
    linkedFolderId: linked.folderId,
    rootAssetId: rootAsset.assetId,
    nestedAssetId: nestedAsset.assetId,
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
    await fixture.service.processThumbnailQueue(fixture.created.libraryId, { maxJobs: 5 });

    openLibraryDb(fixture.created.libraryPath, (db) => {
      const job = db.prepare(
        "SELECT status, error_code FROM jobs WHERE asset_id = ? AND kind = 'generate_thumbnail'",
      ).get(fixture.nestedAssetId) as { status?: string; error_code?: string | null };
      expect(job.status).toBe('cancelled');
      expect(job.error_code).toBe('ASSET_IGNORED');
    });
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
});
