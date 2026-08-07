// Serpent-verg.6 — full version-chain compatibility (0031 §3):
//  • upgrade chain: every vN library (with seed data) migrates to latest
//    with the seed data intact (assets/revisions/tags/collections/metadata);
//  • downgrade chain: a latest library with seed data is structurally rewound
//    to each key version (v4/v21/v22/v23/v24/v25/v26/v27/v29/v32/v33) and
//    reopened — the current build must read it leniently and migrate it back
//    to latest without losing the seed data that survives the rewind.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService, MIGRATIONS, SUPPORTED_SCHEMA_VERSION } from '../../src/worker/library-service';
import { rewindSchema } from '../fixtures/schema/schema-regress';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown;
  };
}

const Database = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

const KEY_DOWNGRADE_VERSIONS = [4, 21, 22, 23, 24, 25, 26, 27, 29, 32, 33];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-downgrade-chain-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function libraryFilePath(libraryPath: string): string {
  return path.join(libraryPath, '.serpent', 'library.db');
}

/** Build a real vN library structure with the migrations up to N applied. */
function buildLibraryAtVersion(root: string, targetVersion: number): string {
  const libraryPath = path.join(root, `v${targetVersion}`);
  mkdirSync(path.join(libraryPath, '.serpent'), { recursive: true });
  mkdirSync(path.join(libraryPath, 'Assets'), { recursive: true });
  const db = new Database(libraryFilePath(libraryPath));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.exec(
    MIGRATIONS.slice(0, targetVersion)
      .map((migration) => migration.sql)
      .join('\n'),
  );
  for (const migration of MIGRATIONS.slice(0, targetVersion)) {
    db.prepare(
      'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
    ).run(migration.version, migration.checksum, new Date().toISOString());
  }
  db.prepare(
    'INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)',
  ).run(`lib_${targetVersion}`, `v${targetVersion}`, new Date().toISOString());
  db.pragma(`user_version = ${targetVersion}`);
  db.close();
  return libraryPath;
}

/** Insert a row using only the columns the table actually has. */
function insertAvailableColumns(
  db: TestDatabaseConnection,
  table: string,
  row: Record<string, unknown>,
): void {
  const columns = (db.pragma(`table_info(${table})`) as Array<{ name: string }>)
    .map((entry) => entry.name);
  const present = Object.entries(row).filter(([column]) => columns.includes(column));
  if (present.length === 0) return;
  const names = present.map(([column]) => column);
  const placeholders = present.map(() => '?');
  db.prepare(
    `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders.join(', ')})`,
  ).run(...present.map(([, value]) => value));
}

/** Seed a library with the compatibility-relevant rows the schema supports. */
function seedLibrary(
  dbPath: string,
  version: number,
  overrides: { assetId?: string; revisionId?: string; tagName?: string } = {},
): void {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = OFF');
  const libraryRow = db.prepare('SELECT library_id FROM library LIMIT 1').get() as {
    library_id: string;
  };
  const libraryId = libraryRow.library_id;
  const assetId = overrides.assetId ?? 'seed-asset-1';
  const revisionId = overrides.revisionId ?? 'seed-revision-1';
  const now = new Date().toISOString();
  if (version >= 2) {
    insertAvailableColumns(db, 'assets', {
      asset_id: assetId,
      location_kind: 'managed',
      managed_folder_id: null,
      linked_folder_id: null,
      relative_file_path: 'seed.png',
      current_revision_id: revisionId,
      availability: 'available',
      path_identity: 'seed.png',
      created_at: now,
      updated_at: now,
    });
    insertAvailableColumns(db, 'revisions', {
      revision_id: revisionId,
      asset_id: assetId,
      parent_revision_id: null,
      byte_size: 42,
      modified_at: now,
      original_filename: 'seed.png',
      origin: 'import',
      accepted_at: now,
    });
  }
  if (version >= 5) {
    insertAvailableColumns(db, 'tags', {
      tag_id: 'seed-tag',
      library_id: libraryId,
      name: overrides.tagName ?? 'seed-tag',
      created_at: now,
    });
    insertAvailableColumns(db, 'collections', {
      collection_id: 'seed-collection',
      library_id: libraryId,
      parent_id: null,
      name: 'Seed Collection',
      position: 0,
      created_at: now,
      updated_at: now,
    });
  }
  if (version >= 8) {
    insertAvailableColumns(db, 'asset_metadata', {
      asset_id: assetId,
      description: 'seed description',
      rating: 3,
      favorite: 1,
      entity_version: 1,
      updated_at: now,
    });
  }
  db.pragma('foreign_keys = ON');
  db.close();
}

