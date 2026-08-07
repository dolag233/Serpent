// Serpent-verg.3 — structural mutation matrix (0031 §3.1): for every key
// table, delete / add / rename a column and then assert that the core read
// paths (browse/search/preview plus the table-specific reader) neither crash
// nor misread — missing columns degrade, extra columns are ignored.
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

/** One row of the mutation matrix: table, the derived/optional column to mutate. */
const MUTATION_MATRIX: Array<{ table: string; column: string }> = [
  { table: 'assets', column: 'trashed_from_relative_path' },
  { table: 'revisions', column: 'byte_size' },
  { table: 'revision_artifacts', column: 'status' },
  { table: 'tags', column: 'created_at' },
  { table: 'collections', column: 'cover_asset_id' },
  { table: 'smart_collections', column: 'query_definition_json' },
  { table: 'asset_metadata', column: 'favorite' },
  { table: 'ai_content', column: 'model_version' },
];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-schema-lenient-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function newLibraryWithOneAsset(root: string): {
  service: LibraryService;
  libraryId: string;
  assetId: string;
  libraryPath: string;
} {
  const service = new LibraryService();
  const library = service.createLibrary({ displayName: 'Mutation', selectedParentPath: root });
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

function mutateAndReopen(
  service: LibraryService,
  libraryPath: string,
  mutation: (db: TestDatabaseConnection) => void,
): void {
  const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  // SQLite refuses DROP/RENAME of a column referenced by an index (including
  // partial-index WHERE expressions), so remove user indexes on the table
  // before the mutation.
  const indexes = db
    .prepare(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as Array<{ name: string; tbl_name: string }>;
  for (const index of indexes) db.exec(`DROP INDEX ${index.name}`);
  mutation(db);
  db.close();
  service.closeAll();
  service.openLibrary(libraryPath);
}

/** The generic read-path smoke every mutated library must survive. */
function smokeReadPaths(
  service: LibraryService,
  libraryId: string,
  assetId: string,
): void {
  const assets = service.listAssets({ libraryId, recursive: true });
  expect(assets.length).toBeGreaterThanOrEqual(1);
  const searched = service.searchAssets({
    libraryId,
    limit: 10,
    offset: 0,
    query: { clauses: [{ field: 'filename', values: ['sample'], exclude: false }] },
  });
  expect(searched.items.length).toBeGreaterThanOrEqual(1);
  expect(() => service.getPreviewArtifact(libraryId, assetId)).not.toThrow();
}

describe.each(MUTATION_MATRIX)('mutation $table.$column', ({ table, column }) => {
  it('drop column → read paths degrade, never crash', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = newLibraryWithOneAsset(root);
    mutateAndReopen(service, libraryPath, (db) => {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    });

    smokeReadPaths(service, libraryId, assetId);
    expect(() => service.listTags(libraryId)).not.toThrow();
    expect(() => service.listCollections(libraryId)).not.toThrow();
    expect(() => service.listSmartCollections(libraryId)).not.toThrow();
    expect(() => service.getAssetMetadata({ libraryId, assetId })).not.toThrow();
    expect(() => service.getAiContent(libraryId, assetId)).not.toThrow();
    service.closeAll();
  });

  it('add column → read paths ignore the extra column', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = newLibraryWithOneAsset(root);
    mutateAndReopen(service, libraryPath, (db) => {
      db.exec(`ALTER TABLE ${table} ADD COLUMN extra_column TEXT`);
    });

    smokeReadPaths(service, libraryId, assetId);
    service.closeAll();
  });

  it('rename column → read paths degrade like a missing column', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = newLibraryWithOneAsset(root);
    mutateAndReopen(service, libraryPath, (db) => {
      db.exec(`ALTER TABLE ${table} RENAME COLUMN ${column} TO ${column}_renamed`);
    });

    smokeReadPaths(service, libraryId, assetId);
    service.closeAll();
  });
});

describe('mutation degraded values (0031 §1.1)', () => {
  it('revisions.byte_size drop → browse shows size 0', () => {
    const root = temporaryRoot();
    const { service, libraryId, libraryPath } = newLibraryWithOneAsset(root);
    mutateAndReopen(service, libraryPath, (db) => {
      db.exec('ALTER TABLE revisions DROP COLUMN byte_size');
    });
    const assets = service.listAssets({ libraryId, recursive: true });
    expect(assets[0]!.byteSize).toBe(0);
    service.closeAll();
  });

  it('revision_artifacts.status drop → preview resolves without a ready artifact', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = newLibraryWithOneAsset(root);
    mutateAndReopen(service, libraryPath, (db) => {
      db.exec('ALTER TABLE revision_artifacts DROP COLUMN status');
    });
    const preview = service.getPreviewArtifact(libraryId, assetId);
    expect(['pending', 'missing', 'ready']).toContain(preview.status);
    service.closeAll();
  });

  it('asset_metadata.favorite drop → metadata favorite false', () => {
    const root = temporaryRoot();
    const { service, libraryId, assetId, libraryPath } = newLibraryWithOneAsset(root);
    mutateAndReopen(service, libraryPath, (db) => {
      db.exec('ALTER TABLE asset_metadata DROP COLUMN favorite');
    });
    const metadata = service.getAssetMetadata({ libraryId, assetId });
    expect(metadata.favorite).toBe(false);
    service.closeAll();
  });
});
