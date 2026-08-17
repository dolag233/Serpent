// Library availability is Serpent's hardest product baseline.
// A library must open, stay writable, and remain usable after close/reopen,
// schema skew, migration failure, and database damage. Desktop never presents
// a read-only library. `npm run test:library-availability` is the required
// gate for any library-related change.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { InternalLibrarySummary } from '../../src/shared/protocol/responses';
import {
  LibraryService,
  MIGRATIONS,
  SUPPORTED_SCHEMA_VERSION,
} from '../../src/worker/library-service';
import { MAX_MIGRATION_ATTEMPTS } from '../../src/worker/schema-failure';

interface TestDatabase {
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown;
  };
}

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as new (filename: string) => TestDatabase;

const temporaryRoots: string[] = [];
const services: LibraryService[] = [];

function newService(
  ...args: ConstructorParameters<typeof LibraryService>
): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-library-availability-'));
  temporaryRoots.push(root);
  return root;
}

function databaseFile(libraryPath: string): string {
  return path.join(libraryPath, '.serpent', 'library.db');
}

function backupFile(libraryPath: string, slot: 1 | 2): string {
  return path.join(libraryPath, '.serpent', 'backups', `library.db.${slot}`);
}

function assertUsable(
  service: LibraryService,
  summary: InternalLibrarySummary,
  displayName: string,
): void {
  expect(summary.readOnly, `${displayName} must not be read-only`).toBeFalsy();
  expect(summary.recovery?.mode, `${displayName} must not open as read-only recovery`)
    .not.toBe('read-only');
  service.renameLibrary({ libraryId: summary.libraryId, displayName });
  expect(
    service.listLibraries().some(
      (entry) => entry.libraryId === summary.libraryId && entry.displayName === displayName,
    ),
  ).toBe(true);
}

