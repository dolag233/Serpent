// Serpent-verg.2: inspector-side read paths (tags/collections/metadata/AI
// content) must keep working on an older library whose tables or columns are
// missing — degraded to empty/default shapes instead of failing (0031 §1).
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
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-lenient-inspector-'));
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
  libraryPath: string;
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
    libraryPath: library.libraryPath,
  };
}

function dropTables(dbPath: string, tables: string[]): void {
  const db = new TestDatabase(dbPath);
  for (const table of tables) db.exec(`DROP TABLE ${table}`);
  db.close();
}

function dropColumns(dbPath: string, table: string, columns: string[]): void {
  const db = new TestDatabase(dbPath);
  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'",
    )
    .all(table) as Array<{ name: string }>;
  for (const index of indexes) db.exec(`DROP INDEX ${index.name}`);
  for (const column of columns) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  db.close();
}

function reopenAfterMutating(
  service: LibraryService,
  libraryPath: string,
  mutate: (dbPath: string) => void,
): void {
  mutate(path.join(libraryPath, '.serpent', 'library.db'));
  service.closeAll();
  service.openLibrary(libraryPath);
}

describe('inspector read paths lenient read (Serpent-verg.2)', () => {
  it('tags and collections degrade to empty on pre-tag libraries', () => {
    const root = temporaryRoot();
    const { service, libraryId, libraryPath } = libraryWithOneAsset(root, 'InspectorNoTags');
    reopenAfterMutating(service, libraryPath, (dbPath) =>
      dropTables(dbPath, ['tags', 'human_asset_tags', 'ai_asset_tags', 'collections', 'collection_assets']),
    );

    expect(service.listTags(libraryId)).toEqual([]);
    expect(service.listCollections(libraryId)).toEqual([]);
    service.closeAll();
  });

  it('collections read with missing display columns', () => {
    const root = temporaryRoot();
    const { service, libraryId, libraryPath } = libraryWithOneAsset(root, 'InspectorNoDesc');
    reopenAfterMutating(service, libraryPath, (dbPath) =>
      dropColumns(dbPath, 'collections', ['description', 'cover_asset_id']),
    );

    const collections = service.listCollections(libraryId);
    expect(collections).toEqual([]);
    service.closeAll();
  });

  it('asset metadata degrades to the empty shape when the table is missing', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = libraryWithOneAsset(
      root,
      'InspectorNoMetadata',
    );
    reopenAfterMutating(service, libraryPath, (dbPath) =>
      dropTables(dbPath, ['asset_metadata']),
    );

    const metadata = service.getAssetMetadata({ libraryId, assetId });
    expect(metadata.assetId).toBe(assetId);
    expect(metadata.description).toBeNull();
    expect(metadata.rating).toBe(0);
    expect(metadata.favorite).toBe(false);
    expect(metadata.entityVersion).toBe(0);
    service.closeAll();
  });

  it('asset metadata degrades per missing column', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = libraryWithOneAsset(
      root,
      'InspectorPartialMetadata',
    );
    reopenAfterMutating(service, libraryPath, (dbPath) =>
      dropColumns(dbPath, 'asset_metadata', ['rating', 'favorite', 'entity_version']),
    );

    const metadata = service.getAssetMetadata({ libraryId, assetId });
    expect(metadata.rating).toBe(0);
    expect(metadata.favorite).toBe(false);
    expect(metadata.entityVersion).toBe(0);
    service.closeAll();
  });

  it('AI content degrades to empty when the table is missing', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = libraryWithOneAsset(
      root,
      'InspectorNoAi',
    );
    reopenAfterMutating(service, libraryPath, (dbPath) =>
      dropTables(dbPath, ['ai_content']),
    );

    expect(service.getAiContent(libraryId, assetId)).toEqual([]);
    service.closeAll();
  });
});
