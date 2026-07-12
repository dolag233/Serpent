import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  LibraryServiceError,
  openConfiguredDatabase,
  type ImportExpiryClock,
} from '../../src/worker/library-service';

const temporaryRoots: string[] = [];

class ManualImportClock implements ImportExpiryClock {
  private nowValue = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { callback: () => void; dueAt: number }>();
  readonly cancelled: number[] = [];

  cancel(handle: unknown): void {
    const id = handle as number;
    this.cancelled.push(id);
    this.tasks.delete(id);
  }

  now(): number {
    return this.nowValue;
  }

  schedule(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { callback, dueAt: this.nowValue + delayMs });
    return id;
  }

  advance(milliseconds: number): void {
    this.nowValue += milliseconds;
    const due = [...this.tasks.entries()].filter(([, task]) => task.dueAt <= this.nowValue);
    for (const [id, task] of due) {
      this.tasks.delete(id);
      task.callback();
    }
  }
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-import-ttl-test-'));
  temporaryRoots.push(root);
  return root;
}

function expectCode(operation: () => unknown, code: LibraryServiceError['code']): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LibraryServiceError);
  expect((thrown as LibraryServiceError).code).toBe(code);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('pending import lifecycle', () => {
  it('expires a pending token at its TTL and removes its staged operation', () => {
    const root = temporaryRoot();
    const incoming = path.join(root, 'incoming');
    mkdirSync(incoming);
    const source = path.join(incoming, 'same.png');
    writeFileSync(source, 'incoming');
    const clock = new ManualImportClock();
    const service = new LibraryService({ importClock: clock, importTtlMs: 1_000 });
    const library = service.createLibrary({ displayName: 'TTL', selectedParentPath: root });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'same.png'), 'old');
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    const operationPath = path.join(library.libraryPath, '.serpent', 'operations', plan.importId);
    expect(existsSync(operationPath)).toBe(true);

    clock.advance(999);
    expect(existsSync(operationPath)).toBe(true);
    clock.advance(1);
    expect(existsSync(operationPath)).toBe(false);
    expectCode(() => service.abandonImport(plan.importId), 'IMPORT_NOT_FOUND');
    service.closeAll();
  });

  it('cancels the expiry timer during normal close cleanup', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'same.png');
    writeFileSync(source, 'incoming');
    const clock = new ManualImportClock();
    const service = new LibraryService({ importClock: clock, importTtlMs: 1_000 });
    const library = service.createLibrary({ displayName: 'Close TTL', selectedParentPath: root });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'same.png'), 'old');
    const plan = service.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source] });
    service.closeAll();

    expect(clock.cancelled).toHaveLength(1);
    expect(existsSync(path.join(library.libraryPath, '.serpent', 'operations', plan.importId))).toBe(false);
  });

  it('recovers an audited preparing operation after a crash during staging', () => {
    const root = temporaryRoot();
    const first = path.join(root, 'first.png');
    const second = path.join(root, 'second.png');
    writeFileSync(first, 'first');
    writeFileSync(second, 'second');
    const crashing = new LibraryService({ failAt: 'crash-during-prepare-stage' });
    const library = crashing.createLibrary({ displayName: 'Prepare Crash', selectedParentPath: root });
    expectCode(
      () => crashing.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [first, second] }),
      'INVALID_IMPORT_SOURCE',
    );
    const operationsPath = path.join(library.libraryPath, '.serpent', 'operations');
    const [operationId] = readdirSync(operationsPath);
    expect(operationId).toBeTruthy();
    crashing.closeAll();
    const database = openConfiguredDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    expect(database.prepare('SELECT status FROM file_operations WHERE operation_id = ?').get(operationId)).toEqual({ status: 'preparing' });
    database.close();

    const recovered = new LibraryService();
    recovered.openLibrary(library.libraryPath);
    expect(existsSync(operationsPath)).toBe(false);
    recovered.closeAll();
  });

  it('does not delete a destination created externally while a preparing import is staged', () => {
    const root = temporaryRoot();
    const first = path.join(root, 'first.png');
    const second = path.join(root, 'second.png');
    writeFileSync(first, 'first');
    writeFileSync(second, 'second');
    const crashing = new LibraryService({ failAt: 'crash-during-prepare-stage' });
    const library = crashing.createLibrary({ displayName: 'Prepare Concurrent', selectedParentPath: root });
    expectCode(
      () => crashing.prepareImport({ libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [first, second] }),
      'INVALID_IMPORT_SOURCE',
    );

    const concurrentDestination = path.join(library.libraryPath, 'Assets', 'second.png');
    writeFileSync(concurrentDestination, 'created by another process');
    crashing.closeAll();

    const recovered = new LibraryService();
    recovered.openLibrary(library.libraryPath);
    expect(existsSync(concurrentDestination)).toBe(true);
    recovered.closeAll();
  });

  it('does not claim an external destination while recovering a prepared import', () => {
    const root = temporaryRoot();
    const source = path.join(root, 'prepared.png');
    writeFileSync(source, 'source');
    const preparing = new LibraryService();
    const library = preparing.createLibrary({ displayName: 'Prepared Concurrent', selectedParentPath: root });
    const plan = preparing.prepareImport({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: [source],
    });
    const operationPath = path.join(library.libraryPath, '.serpent', 'operations', plan.importId);
    rmSync(path.join(operationPath, 'stage', '0'));
    const concurrentDestination = path.join(library.libraryPath, 'Assets', 'prepared.png');
    writeFileSync(concurrentDestination, 'created by another process');

    const recovered = new LibraryService();
    recovered.openLibrary(library.libraryPath);
    expect(existsSync(concurrentDestination)).toBe(true);
    expect(existsSync(operationPath)).toBe(false);
    recovered.closeAll();
    preparing.closeAll();
  });
});