function buildLibraryAtVersion(root: string, targetVersion: number): string {
  const libraryPath = path.join(root, `v${targetVersion}`);
  mkdirSync(path.join(libraryPath, '.serpent'), { recursive: true });
  mkdirSync(path.join(libraryPath, 'Assets'), { recursive: true });
  const db = new Database(databaseFile(libraryPath));
  try {
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
  } finally {
    db.close();
  }
  return libraryPath;
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('library availability baseline', () => {
  it('requires FTS5 so creating a library cannot silently use a hijacked SQLite', () => {
    const db = new Database(':memory:');
    try {
      expect(() => db.exec('CREATE VIRTUAL TABLE availability_fts USING fts5(body)')).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('creates, closes, reopens, imports, and keeps writes after a full close', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: '可用性基线',
      selectedParentPath: root,
    });
    assertUsable(service, created, '可用性基线-已打开');

    const source = path.join(root, 'keep.png');
    writeFileSync(source, Buffer.from('availability-asset'));
    service.prepareOrExecuteImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    expect(service.listAssets({ libraryId: created.libraryId, recursive: true })).toHaveLength(1);
    service.closeAll();

    const reopened = service.openLibrary(created.libraryPath);
    expect(reopened.libraryId).toBe(created.libraryId);
    assertUsable(service, reopened, '可用性基线-重开');
    expect(service.listAssets({ libraryId: reopened.libraryId, recursive: true })).toHaveLength(1);
  });

  it('migrates an old v1 library to the current schema and leaves it writable', () => {
    const libraryPath = buildLibraryAtVersion(temporaryRoot(), 1);
    const service = newService();
    const opened = service.openLibrary(libraryPath);
    expect(opened.readOnly).toBeFalsy();
    assertUsable(service, opened, 'v1已升级可写');
    const db = new Database(databaseFile(libraryPath));
    expect(db.pragma('user_version', { simple: true })).toBe(SUPPORTED_SCHEMA_VERSION);
    db.close();
  });

  it('opens a newer-than-supported schema writable and never sets readOnly', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: '未来 schema',
      selectedParentPath: root,
    });
    service.closeAll();
    const db = new Database(databaseFile(created.libraryPath));
    db.pragma(`user_version = ${SUPPORTED_SCHEMA_VERSION + 1}`);
    db.prepare(
      'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
    ).run(SUPPORTED_SCHEMA_VERSION + 1, 'f'.repeat(64), new Date().toISOString());
    db.close();

    const opened = service.openLibrary(created.libraryPath);
    expect(opened.libraryVersion).toBe(SUPPORTED_SCHEMA_VERSION + 1);
    assertUsable(service, opened, '未来 schema 可写');
  });

  it('rewrites swapped v37/v38 history and opens the library writable', () => {
    const autoChecksum = MIGRATIONS.find((migration) => migration.version === 37)!.checksum;
    const syncChecksum = MIGRATIONS.find((migration) => migration.version === 38)!.checksum;
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: '分叉历史',
      selectedParentPath: root,
    });
    service.closeAll();

    const db = new Database(databaseFile(created.libraryPath));
    db.prepare('DELETE FROM schema_migrations WHERE version = 39').run();
    db.pragma('user_version = 38');
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 37').run(syncChecksum);
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 38').run(autoChecksum);
    db.close();

    const opened = service.openLibrary(created.libraryPath);
    expect(opened.recovery).toBeUndefined();
    assertUsable(service, opened, '分叉历史可写');
  });

  it('opens a stuck migration writable at the last good schema', () => {
    const libraryPath = buildLibraryAtVersion(temporaryRoot(), 23);
    for (let attempt = 1; attempt <= MAX_MIGRATION_ATTEMPTS; attempt += 1) {
      const failing = newService({
        afterSchemaMigrationTransactionBegin: () => {
          throw new Error('injected migration failure');
        },
      });
      expect(() => failing.openLibrary(libraryPath)).toThrow();
      failing.closeAll();
    }

    const stuck = newService();
    const opened = stuck.openLibrary(libraryPath);
    expect(opened.migrationStuck).toBe(true);
    assertUsable(stuck, opened, '粘滞后可写');
  });

  it('restores a damaged primary from backup and stays writable', async () => {
    const service = newService();
    const created = service.createLibrary({
      displayName: '备份恢复',
      selectedParentPath: temporaryRoot(),
    });
    expect(await service.createDatabaseBackup(created.libraryId)).toBe(true);
    service.closeAll();
    writeFileSync(databaseFile(created.libraryPath), 'not a sqlite database');

    const reopened = newService();
    const summary = reopened.openLibrary(created.libraryPath);
    expect(summary.recovery?.mode).toBe('backup-1');
    assertUsable(reopened, summary, '备份恢复可写');
  });

  it('rescues from Assets when backups are unusable and stays writable', async () => {
    const service = newService();
    const created = service.createLibrary({
      displayName: '抢救重建',
      selectedParentPath: temporaryRoot(),
    });
    writeFileSync(path.join(created.libraryPath, 'Assets', 'survivor.txt'), 'keep me');
    expect(await service.createDatabaseBackup(created.libraryId)).toBe(true);
    expect(await service.createDatabaseBackup(created.libraryId)).toBe(true);
    service.closeAll();
    writeFileSync(backupFile(created.libraryPath, 1), 'bad backup 1');
    writeFileSync(backupFile(created.libraryPath, 2), 'bad backup 2');
    const db = new Database(databaseFile(created.libraryPath));
    db.exec('DROP TABLE schema_migrations');
    db.close();

    const reopened = newService();
    const summary = reopened.openLibrary(created.libraryPath);
    expect(summary.recovery?.mode).toBe('rescue');
    expect(summary.readOnly).toBeFalsy();
    assertUsable(reopened, summary, '抢救后可写');
  });

  it('rescues tampered migration history instead of opening read-only', () => {
    const service = newService();
    const created = service.createLibrary({
      displayName: '篡改历史',
      selectedParentPath: temporaryRoot(),
    });
    service.closeAll();
    const db = new Database(databaseFile(created.libraryPath));
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('bad');
    db.close();

    const recovered = service.openLibrary(created.libraryPath);
    expect(recovered.recovery?.mode).toBe('rescue');
    assertUsable(service, recovered, '篡改后抢救可写');
  });

  it('closes one library and keeps another library writable', () => {
    const root = temporaryRoot();
    const service = newService();
    const first = service.createLibrary({
      displayName: '切库源',
      selectedParentPath: root,
    });
    const second = service.createLibrary({
      displayName: '切库目标',
      selectedParentPath: root,
    });
    expect(() => service.closeLibrary(first.libraryId)).not.toThrow();
    assertUsable(service, second, '切库目标可写');
    const reopenedFirst = service.openLibrary(first.libraryPath);
    assertUsable(service, reopenedFirst, '切回源可写');
  });

  it('rejects a folder that is not a library instead of inventing a read-only handle', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: '缺 Assets',
      selectedParentPath: root,
    });
    service.closeAll();
    rmSync(path.join(created.libraryPath, 'Assets'), { recursive: true });
    expect(() => service.openLibrary(created.libraryPath)).toThrow('NOT_A_LIBRARY');
  });

  it('does not record a migration retry latch when history checksums are damaged', () => {
    const libraryPath = buildLibraryAtVersion(temporaryRoot(), 23);
    const db = new Database(databaseFile(libraryPath));
    db.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 23')
      .run('x'.repeat(64));
    db.close();

    const service = newService();
    const recovered = service.openLibrary(libraryPath);
    expect(recovered.recovery?.mode).toBe('rescue');
    assertUsable(service, recovered, '损坏历史抢救可写');
    expect(existsSync(path.join(libraryPath, '.serpent', 'migration-failed.json'))).toBe(false);
  });
});
