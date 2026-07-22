/**
 * NOTE: These tests validate recovery logic by creating a new LibraryService instance
 * after `closeAll()`. This proves in-process recovery works but does NOT exercise a
 * real UtilityProcess kill/restart with its SQLite WAL/disk flush and IPC lifecycle
 * boundaries.
 *
 * Real process-restart coverage IS feasible but requires new infrastructure:
 * 1. LibraryWorkerClient must expose the worker PID (trivial: a `pid` getter).
 * 2. LibraryWorkerClient needs a `restart()` method or the main process must
 *    auto-restart on unexpected exit (currently neither exists).
 * 3. The test must be an E2E (Playwright) test, not a vitest worker test, because
 *    worker tests import LibraryService directly from TS source, while
 *    utilityProcess.fork() requires a compiled JS bundle.
 * 4. The worker JS bundle must be pre-built (the e2e runner already does this via
 *    Vite build; the worker-test runner does not).
 *
 * Without these, worker tests cannot spawn/kill/restart a real UtilityProcess, so
 * the WAL flush, IPC reconnect, and LibraryWorkerClient state-machine recovery on
 * unexpected exit remain untested.
 */
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
} from '../../src/worker/library-service';
import type { ImportCompletion } from '../../src/shared/protocol/responses';
import { importNoConflict as sharedImportNoConflict } from './import-no-conflict';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(source: string): void;
  pragma(source: string): unknown;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (
  filename: string,
) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-relink-crash-'));
  temporaryRoots.push(root);
  return root;
}

function expectServiceError(operation: () => unknown, code: LibraryServiceError['code']): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LibraryServiceError);
  expect((thrown as LibraryServiceError).code).toBe(code);
}

function importNoConflict(service: LibraryService, libraryId: string, sourcePath: string, targetFolderId?: string): ImportCompletion {
  return sharedImportNoConflict(service, libraryId, sourcePath, targetFolderId);
}

