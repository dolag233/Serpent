import {
  existsSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];
const services: LibraryService[] = [];
const require = createRequire(import.meta.url);

interface TestDatabase {
  close(): void;
  prepare(source: string): {
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
}

const Database = require('better-sqlite3') as new (filename: string) => TestDatabase;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-database-recovery-'));
  roots.push(root);
  return root;
}

function databasePath(libraryPath: string): string {
  return path.join(libraryPath, '.serpent', 'library.db');
}

function backupPath(libraryPath: string, slot: 1 | 2): string {
  return path.join(libraryPath, '.serpent', 'backups', `library.db.${slot}`);
}

function newService(): LibraryService {
  const service = new LibraryService();
  services.push(service);
  return service;
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('database damage recovery (Serpent-dw9a)', () => {
  it('keeps at most two verified rotating backup slots', async () => {
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Backup Rotation',
      selectedParentPath: temporaryRoot(),
    });

    expect(await service.createDatabaseBackup(library.libraryId)).toBe(true);
    expect(await service.createDatabaseBackup(library.libraryId)).toBe(true);
    expect(await service.createDatabaseBackup(library.libraryId)).toBe(true);

    const backupDirectory = path.join(library.libraryPath, '.serpent', 'backups');
    expect(readdirSync(backupDirectory).sort()).toEqual([
      'library.db.1',
      'library.db.2',
    ]);
    expect(existsSync(path.join(backupDirectory, '.library.db.tmp'))).toBe(false);
  });

  it('restores a damaged primary from backup 1 and preserves the damaged file', async () => {
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Backup Recovery',
      selectedParentPath: temporaryRoot(),
    });
    await service.createDatabaseBackup(library.libraryId);
    service.closeAll();
    writeFileSync(databasePath(library.libraryPath), 'not a sqlite database');

    const reopened = newService();
    const summary = reopened.openLibrary(library.libraryPath);
    expect(summary.recovery).toEqual({ mode: 'backup-1' });
    expect(summary.readOnly).toBeUndefined();
    expect(readdirSync(path.join(library.libraryPath, '.serpent', 'corrupt-backup'))
      .some((name) => name.startsWith('library.db.primary-'))).toBe(true);
  });

  it('restores a missing primary from the latest verified backup', async () => {
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Missing Primary Recovery',
      selectedParentPath: temporaryRoot(),
    });
    await service.createDatabaseBackup(library.libraryId);
    service.closeAll();
    rmSync(databasePath(library.libraryPath));

    const reopened = newService();
    const summary = reopened.openLibrary(library.libraryPath);
    expect(summary.recovery).toEqual({ mode: 'backup-1' });
    expect(existsSync(databasePath(library.libraryPath))).toBe(true);
  });

  it('falls back to read-only when both backups are unusable', async () => {
    const service = newService();
    const library = service.createLibrary({
      displayName: 'Read Only Recovery',
      selectedParentPath: temporaryRoot(),
    });
    await service.createDatabaseBackup(library.libraryId);
    await service.createDatabaseBackup(library.libraryId);
    service.closeAll();

    writeFileSync(backupPath(library.libraryPath, 1), 'bad backup 1');
    writeFileSync(backupPath(library.libraryPath, 2), 'bad backup 2');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3') as new (filename: string) => {
      exec(sql: string): void;
      close(): void;
    };
    const database = new Database(databasePath(library.libraryPath));
    database.exec('DROP TABLE schema_migrations');
    database.close();

    const reopened = newService();
    const summary = reopened.openLibrary(library.libraryPath);
    expect(summary.recovery).toEqual({ mode: 'read-only' });
    expect(summary.readOnly).toBe(true);
  });

  it('rebuilds a database from Assets when the primary and read-only path fail', async () => {
    const service = newService();
    const root = temporaryRoot();
    const library = service.createLibrary({
      displayName: 'Rescue Recovery',
      selectedParentPath: root,
    });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'survivor.txt'), 'asset data');
    service.closeAll();

    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3') as new (filename: string) => {
      exec(sql: string): void;
      close(): void;
    };
    const database = new Database(databasePath(library.libraryPath));
    database.exec('DROP TABLE library');
    database.close();

    const reopened = newService();
    const summary = reopened.openLibrary(library.libraryPath);
    expect(summary.recovery?.mode).toBe('rescue');
    expect(summary.recovery?.reportPath).toBeTruthy();
    expect(summary.recovery?.recoveredAssetCount).toBe(1);
    expect(summary.recovery?.metadataRecovered).toBe(false);
    expect(summary.recovery?.metadataLosses).toEqual([
      'collections',
      'tags',
      'ratings',
      'descriptions',
      'source-links',
    ]);
    expect(summary.libraryId).not.toBe(library.libraryId);

    const reportPath = reopened.getRecoveryReportPath(summary.libraryId);
    expect(reportPath).toBe(summary.recovery?.reportPath);
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
      recoveredFrom: 'Assets',
      recoveredAssetCount: 1,
      metadataRecovered: false,
    });

    reopened.refreshManagedAssets(summary.libraryId);
    expect(reopened.listAssets({ libraryId: summary.libraryId, recursive: true })
      .map((asset) => asset.displayName)).toContain('survivor.txt');
  });

  it('keeps dangling revisions visible and repairs them from the source file', () => {
    const service = newService();
    const root = temporaryRoot();
    const library = service.createLibrary({
      displayName: 'Dangling Revision Recovery',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'dangling.txt');
    writeFileSync(sourcePath, 'recoverable asset');
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [sourcePath],
    });
    if ('importId' in imported) throw new Error('Unexpected import conflict.');
    const asset = imported.assets[0]!;
    const database = new Database(databasePath(library.libraryPath));
    database.prepare('DELETE FROM revisions WHERE revision_id = ?').run(asset.currentRevisionId);
    database.close();

    const listed = service.listAssets({ libraryId: library.libraryId, recursive: true });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      assetId: asset.assetId,
      availability: 'missing',
      currentRevisionId: `corrupt:${asset.assetId}`,
    });
    expect(service.searchAssets({ libraryId: library.libraryId, limit: 10 }).items)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          assetId: asset.assetId,
          availability: 'missing',
          currentRevisionId: `corrupt:${asset.assetId}`,
        }),
      ]));

    const repaired = service.refreshManagedAssets(library.libraryId);
    expect(repaired.changedCount).toBe(1);
    expect(repaired.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: asset.assetId, availability: 'available' }),
    ]));
    expect(repaired.assets.find((item) => item.assetId === asset.assetId)?.currentRevisionId)
      .not.toBe(asset.currentRevisionId);
  });

  it('probes only known recovery locations and verifies a matching candidate', () => {
    const service = newService();
    const root = temporaryRoot();
    const library = service.createLibrary({
      displayName: 'Recovery Probe',
      selectedParentPath: root,
    });
    const sourcePath = path.join(root, 'probe.jpg');
    writeFileSync(sourcePath, 'known bytes');
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [sourcePath],
    });
    if ('importId' in imported) throw new Error('Unexpected import conflict.');
    const asset = imported.assets[0]!;
    const managedPath = path.join(library.libraryPath, 'Assets', 'probe.jpg');

    rmSync(managedPath);
    service.refreshManagedAssets(library.libraryId);
    writeFileSync(managedPath, 'known bytes');
    expect(service.probeMissingAssetRecovery({
      libraryId: library.libraryId,
      assetId: asset.assetId,
    })).toEqual({
      status: 'recoverable',
      candidateKind: 'managed-source',
      contentVerified: true,
      checkedLocations: 1,
    });

    writeFileSync(managedPath, 'different bytes');
    expect(service.probeMissingAssetRecovery({
      libraryId: library.libraryId,
      assetId: asset.assetId,
    })).toEqual({
      status: 'needs-location',
      candidateKind: null,
      contentVerified: false,
      checkedLocations: 2,
    });
  });

  it('throttles routine backups for 24 hours and refreshes the slot afterwards', async () => {
    let now = Date.now();
    const service = new LibraryService({ databaseBackupClock: { now: () => now } });
    services.push(service);
    const library = service.createLibrary({
      displayName: 'Throttle Before',
      selectedParentPath: temporaryRoot(),
    });

    await service.runOpenBackgroundReconciliation(library.libraryId);
    const backup = backupPath(library.libraryPath, 1);
    const readBackupName = () => {
      const database = new Database(backup);
      try {
        return (database.prepare('SELECT display_name FROM library LIMIT 1').get() as {
          display_name: string;
        }).display_name;
      } finally {
        database.close();
      }
    };
    expect(readBackupName()).toBe('Throttle Before');

    service.renameLibrary({ libraryId: library.libraryId, displayName: 'Throttle During' });
    now += 60 * 60 * 1000;
    await service.runOpenBackgroundReconciliation(library.libraryId);
    expect(readBackupName()).toBe('Throttle Before');

    now += 24 * 60 * 60 * 1000 + 1;
    await service.runOpenBackgroundReconciliation(library.libraryId);
    expect(readBackupName()).toBe('Throttle During');
  });
});
