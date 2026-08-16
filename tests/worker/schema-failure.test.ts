// Serpent-verg.5 — migration failure diagnosis and retry (0031 §2.2):
// a rolled-back migration failure is recorded to .serpent/migration-failed.json,
// retried on the next open, capped at MAX_MIGRATION_ATTEMPTS, and then the
// library opens read-only (lenient read) instead of failing forever.
// verifyMigrationHistory failures stay LIBRARY_CORRUPT and are never recorded.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService, MIGRATIONS, SUPPORTED_SCHEMA_VERSION } from '../../src/worker/library-service';
import {
  clearMigrationFailure,
  MAX_MIGRATION_ATTEMPTS,
  migrationFailurePath,
  readMigrationFailure,
  recordMigrationFailure,
} from '../../src/worker/schema-failure';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
  };
}

const Database = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-schema-failure-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function libraryFilePath(libraryPath: string): string {
  return path.join(libraryPath, '.serpent', 'library.db');
}

/** Build a real v23 library (the first outer-transaction migration boundary). */
function buildV23Library(root: string): string {
  const libraryPath = path.join(root, 'v23');
  mkdirSync(path.join(libraryPath, '.serpent'), { recursive: true });
  mkdirSync(path.join(libraryPath, 'Assets'), { recursive: true });
  const db = new Database(libraryFilePath(libraryPath));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.exec(
    MIGRATIONS.slice(0, 23)
      .map((migration) => migration.sql)
      .join('\n'),
  );
  for (const migration of MIGRATIONS.slice(0, 23)) {
    db.prepare(
      'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
    ).run(migration.version, migration.checksum, new Date().toISOString());
  }
  db.prepare(
    'INSERT INTO library (library_id, display_name, created_at) VALUES (?, ?, ?)',
  ).run('lib_v23', 'v23', new Date().toISOString());
  db.pragma('user_version = 23');
  db.close();
  return libraryPath;
}

describe('migration failure record (unit)', () => {
  it('records, reads, increments and clears', () => {
    const root = temporaryRoot();
    const libraryPath = path.join(root, 'lib');
    mkdirSync(path.join(libraryPath, '.serpent'), { recursive: true });

    expect(readMigrationFailure(libraryPath)).toBeNull();

    const first = recordMigrationFailure(libraryPath, 23, 24, 'LIBRARY_MIGRATION_FAILED');
    expect(first.attempts).toBe(1);
    expect(first.fromVersion).toBe(23);
    expect(existsSync(migrationFailurePath(libraryPath))).toBe(true);

    const second = recordMigrationFailure(libraryPath, 23, 24, 'LIBRARY_MIGRATION_FAILED');
    expect(second.attempts).toBe(2);

    expect(readMigrationFailure(libraryPath)?.attempts).toBe(2);
    clearMigrationFailure(libraryPath);
    expect(existsSync(migrationFailurePath(libraryPath))).toBe(false);
    expect(readMigrationFailure(libraryPath)).toBeNull();
  });

  it('treats a corrupt record file as no record', () => {
    const root = temporaryRoot();
    const libraryPath = path.join(root, 'lib');
    mkdirSync(path.join(libraryPath, '.serpent'), { recursive: true });
    writeFileSync(migrationFailurePath(libraryPath), 'not json');
    expect(readMigrationFailure(libraryPath)).toBeNull();
  });

  it('caps retries at MAX_MIGRATION_ATTEMPTS', () => {
    expect(MAX_MIGRATION_ATTEMPTS).toBe(3);
  });
});

describe('migration failure integration (Serpent-verg.5)', () => {
  it('records the failure on open and retries up to the cap, then opens read-only', () => {
    const root = temporaryRoot();
    const libraryPath = buildV23Library(root);

    // Three failing opens (injected at the v23+ outer-transaction boundary).
    for (let attempt = 1; attempt <= MAX_MIGRATION_ATTEMPTS; attempt += 1) {
      const failing = new LibraryService({
        afterSchemaMigrationTransactionBegin: () => {
          throw new Error('injected migration failure');
        },
      });
      expect(() => failing.openLibrary(libraryPath)).toThrow();
      failing.closeAll();
      expect(readMigrationFailure(libraryPath)?.attempts).toBe(attempt);
      expect(readMigrationFailure(libraryPath)?.fromVersion).toBe(23);
    }

    // Fourth open: no more retries — the library opens read-only (lenient
    // read) instead of throwing, and the summary carries the stuck marker so
    // the renderer banner can distinguish it from a newer-schema library.
    const stuck = new LibraryService();
    const summary = stuck.openLibrary(libraryPath);
    expect(summary.readOnly).toBe(true);
    expect(summary.migrationStuck).toBe(true);
    const browse = stuck.listAssets({ libraryId: summary.libraryId, recursive: true });
    expect(browse).toEqual([]);
    stuck.closeAll();
  });

  it('an upgraded build retries a stuck library instead of staying latched', () => {
    const root = temporaryRoot();
    const libraryPath = buildV23Library(root);

    // Three failing opens latch the library under the current build.
    for (let attempt = 1; attempt <= MAX_MIGRATION_ATTEMPTS; attempt += 1) {
      const failing = new LibraryService({
        afterSchemaMigrationTransactionBegin: () => {
          throw new Error('injected migration failure');
        },
      });
      expect(() => failing.openLibrary(libraryPath)).toThrow();
      failing.closeAll();
    }
    const latched = new LibraryService();
    expect(latched.openLibrary(libraryPath).readOnly).toBe(true);
    latched.closeAll();

    // A newer build (supported schema bumped) must not honour the old
    // build's latch: the migration is retried and succeeds.
    const record = readMigrationFailure(libraryPath)!;
    writeFileSync(
      migrationFailurePath(libraryPath),
      JSON.stringify({ ...record, supportedSchemaVersion: SUPPORTED_SCHEMA_VERSION - 1 }),
    );
    const upgraded = new LibraryService();
    const summary = upgraded.openLibrary(libraryPath);
    expect(summary.readOnly === true).toBe(false);
    expect(existsSync(migrationFailurePath(libraryPath))).toBe(false);
    upgraded.closeAll();
  });

  it('a successful migration clears the failure record', () => {
    const root = temporaryRoot();
    const libraryPath = buildV23Library(root);

    const failing = new LibraryService({
      afterSchemaMigrationTransactionBegin: () => {
        throw new Error('injected migration failure');
      },
    });
    expect(() => failing.openLibrary(libraryPath)).toThrow();
    failing.closeAll();
    expect(readMigrationFailure(libraryPath)?.attempts).toBe(1);

    // Without the injection the migration succeeds and clears the record.
    const retry = new LibraryService();
    const summary = retry.openLibrary(libraryPath);
    expect(summary.readOnly === true).toBe(false);
    expect(existsSync(migrationFailurePath(libraryPath))).toBe(false);
    retry.closeAll();
  });

  it('opens verifyMigrationHistory damage read-only without recording a retry latch', () => {
    const root = temporaryRoot();
    const libraryPath = buildV23Library(root);
    // Corrupt the checksum history so the pre-migration verification fails.
    const db = new Database(libraryFilePath(libraryPath));
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 23')
      .run('x'.repeat(64));
    db.close();

    const service = new LibraryService();
    expect(service.openLibrary(libraryPath).recovery).toMatchObject({ mode: 'read-only' });
    service.closeAll();
    expect(existsSync(migrationFailurePath(libraryPath))).toBe(false);
  });
});
