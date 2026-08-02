import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { LibraryChangedEvent } from '../../src/shared/protocol/responses';
import {
  executeAutomationReadOnlyWorkerCommand,
} from '../../src/worker/automation-readonly-command-executor';
import { dispatchAutomationReadOnlyRequest } from '../../src/worker/automation-readonly-dispatch';
import { LibraryService, LibraryServiceError } from '../../src/worker/library-service';
import { LibraryWriteCoordinatorError } from '../../src/worker/library-write-coordinator';
import { importNoConflict } from './import-no-conflict';

const require = createRequire(import.meta.url);
const TestDatabase = require('better-sqlite3') as new (filename: string) => {
  close(): void;
  prepare(source: string): {
    get(...parameters: unknown[]): unknown;
  };
};

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-write-fencing-'));
  roots.push(root);
  return root;
}

function newService(
  ...args: ConstructorParameters<typeof LibraryService>
): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
  intervalMs = 25,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for write-fencing condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('Automation write fencing integration', () => {
  it('exposes library.change-sequence as a read-only Worker command without taking the write lease', () => {
    const first = newService();
    const created = first.createLibrary({
      displayName: 'Change sequence command',
      selectedParentPath: temporaryRoot(),
    });
    first.createTag({ libraryId: created.libraryId, name: 'sequence-tag' });

    const result = executeAutomationReadOnlyWorkerCommand(first, {
      type: 'library.change-sequence',
      libraryId: created.libraryId,
    });

    expect(result).toEqual({
      ok: true,
      type: 'library.change-sequence',
      libraryId: created.libraryId,
      changeSequence: 1,
    });

    const dispatched = dispatchAutomationReadOnlyRequest(first, {
      requestId: 'change-sequence-1',
      dispatch: 'automation-readonly',
      command: {
        type: 'library.change-sequence',
        libraryId: created.libraryId,
      },
    });
    expect(dispatched).toEqual(result);
  });

  it('notifies an independently opened LibraryService when another process commits a mutation', async () => {
    const firstEvents: LibraryChangedEvent[] = [];
    const first = newService({
      onLibraryChanged: (event) => firstEvents.push(event),
    });
    const created = first.createLibrary({
      displayName: 'Cross-process sequence',
      selectedParentPath: temporaryRoot(),
    });

    const second = newService();
    second.openLibrary(created.libraryPath);
    second.createTag({ libraryId: created.libraryId, name: 'from-second-process' });

    await waitFor(() => firstEvents.some((event) => event.changeSequence >= 1));

    expect(firstEvents.at(-1)).toMatchObject({
      type: 'library.changed',
      libraryId: created.libraryId,
      changeSequence: 1,
    });
    expect(first.getChangeSequence(created.libraryId)).toBe(1);
    expect(executeAutomationReadOnlyWorkerCommand(first, {
      type: 'library.change-sequence',
      libraryId: created.libraryId,
    })).toMatchObject({ ok: true, changeSequence: 1 });
  });

  it('rejects a second bounded writer while another LibraryService holds the lease', async () => {
    const first = newService();
    const created = first.createLibrary({
      displayName: 'Lease busy',
      selectedParentPath: temporaryRoot(),
    });
    const second = newService();
    second.openLibrary(created.libraryPath);

    const lease = await first.acquireWriteLease(created.libraryId, { timeoutMs: 0 });
    await expect(second.runBoundedWrite(created.libraryId, () => 'should-not-run', {
      timeoutMs: 0,
    })).rejects.toMatchObject({
      code: 'LIBRARY_BUSY',
    });
    expect(second.getChangeSequence(created.libraryId)).toBe(0);
    lease.release();

    await second.runBoundedWrite(created.libraryId, () => {
      second.createTag({ libraryId: created.libraryId, name: 'after-release' });
      return 'ok';
    }, { timeoutMs: 0 });
    expect(second.getChangeSequence(created.libraryId)).toBe(1);
  });

  it('does not let an expired owner renew after another owner reclaims the lease', async () => {
    const first = newService();
    const created = first.createLibrary({
      displayName: 'Expired fencing',
      selectedParentPath: temporaryRoot(),
    });
    const second = newService();
    second.openLibrary(created.libraryPath);

    const stale = await first.acquireWriteLease(created.libraryId, {
      timeoutMs: 0,
      leaseDurationMs: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const recovered = await second.acquireWriteLease(created.libraryId, { timeoutMs: 0 });

    expect(() => stale.renew()).toThrow(LibraryWriteCoordinatorError);
    recovered.release();
  });

  it('skips recovering an applying import while a peer still holds the Job lease', async () => {
    const root = temporaryRoot();
    const source = path.join(root, 'leased.png');
    writeFileSync(source, 'leased-content');
    const setup = newService();
    const created = setup.createLibrary({
      displayName: 'Import lease skip',
      selectedParentPath: root,
    });
    setup.closeAll();

    const crashing = newService({ failAt: 'crash-after-place' });
    const opened = crashing.openLibrary(created.libraryPath);
    const plan = crashing.prepareImport({
      libraryId: opened.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    expect(() => crashing.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    })).toThrow(LibraryServiceError);
    expect(existsSync(path.join(opened.libraryPath, 'Assets', 'leased.png'))).toBe(true);

    // resolveImport releases its lease in finally after SimulatedCrashError; reclaim
    // to model another process still mid-apply.
    const liveLease = await crashing.acquireJobLease(opened.libraryId, plan.importId, {
      timeoutMs: 0,
      leaseDurationMs: 60_000,
    });

    const peer = newService();
    peer.openLibrary(created.libraryPath);
    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      database.prepare('SELECT status FROM file_operations WHERE operation_id = ?')
        .get(plan.importId),
    ).toEqual({ status: 'applying' });
    database.close();
    expect(existsSync(path.join(opened.libraryPath, 'Assets', 'leased.png'))).toBe(true);
    expect(existsSync(path.join(opened.libraryPath, '.serpent', 'operations', plan.importId))).toBe(true);

    liveLease.release();
    crashing.closeAll();
    peer.closeAll();

    const recovered = newService();
    recovered.openLibrary(created.libraryPath);
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'leased.png'))).toBe(false);
    const recoveredDb = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      recoveredDb.prepare('SELECT status, error_code FROM file_operations WHERE operation_id = ?')
        .get(plan.importId),
    ).toMatchObject({ status: 'rolled_back', error_code: 'PROCESS_INTERRUPTED' });
    recoveredDb.close();
    // A peer open while the file was still on disk may have registered a
    // managed asset via refresh; fencing only promises the applying import is
    // not rolled back while leased, and is rolled back after the lease ends.
    recovered.closeAll();
  });

  it('skips recovering an applying managed-move while a peer still holds the Job lease', async () => {
    const root = temporaryRoot();
    const setup = newService();
    const created = setup.createLibrary({
      displayName: 'Move lease skip',
      selectedParentPath: root,
    });
    const sourceFolder = setup.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Source',
    });
    const targetFolder = setup.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Target',
    });
    const source = path.join(root, 'move-lease.png');
    writeFileSync(source, 'move-lease');
    const asset = importNoConflict(setup, created.libraryId, source, sourceFolder.folderId).assets[0]!;
    setup.closeAll();

    const crashing = newService({ failAt: 'crash-move-after-filesystem' });
    crashing.openLibrary(created.libraryPath);
    expect(() => crashing.moveAssets({
      libraryId: created.libraryId,
      assetIds: [asset.assetId],
      targetFolderId: targetFolder.folderId,
      conflictStrategy: 'keep-both',
    })).toThrow(LibraryServiceError);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const operation = database.prepare(
      `SELECT operation_id, status FROM file_operations
        WHERE kind = 'managed-move' ORDER BY created_at DESC LIMIT 1`,
    ).get() as { operation_id: string; status: string };
    expect(operation.status).toBe('applying');
    database.close();
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Target', 'move-lease.png'))).toBe(true);
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Source', 'move-lease.png'))).toBe(false);

    const liveLease = await crashing.acquireJobLease(created.libraryId, operation.operation_id, {
      timeoutMs: 0,
      leaseDurationMs: 60_000,
    });

    const peer = newService();
    peer.openLibrary(created.libraryPath);
    const peerDb = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      peerDb.prepare('SELECT status FROM file_operations WHERE operation_id = ?')
        .get(operation.operation_id),
    ).toEqual({ status: 'applying' });
    peerDb.close();
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Target', 'move-lease.png'))).toBe(true);

    liveLease.release();
    crashing.closeAll();
    peer.closeAll();

    const recovered = newService();
    recovered.openLibrary(created.libraryPath);
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Source', 'move-lease.png'))).toBe(true);
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Target', 'move-lease.png'))).toBe(false);
    const recoveredDb = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      recoveredDb.prepare('SELECT status, error_code FROM file_operations WHERE operation_id = ?')
        .get(operation.operation_id),
    ).toMatchObject({ status: 'rolled_back', error_code: 'PROCESS_INTERRUPTED' });
    recoveredDb.close();
    recovered.closeAll();
  });

  it('releases the managed-move Job lease after a successful apply', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: 'Move lease release',
      selectedParentPath: root,
    });
    const sourceFolder = service.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Source',
    });
    const targetFolder = service.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Target',
    });
    const source = path.join(root, 'ok-move.png');
    writeFileSync(source, 'ok');
    const asset = importNoConflict(service, created.libraryId, source, sourceFolder.folderId).assets[0]!;
    const moved = service.moveAssets({
      libraryId: created.libraryId,
      assetIds: [asset.assetId],
      targetFolderId: targetFolder.folderId,
    });
    expect(moved.operationId).toEqual(expect.any(String));

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      database.prepare(
        'SELECT COUNT(*) AS count FROM library_job_leases WHERE library_id = ? AND job_id = ?',
      ).get(created.libraryId, moved.operationId),
    ).toEqual({ count: 0 });
    database.close();
  });

  it('skips recovering an applying managed-copy while a peer still holds the Job lease', async () => {
    const root = temporaryRoot();
    const setup = newService();
    const created = setup.createLibrary({
      displayName: 'Copy lease skip',
      selectedParentPath: root,
    });
    const sourceFolder = setup.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Source',
    });
    const targetFolder = setup.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Target',
    });
    const source = path.join(root, 'copy-lease.png');
    writeFileSync(source, 'copy-lease');
    const asset = importNoConflict(setup, created.libraryId, source, sourceFolder.folderId).assets[0]!;
    setup.closeAll();

    const crashing = newService({ failAt: 'crash-copy-after-filesystem' });
    crashing.openLibrary(created.libraryPath);
    expect(() => crashing.copyAssets({
      libraryId: created.libraryId,
      assetIds: [asset.assetId],
      targetFolderId: targetFolder.folderId,
      conflictStrategy: 'keep-both',
    })).toThrow(LibraryServiceError);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const operation = database.prepare(
      `SELECT operation_id, status FROM file_operations
        WHERE kind = 'managed-copy' ORDER BY created_at DESC LIMIT 1`,
    ).get() as { operation_id: string; status: string };
    expect(operation.status).toBe('applying');
    database.close();
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Source', 'copy-lease.png'))).toBe(true);
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Target', 'copy-lease.png'))).toBe(true);

    const liveLease = await crashing.acquireJobLease(created.libraryId, operation.operation_id, {
      timeoutMs: 0,
      leaseDurationMs: 60_000,
    });

    const peer = newService();
    peer.openLibrary(created.libraryPath);
    const peerDb = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      peerDb.prepare('SELECT status FROM file_operations WHERE operation_id = ?')
        .get(operation.operation_id),
    ).toEqual({ status: 'applying' });
    peerDb.close();
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Target', 'copy-lease.png'))).toBe(true);

    liveLease.release();
    crashing.closeAll();
    peer.closeAll();

    const recovered = newService();
    recovered.openLibrary(created.libraryPath);
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Source', 'copy-lease.png'))).toBe(true);
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Target', 'copy-lease.png'))).toBe(false);
    const recoveredDb = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      recoveredDb.prepare('SELECT status, error_code FROM file_operations WHERE operation_id = ?')
        .get(operation.operation_id),
    ).toMatchObject({ status: 'rolled_back', error_code: 'PROCESS_INTERRUPTED' });
    recoveredDb.close();
    recovered.closeAll();
  });

  it('releases the managed-copy Job lease after a successful apply', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: 'Copy lease release',
      selectedParentPath: root,
    });
    const sourceFolder = service.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Source',
    });
    const targetFolder = service.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Target',
    });
    const source = path.join(root, 'ok-copy.png');
    writeFileSync(source, 'ok');
    const asset = importNoConflict(service, created.libraryId, source, sourceFolder.folderId).assets[0]!;
    const copied = service.copyAssets({
      libraryId: created.libraryId,
      assetIds: [asset.assetId],
      targetFolderId: targetFolder.folderId,
    });
    expect(copied.operationId).toEqual(expect.any(String));

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      database.prepare(
        'SELECT COUNT(*) AS count FROM library_job_leases WHERE library_id = ? AND job_id = ?',
      ).get(created.libraryId, copied.operationId),
    ).toEqual({ count: 0 });
    database.close();
  });

  it('skips recovering an applying restore while a peer still holds the Job lease', async () => {
    const root = temporaryRoot();
    const setup = newService();
    const created = setup.createLibrary({
      displayName: 'Restore lease skip',
      selectedParentPath: root,
    });
    const folder = setup.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Album',
    });
    const source = path.join(root, 'restore-lease.png');
    writeFileSync(source, 'restore-lease');
    const asset = importNoConflict(setup, created.libraryId, source, folder.folderId).assets[0]!;
    setup.trashAssets({ libraryId: created.libraryId, assetIds: [asset.assetId] });
    setup.closeAll();

    const crashing = newService({ failAt: 'crash-restore-after-filesystem' });
    crashing.openLibrary(created.libraryPath);
    expect(() => crashing.restoreAssets({
      libraryId: created.libraryId,
      assetIds: [asset.assetId],
    })).toThrow(LibraryServiceError);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const operation = database.prepare(
      `SELECT operation_id, status FROM file_operations
        WHERE kind = 'restore' ORDER BY created_at DESC LIMIT 1`,
    ).get() as { operation_id: string; status: string };
    expect(operation.status).toBe('applying');
    database.close();
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Album', 'restore-lease.png'))).toBe(true);

    const liveLease = await crashing.acquireJobLease(created.libraryId, operation.operation_id, {
      timeoutMs: 0,
      leaseDurationMs: 60_000,
    });

    const peer = newService();
    peer.openLibrary(created.libraryPath);
    const peerDb = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      peerDb.prepare('SELECT status FROM file_operations WHERE operation_id = ?')
        .get(operation.operation_id),
    ).toEqual({ status: 'applying' });
    peerDb.close();
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Album', 'restore-lease.png'))).toBe(true);

    liveLease.release();
    crashing.closeAll();
    peer.closeAll();

    const recovered = newService();
    recovered.openLibrary(created.libraryPath);
    expect(existsSync(path.join(created.libraryPath, 'Assets', 'Album', 'restore-lease.png'))).toBe(false);
    const recoveredDb = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      recoveredDb.prepare('SELECT status, error_code FROM file_operations WHERE operation_id = ?')
        .get(operation.operation_id),
    ).toMatchObject({ status: 'rolled_back', error_code: 'PROCESS_INTERRUPTED' });
    recoveredDb.close();
    recovered.closeAll();
  });

  it('releases the restore Job lease after a successful apply', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({
      displayName: 'Restore lease release',
      selectedParentPath: root,
    });
    const folder = service.createManagedFolder({
      libraryId: created.libraryId,
      name: 'Album',
    });
    const source = path.join(root, 'ok-restore.png');
    writeFileSync(source, 'ok');
    const asset = importNoConflict(service, created.libraryId, source, folder.folderId).assets[0]!;
    service.trashAssets({ libraryId: created.libraryId, assetIds: [asset.assetId] });
    const restored = service.restoreAssets({
      libraryId: created.libraryId,
      assetIds: [asset.assetId],
    });
    expect(restored.operationId).toEqual(expect.any(String));

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      database.prepare(
        'SELECT COUNT(*) AS count FROM library_job_leases WHERE library_id = ? AND job_id = ?',
      ).get(created.libraryId, restored.operationId),
    ).toEqual({ count: 0 });
    database.close();
  });

  it('releases the import Job lease after a successful apply', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'ok.png');
    writeFileSync(source, 'ok');
    const service = newService();
    const created = service.createLibrary({
      displayName: 'Import lease release',
      selectedParentPath: root,
    });
    const plan = service.prepareImport({
      libraryId: created.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    const completion = service.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    expect(completion.importedCount).toBe(1);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    expect(
      database.prepare(
        'SELECT COUNT(*) AS count FROM library_job_leases WHERE library_id = ? AND job_id = ?',
      ).get(created.libraryId, plan.importId),
    ).toEqual({ count: 0 });
    database.close();
  });
});