/** Assert the seed rows that the given seedVersion supported survive the upgrade. */
function assertSeedSurvives(dbPath: string, seedVersion: number): void {
  const db = new Database(dbPath);
  const libraryRows = db.prepare('SELECT COUNT(*) AS n FROM library').get() as { n: number };
  expect(libraryRows.n).toBe(1);
  if (seedVersion >= 2) {
    const assetRows = db.prepare(
      "SELECT asset_id, relative_file_path FROM assets WHERE asset_id = 'seed-asset-1'",
    ).get() as { asset_id: string; relative_file_path: string } | undefined;
    expect(assetRows).toBeDefined();
    expect(assetRows!.relative_file_path).toBe('seed.png');
    const revisionRows = db.prepare(
      "SELECT revision_id FROM revisions WHERE revision_id = 'seed-revision-1'",
    ).get();
    expect(revisionRows).toBeDefined();
  }
  if (seedVersion >= 5) {
    const tagRows = db.prepare(
      "SELECT name FROM tags WHERE tag_id = 'seed-tag'",
    ).get() as { name: string } | undefined;
    expect(tagRows?.name).toBe('seed-tag');
    const collectionRows = db.prepare(
      "SELECT name FROM collections WHERE collection_id = 'seed-collection'",
    ).get() as { name: string } | undefined;
    expect(collectionRows?.name).toBe('Seed Collection');
  }
  if (seedVersion >= 8) {
    const metadata = db.prepare(
      "SELECT rating, favorite, description FROM asset_metadata WHERE asset_id = 'seed-asset-1'",
    ).get() as { rating: number; favorite: number; description: string } | undefined;
    expect(metadata?.rating).toBe(3);
    expect(metadata?.favorite).toBe(1);
    expect(metadata?.description).toBe('seed description');
  }
  db.close();
}

describe('upgrade chain (0031 §3.1)', () => {
  for (const migration of MIGRATIONS.slice(0, -1)) {
    it(`v${migration.version} seed data survives migration to v${SUPPORTED_SCHEMA_VERSION}`, () => {
      const root = temporaryRoot();
      const libraryPath = buildLibraryAtVersion(root, migration.version);
      seedLibrary(libraryFilePath(libraryPath), migration.version);

      const service = new LibraryService();
      service.openLibrary(libraryPath);
      service.closeAll();

      assertSeedSurvives(libraryFilePath(libraryPath), migration.version);
    });
  }
});

describe('downgrade chain (0031 §3.1)', () => {
  for (const targetVersion of KEY_DOWNGRADE_VERSIONS) {
    it(`v${SUPPORTED_SCHEMA_VERSION} seed rewound to v${targetVersion} migrates back intact`, () => {
      const root = temporaryRoot();
      const libraryPath = buildLibraryAtVersion(root, SUPPORTED_SCHEMA_VERSION);
      seedLibrary(libraryFilePath(libraryPath), SUPPORTED_SCHEMA_VERSION);

      const db = new Database(libraryFilePath(libraryPath));
      rewindSchema(db as never, MIGRATIONS, SUPPORTED_SCHEMA_VERSION, targetVersion);
      db.close();

      // The current build must open the rewound library (lenient read) and
      // migrate it back to latest.
      const service = new LibraryService();
      service.openLibrary(libraryPath);
      service.closeAll();

      // Table-rebuild boundaries (v4) drop the rebuilt table's rows by
      // definition; for every other key version the seed survives intact.
      if (targetVersion >= 21) {
        assertSeedSurvives(libraryFilePath(libraryPath), SUPPORTED_SCHEMA_VERSION);
      } else {
        const check = new Database(libraryFilePath(libraryPath));
        const libraryRows = check.prepare('SELECT COUNT(*) AS n FROM library').get() as { n: number };
        expect(libraryRows.n).toBe(1);
        check.close();
      }
    });
  }
});