function missingManagedAssetFixture(label: string): {
  assetId: string;
  libraryId: string;
  libraryPath: string;
  managedPath: string;
  replacementPath: string;
  root: string;
} {
  const root = temporaryRoot();
  const service = new LibraryService();
  const created = service.createLibrary({ displayName: label, selectedParentPath: root });
  const sourcePath = path.join(root, 'orig.jpg');
  writeFileSync(sourcePath, 'original bytes');
  const imported = importNoConflict(service, created.libraryId, sourcePath);
  const assetId = imported.assets[0]!.assetId;
  const managedPath = path.join(created.libraryPath, 'Assets', 'orig.jpg');
  rmSync(managedPath);
  service.refreshManagedAssets(created.libraryId);
  service.closeAll();
  const replacementPath = path.join(root, 'replacement.jpg');
  writeFileSync(replacementPath, 'replacement bytes');
  return {
    assetId,
    libraryId: created.libraryId,
    libraryPath: created.libraryPath,
    managedPath,
    replacementPath,
    root,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('relinkAsset recovery on reopen', () => {
  it('preserves orphan placement after failpoint and cleans up on reopen', () => {
    // ---- SETUP ----
    const root = temporaryRoot();
    const setup = new LibraryService();
    const created = setup.createLibrary({ displayName: 'Relink Crash', selectedParentPath: root });

    // Import a managed asset
    writeFileSync(path.join(root, 'orig.jpg'), 'original bytes');
    const imported = importNoConflict(setup, created.libraryId, path.join(root, 'orig.jpg'));
    const assetId = imported.assets[0]!.assetId;

    // Make it missing
    rmSync(path.join(created.libraryPath, 'Assets', 'orig.jpg'));
    setup.refreshManagedAssets(created.libraryId);
    expect(setup.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.availability)
      .toBe('missing');
    setup.closeAll();

    // Create replacement file
    const replacementPath = path.join(root, 'replacement.jpg');
    writeFileSync(replacementPath, 'replacement bytes');

    // ---- CRASH EXECUTION ----
    const crashing = new LibraryService({ failAt: 'crash-relink-after-filesystem' });
    const opened = crashing.openLibrary(created.libraryPath);
    expectServiceError(
      () => crashing.relinkAsset({
        libraryId: opened.libraryId,
        assetId,
        newAbsolutePath: replacementPath,
      }),
      'LIBRARY_NOT_WRITABLE',
    );

    // ---- VERIFY ORPHAN STATE ----
    // File was placed on disk by placeManagedRelinkFile
    const managedPath = path.join(created.libraryPath, 'Assets', 'orig.jpg');
    expect(existsSync(managedPath)).toBe(true);
    expect(readFileSync(managedPath, 'utf8')).toBe('replacement bytes');

    // Operation dir exists with valid manifest
    const opsDir = path.join(created.libraryPath, '.serpent', 'operations');
    const relinkChildren = readdirSync(opsDir).filter((c) => c.startsWith('relink-'));
    expect(relinkChildren).toHaveLength(1);
    const manifestPath = path.join(opsDir, relinkChildren[0]!, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.version).toBe(3);
    expect(manifest.phase).toBe('staged');
    expect(manifest.destinationRelativePath).toBe('orig.jpg');
    expect(manifest.stagedIdentity).toEqual({
      ctimeNs: expect.any(String),
      dev: expect.any(String),
      ino: expect.any(String),
      size: String(readFileSync(managedPath).length),
      mtimeNs: expect.any(String),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const placedMarker = JSON.parse(
      readFileSync(path.join(opsDir, relinkChildren[0]!, 'placed.json'), 'utf8'),
    );
    expect(placedMarker.version).toBe(1);
    expect(placedMarker.placedIdentity.ctimeNs).toEqual(expect.any(String));

    // DB still shows missing (transaction never started)
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const avail = db.prepare(
      'SELECT availability FROM assets WHERE asset_id = ?',
    ).get(assetId) as { availability: string };
    expect(avail.availability).toBe('missing');
    db.close();

    crashing.closeAll();

    // ---- RECOVERY ----
    const diagnostics: Array<{ scope: string }> = [];
    const recovered = new LibraryService({ onDiagnostic: (d) => diagnostics.push(d) });
    recovered.openLibrary(created.libraryPath);

    // Assert recovery cleaned up the placed file
    expect(existsSync(managedPath)).toBe(false);

    // Assert recovery cleaned up the operation dir (opsDir itself may be removed too)
    let relinkCount = 0;
    try { relinkCount = readdirSync(opsDir).filter((c) => c.startsWith('relink-')).length; } catch { /* dir removed */ }
    expect(relinkCount).toBe(0);

    // Assert diagnostic was emitted
    expect(diagnostics.some((d) => d.scope === 'asset.relink.recovered-orphan-placement')).toBe(true);

    // Asset remains missing (no DB commit happened)
    expect(recovered.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.availability)
      .toBe('missing');

    recovered.closeAll();
  });

  it.each([
    'crash-relink-before-manifest-write',
    'crash-relink-after-manifest-before-placement',
  ] as const)('never removes a destination that was not durably placed at %s', (failAt) => {
    const fixture = missingManagedAssetFixture(`Relink ${failAt}`);
    const crashing = new LibraryService({ failAt });
    crashing.openLibrary(fixture.libraryPath);
    expectServiceError(
      () => crashing.relinkAsset({
        libraryId: fixture.libraryId,
        assetId: fixture.assetId,
        newAbsolutePath: fixture.replacementPath,
      }),
      'LIBRARY_NOT_WRITABLE',
    );
    crashing.closeAll();

    // Simulate an external writer claiming the missing managed path after the
    // interrupted operation. Recovery has no placed marker and must preserve it.
    writeFileSync(fixture.managedPath, 'external writer bytes');
    const diagnostics: Array<{ scope: string }> = [];
    const recovered = new LibraryService({ onDiagnostic: (event) => diagnostics.push(event) });
    recovered.openLibrary(fixture.libraryPath);
    expect(readFileSync(fixture.managedPath, 'utf8')).toBe('external writer bytes');
    if (failAt === 'crash-relink-after-manifest-before-placement') {
      expect(diagnostics.some((event) => event.scope === 'asset.relink.recovery-ownership-unknown')).toBe(true);
    }
    recovered.closeAll();
  });

  it('preserves the destination in the rename-to-placed-marker crash window', () => {
    const fixture = missingManagedAssetFixture('Relink rename marker window');
    const crashing = new LibraryService({
      failAt: 'crash-relink-after-placement-before-manifest-update',
    });
    crashing.openLibrary(fixture.libraryPath);
    expectServiceError(
      () => crashing.relinkAsset({
        libraryId: fixture.libraryId,
        assetId: fixture.assetId,
        newAbsolutePath: fixture.replacementPath,
      }),
      'LIBRARY_NOT_WRITABLE',
    );
    expect(readFileSync(fixture.managedPath, 'utf8')).toBe('replacement bytes');
    const operationsPath = path.join(fixture.libraryPath, '.serpent', 'operations');
    const operationName = readdirSync(operationsPath).find((name) => name.startsWith('relink-'))!;
    expect(existsSync(path.join(operationsPath, operationName, 'manifest.json'))).toBe(true);
    expect(existsSync(path.join(operationsPath, operationName, 'placed.json'))).toBe(false);
    crashing.closeAll();

    const diagnostics: Array<{ scope: string }> = [];
    const recovered = new LibraryService({ onDiagnostic: (event) => diagnostics.push(event) });
    recovered.openLibrary(fixture.libraryPath);
    expect(readFileSync(fixture.managedPath, 'utf8')).toBe('replacement bytes');
    expect(diagnostics.some((event) => event.scope === 'asset.relink.recovery-ownership-unknown')).toBe(true);
    expect(recovered.listAssets({ libraryId: fixture.libraryId, recursive: true })[0]!.availability).toBe('missing');
    recovered.closeAll();
  });

  it('rolls back an exactly-owned placement when interrupted before DB commit', () => {
    const fixture = missingManagedAssetFixture('Relink before commit');
    const crashing = new LibraryService({ failAt: 'crash-relink-before-db-commit' });
    crashing.openLibrary(fixture.libraryPath);
    expectServiceError(
      () => crashing.relinkAsset({
        libraryId: fixture.libraryId,
        assetId: fixture.assetId,
        newAbsolutePath: fixture.replacementPath,
      }),
      'LIBRARY_NOT_WRITABLE',
    );
    crashing.closeAll();

    const recovered = new LibraryService();
    recovered.openLibrary(fixture.libraryPath);
    expect(existsSync(fixture.managedPath)).toBe(false);
    expect(recovered.listAssets({ libraryId: fixture.libraryId, recursive: true })[0]!.availability).toBe('missing');
    recovered.closeAll();
  });

  it('keeps a committed placement when interrupted after DB commit', () => {
    const fixture = missingManagedAssetFixture('Relink after commit');
    const crashing = new LibraryService({ failAt: 'crash-relink-after-db-commit' });
    crashing.openLibrary(fixture.libraryPath);
    expectServiceError(
      () => crashing.relinkAsset({
        libraryId: fixture.libraryId,
        assetId: fixture.assetId,
        newAbsolutePath: fixture.replacementPath,
      }),
      'LIBRARY_NOT_WRITABLE',
    );
    crashing.closeAll();

    const diagnostics: Array<{ scope: string }> = [];
    const recovered = new LibraryService({ onDiagnostic: (event) => diagnostics.push(event) });
    recovered.openLibrary(fixture.libraryPath);
    expect(readFileSync(fixture.managedPath, 'utf8')).toBe('replacement bytes');
    expect(recovered.listAssets({ libraryId: fixture.libraryId, recursive: true })[0]!.availability).toBe('available');
    expect(diagnostics.some((event) => event.scope === 'asset.relink.recovered-committed-placement')).toBe(true);
    recovered.closeAll();
  });

  it('preserves the destination when the immutable placed marker is corrupt', () => {
    const fixture = missingManagedAssetFixture('Relink corrupt marker');
    const crashing = new LibraryService({ failAt: 'crash-relink-after-filesystem' });
    crashing.openLibrary(fixture.libraryPath);
    expectServiceError(
      () => crashing.relinkAsset({
        libraryId: fixture.libraryId,
        assetId: fixture.assetId,
        newAbsolutePath: fixture.replacementPath,
      }),
      'LIBRARY_NOT_WRITABLE',
    );
    const operationsPath = path.join(fixture.libraryPath, '.serpent', 'operations');
    const operationName = readdirSync(operationsPath).find((name) => name.startsWith('relink-'))!;
    writeFileSync(path.join(operationsPath, operationName, 'placed.json'), '{incomplete');
    crashing.closeAll();

    const diagnostics: Array<{ scope: string }> = [];
    const recovered = new LibraryService({ onDiagnostic: (event) => diagnostics.push(event) });
    recovered.openLibrary(fixture.libraryPath);
    expect(readFileSync(fixture.managedPath, 'utf8')).toBe('replacement bytes');
    expect(diagnostics.some((event) => event.scope === 'asset.relink.recovery-marker-invalid')).toBe(true);
    expect(recovered.listAssets({ libraryId: fixture.libraryId, recursive: true })[0]!.availability).toBe('missing');
    recovered.closeAll();
  });

  it.each([1, 2] as const)('treats legacy v%s ownership as unknown and preserves the destination', (version) => {
    const fixture = missingManagedAssetFixture(`Relink legacy v${version}`);
    writeFileSync(fixture.managedPath, 'external writer bytes');
    const operationsPath = path.join(fixture.libraryPath, '.serpent', 'operations');
    const operationPath = path.join(operationsPath, `relink-${randomUUID()}`);
    mkdirSync(operationPath, { recursive: true });
    const current = statSync(fixture.managedPath, { bigint: true });
    writeFileSync(path.join(operationPath, 'manifest.json'), JSON.stringify(
      version === 1
        ? { version, destinationRelativePath: 'orig.jpg' }
        : {
            version,
            destinationRelativePath: 'orig.jpg',
            placedSnapshot: { size: String(current.size), mtimeNs: String(current.mtimeNs) },
          },
    ));

    const diagnostics: Array<{ scope: string }> = [];
    const recovered = new LibraryService({ onDiagnostic: (event) => diagnostics.push(event) });
    recovered.openLibrary(fixture.libraryPath);
    expect(readFileSync(fixture.managedPath, 'utf8')).toBe('external writer bytes');
    expect(diagnostics.some((event) => event.scope === 'asset.relink.recovery-ownership-unknown')).toBe(true);
    recovered.closeAll();
  });
});

describe('relinkBatchApply recovery on reopen', () => {
  it('preserves orphan placement after batch failpoint and cleans up on reopen', () => {
    // ---- SETUP: 3 managed assets with different paths ----
    const root = temporaryRoot();
    const setup = new LibraryService();
    const created = setup.createLibrary({ displayName: 'Batch Crash', selectedParentPath: root });

    // Asset 1: root level
    writeFileSync(path.join(root, 'file1.jpg'), 'bytes1');
    void importNoConflict(setup, created.libraryId, path.join(root, 'file1.jpg'));

    // Asset 2: subfolder
    const sub = setup.createManagedFolder({ libraryId: created.libraryId, name: 'sub' });
    writeFileSync(path.join(root, 'file2.jpg'), 'bytes2');
    void importNoConflict(setup, created.libraryId, path.join(root, 'file2.jpg'), sub.folderId);

    // Asset 3: deeper subfolder
    const deep = setup.createManagedFolder({ libraryId: created.libraryId, name: 'deep' });
    writeFileSync(path.join(root, 'file3.jpg'), 'bytes3');
    void importNoConflict(setup, created.libraryId, path.join(root, 'file3.jpg'), deep.folderId);

    // Make all missing
    rmSync(path.join(created.libraryPath, 'Assets', 'file1.jpg'));
    rmSync(path.join(created.libraryPath, 'Assets', 'sub'), { recursive: true });
    rmSync(path.join(created.libraryPath, 'Assets', 'deep'), { recursive: true });
    setup.refreshManagedAssets(created.libraryId);
    const allAssets = setup.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(allAssets.every((a) => a.availability === 'missing')).toBe(true);
    setup.closeAll();

    // Create replacement root with all 3 files
    const newRoot = path.join(root, 'replacements');
    mkdirSync(path.join(newRoot, 'sub'), { recursive: true });
    mkdirSync(path.join(newRoot, 'deep'), { recursive: true });
    writeFileSync(path.join(newRoot, 'file1.jpg'), 'new-bytes1');
    writeFileSync(path.join(newRoot, 'sub', 'file2.jpg'), 'new-bytes2');
    writeFileSync(path.join(newRoot, 'deep', 'file3.jpg'), 'new-bytes3');

    // ---- CRASH EXECUTION ----
    const crashing = new LibraryService({ failAt: 'crash-relink-batch-after-first-place' });
    const opened = crashing.openLibrary(created.libraryPath);
    expectServiceError(
      () => crashing.relinkBatchApply({
        libraryId: opened.libraryId,
        newRootPath: newRoot,
        keepMetadata: true,
      }),
      'LIBRARY_NOT_WRITABLE',
    );

    // ---- VERIFY ORPHAN STATE ----
    // Only the first matched asset's file was placed (renameSync succeeded before crash).
    // Because batchRelinkRows orders by relative_file_path, the iteration order is
    // deterministic but we verify based on the manifest rather than hardcoding the
    // first-position asset.
    const allExpectedPaths = [
      path.join(created.libraryPath, 'Assets', 'file1.jpg'),
      path.join(created.libraryPath, 'Assets', 'sub', 'file2.jpg'),
      path.join(created.libraryPath, 'Assets', 'deep', 'file3.jpg'),
    ];
    const placedPaths = allExpectedPaths.filter((p) => existsSync(p));
    expect(placedPaths).toHaveLength(1);
    const placedPath = placedPaths[0]!;

    // Operation dir exists with valid manifest
    const opsDir = path.join(created.libraryPath, '.serpent', 'operations');
    const relinkChildren = readdirSync(opsDir).filter((c) => c.startsWith('relink-'));
    expect(relinkChildren).toHaveLength(1);
    const manifest = JSON.parse(
      readFileSync(path.join(opsDir, relinkChildren[0]!, 'manifest.json'), 'utf8'),
    );
    expect(manifest.version).toBe(3);
    expect(typeof manifest.destinationRelativePath).toBe('string');
    const placedMarker = JSON.parse(
      readFileSync(path.join(opsDir, relinkChildren[0]!, 'placed.json'), 'utf8'),
    );
    expect(placedMarker.placedIdentity).toMatchObject({
      ctimeNs: expect.any(String),
      dev: expect.any(String),
      ino: expect.any(String),
      size: expect.any(String),
      mtimeNs: expect.any(String),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    // The placed file must match the manifest's destination relative path
    const manifestDestPath = path.join(created.libraryPath, 'Assets', manifest.destinationRelativePath);
    expect(placedPath).toBe(manifestDestPath);
    expect(readFileSync(placedPath, 'utf8')).toMatch(/^new-bytes/);

    // The other 2 files were never placed
    const unplacedPaths = allExpectedPaths.filter((p) => p !== placedPath);
    for (const p of unplacedPaths) {
      expect(existsSync(p)).toBe(false);
    }

    // DB: all 3 assets still missing (transaction rolled back)
    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const missingCount = (
      db.prepare("SELECT COUNT(*) AS count FROM assets WHERE availability = 'missing' AND deleted_at IS NULL")
        .get() as { count: number }
    ).count;
    expect(missingCount).toBe(3);

    // file_operations: no relink-batch row (inside rolled-back transaction)
    const foCount = (
      db.prepare("SELECT COUNT(*) AS count FROM file_operations WHERE kind = 'relink-batch'")
        .get() as { count: number }
    ).count;
    expect(foCount).toBe(0);
    db.close();

    crashing.closeAll();

    // ---- RECOVERY ----
    const diagnostics: Array<{ scope: string }> = [];
    const recovered = new LibraryService({ onDiagnostic: (d) => diagnostics.push(d) });
    recovered.openLibrary(created.libraryPath);

    // Orphan file deleted
    expect(existsSync(placedPath)).toBe(false);

    // Operation dir cleaned up (opsDir itself may be removed too)
    let relinkCount2 = 0;
    try { relinkCount2 = readdirSync(opsDir).filter((c) => c.startsWith('relink-')).length; } catch { /* dir removed */ }
    expect(relinkCount2).toBe(0);

    // Diagnostic emitted
    const recoveryDiags = diagnostics.filter(
      (d) => d.scope === 'asset.relink.recovered-orphan-placement',
    );
    expect(recoveryDiags).toHaveLength(1);

    // All 3 assets still missing (nothing committed)
    const finalAssets = recovered.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(finalAssets).toHaveLength(3);
    expect(finalAssets.every((a) => a.availability === 'missing')).toBe(true);

    recovered.closeAll();
  });

  it('does not delete destination file when placedSnapshot mismatches after crash', () => {
    // ---- SETUP ----
    const root = temporaryRoot();
    const setup = new LibraryService();
    const created = setup.createLibrary({ displayName: 'Relink Mismatch', selectedParentPath: root });

    // Import a managed asset
    writeFileSync(path.join(root, 'orig.jpg'), 'original bytes');
    const imported = importNoConflict(setup, created.libraryId, path.join(root, 'orig.jpg'));
    const assetId = imported.assets[0]!.assetId;

    // Make it missing
    rmSync(path.join(created.libraryPath, 'Assets', 'orig.jpg'));
    setup.refreshManagedAssets(created.libraryId);
    expect(setup.listAssets({ libraryId: created.libraryId, recursive: true })[0]!.availability)
      .toBe('missing');
    setup.closeAll();

    // Create replacement file
    const replacementPath = path.join(root, 'replacement.jpg');
    writeFileSync(replacementPath, 'replacement bytes');

    // ---- CRASH EXECUTION ----
    const crashing = new LibraryService({ failAt: 'crash-relink-after-filesystem' });
    const opened = crashing.openLibrary(created.libraryPath);
    expectServiceError(
      () => crashing.relinkAsset({
        libraryId: opened.libraryId,
        assetId,
        newAbsolutePath: replacementPath,
      }),
      'LIBRARY_NOT_WRITABLE',
    );

    // ---- VERIFY ORPHAN STATE ----
    const managedPath = path.join(created.libraryPath, 'Assets', 'orig.jpg');
    expect(existsSync(managedPath)).toBe(true);
    expect(readFileSync(managedPath, 'utf8')).toBe('replacement bytes');

    // v3 manifest + immutable completion marker carry durable ownership.
    const opsDir = path.join(created.libraryPath, '.serpent', 'operations');
    const relinkChildren = readdirSync(opsDir).filter((c) => c.startsWith('relink-'));
    expect(relinkChildren).toHaveLength(1);
    const manifestPath = path.join(opsDir, relinkChildren[0]!, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.version).toBe(3);
    expect(existsSync(path.join(opsDir, relinkChildren[0]!, 'placed.json'))).toBe(true);

    crashing.closeAll();

    // ---- TAMPER: replace the placed file with different content ----
    writeFileSync(managedPath, 'tampered content by another process');

    // ---- RECOVERY ----
    const diagnostics: Array<{ scope: string; context?: Record<string, unknown> }> = [];
    const recovered = new LibraryService({ onDiagnostic: (d) => diagnostics.push(d as { scope: string; context?: Record<string, unknown> }) });
    recovered.openLibrary(created.libraryPath);

    // File should NOT be deleted because snapshot doesn't match
    expect(existsSync(managedPath)).toBe(true);
    expect(readFileSync(managedPath, 'utf8')).toBe('tampered content by another process');

    // Mismatch diagnostic should be emitted
    const mismatchDiags = diagnostics.filter(
      (d) => d.scope === 'asset.relink.recovery-file-mismatch',
    );
    expect(mismatchDiags).toHaveLength(1);
    expect(mismatchDiags[0]!.context!.destinationRelativePath).toBe('orig.jpg');

    // No recovered-orphan-placement diagnostic (we didn't delete anything)
    const orphanDiags = diagnostics.filter(
      (d) => d.scope === 'asset.relink.recovered-orphan-placement',
    );
    expect(orphanDiags).toHaveLength(0);

    // Operation dir still cleaned up
    let relinkCount = 0;
    try { relinkCount = readdirSync(opsDir).filter((c) => c.startsWith('relink-')).length; } catch { /* dir removed */ }
    expect(relinkCount).toBe(0);

    recovered.closeAll();
  });
});
