// Serpent-verg.2: the browse main query (listAssets) must keep working on an
// older library whose whitelisted columns are missing — degraded defaults
// fill the result instead of the query failing (0031 §1).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): {
    get(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-lenient-listassets-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function libraryWithOneAsset(root: string, displayName: string): {
  service: LibraryService;
  libraryId: string;
  assetId: string;
  currentRevisionId: string;
  libraryPath: string;
  dbPath: string;
} {
  const service = new LibraryService();
  const library = service.createLibrary({ displayName, selectedParentPath: root });
  const fixture = path.join(root, 'sample.png');
  writeFileSync(fixture, VALID_1X1_PNG);
  const imported = service.prepareOrExecuteImport({
    libraryId: library.libraryId,
    sourceKind: 'files',
    sourcePaths: [fixture],
  });
  if ('importId' in imported) throw new Error('unexpected conflict plan');
  const asset = imported.assets[0]!;
  return {
    service,
    libraryId: library.libraryId,
    assetId: asset.assetId,
    currentRevisionId: asset.currentRevisionId,
    libraryPath: library.libraryPath,
    dbPath: path.join(library.libraryPath, '.serpent', 'library.db'),
  };
}

/**
 * Simulate opening an older library: structurally mutate the DB out-of-band,
 * then close and reopen through the service so the column cache is built
 * from the degraded schema (matching the real "old library on disk" flow).
 */
function reopenAfterDroppingColumns(
  service: LibraryService,
  libraryPath: string,
  drops: Array<[string, string[]]>,
): void {
  dropColumns(path.join(libraryPath, '.serpent', 'library.db'), drops);
  service.closeAll();
  service.openLibrary(libraryPath);
}

/** Drop whitelisted columns to simulate an older library. */
function dropColumns(dbPath: string, drops: Array<[string, string[]]>): void {
  const db = new TestDatabase(dbPath);
  for (const [table, columns] of drops) {
    // SQLite refuses to drop a column referenced by an index (including
    // partial-index WHERE expressions that index_info does not list), so
    // remove every user index on the table first.
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
      )
      .all(table) as Array<{ name: string }>;
    for (const index of indexes) db.exec(`DROP INDEX ${index.name}`);
    for (const column of columns) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  db.close();
}

describe('listAssets lenient read (Serpent-verg.2)', () => {
  it('returns full fields on a current library (baseline)', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId } = libraryWithOneAsset(root, 'Baseline');
    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(1);
    const asset = assets[0]!;
    expect(asset.assetId).toBe(assetId);
    expect(asset.byteSize).toBeGreaterThan(0);
    expect(asset.displayName).toBe('sample.png');
    service.closeAll();
  });

  it('degrades instead of failing when optional columns are missing', () => {
    const root = temporaryRoot();
    const { service, libraryId, currentRevisionId, libraryPath } = libraryWithOneAsset(
      root,
      'Degraded',
    );
    // Fake an older library: drop the display/derived columns that
    // listAssets whitelists, then reopen so the column cache is built from
    // the degraded schema. (artifact_id is the table's primary key and is
    // always present, so it is not dropped.)
    reopenAfterDroppingColumns(service, libraryPath, [
      ['revision_artifacts', ['width', 'height', 'status']],
      ['asset_metadata', ['favorite']],
      ['revisions', ['byte_size', 'modified_at']],
      ['assets', ['trashed_from_relative_path']],
    ]);

    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(1);
    const asset = assets[0]!;
    // Core identity is intact.
    expect(asset.relativeFilePath).toBe('sample.png');
    expect(asset.currentRevisionId).toBe(currentRevisionId);
    // Degraded defaults: size/metadata/thumbnail not shown, not crashing.
    expect(asset.byteSize).toBe(0);
    expect(asset.favorite).toBe(false);
    expect(asset.thumbnailStatus).toBeNull();
    expect(asset.thumbnailArtifactId).toBeNull();
    service.closeAll();
  });

  it('still lists assets when rating and favorite are both missing', () => {
    const root = temporaryRoot();
    const { service, libraryId, libraryPath } = libraryWithOneAsset(root, 'NoRating');
    reopenAfterDroppingColumns(service, libraryPath, [
      ['asset_metadata', ['rating', 'favorite']],
    ]);

    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets).toHaveLength(1);
    expect(assets[0]!.rating).toBe(0);
    service.closeAll();
  });
});
