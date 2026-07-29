import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryWriteCoordinator,
  LibraryWriteCoordinatorError,
} from '../../src/worker/library-write-coordinator';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as new (filename: string) => {
  close(): void;
  exec(source: string): void;
  prepare(source: string): {
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): { changes: number };
  };
  transaction<T>(operation: () => T): () => T;
};

const roots: string[] = [];

function databasePath(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-write-lease-'));
  roots.push(root);
  return path.join(root, 'library.db');
}

function createDatabase(filename: string): InstanceType<typeof Database> {
  const database = new Database(filename);
  database.exec(`
    CREATE TABLE library_write_leases (
      library_id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL
    );
    CREATE TABLE library_change_sequence (
      library_id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL CHECK(sequence >= 0)
    );
    INSERT INTO library_change_sequence (library_id, sequence)
      VALUES ('library-1', 0);
  `);
  return database;
}

function expectBusy(operation: () => unknown): void {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(LibraryWriteCoordinatorError);
  expect(error).toMatchObject({ code: 'LIBRARY_BUSY', retryable: true });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('LibraryWriteCoordinator', () => {
  it('serializes writers from independent database connections and exposes a retryable busy error', async () => {
    const filename = databasePath();
    const firstDatabase = createDatabase(filename);
    const secondDatabase = new Database(filename);
    const now = 1_000;
    const first = new LibraryWriteCoordinator(firstDatabase, 'library-1', {
      now: () => now,
      newOwnerId: () => 'first-owner',
    });
    const second = new LibraryWriteCoordinator(secondDatabase, 'library-1', {
      now: () => now,
      newOwnerId: () => 'second-owner',
    });

    const firstLease = await first.acquire({ timeoutMs: 0 });
    await expect(second.acquire({ timeoutMs: 0 })).rejects.toMatchObject({
      code: 'LIBRARY_BUSY',
      retryable: true,
    } satisfies Partial<LibraryWriteCoordinatorError>);

    firstLease.release();
    const secondLease = await second.acquire({ timeoutMs: 0 });
    expect(secondLease.ownerId).toBe('second-owner');
    secondLease.release();
    firstDatabase.close();
    secondDatabase.close();
  });

  it('recovers a lease after its persisted deadline and refuses a stale owner renewal', async () => {
    const filename = databasePath();
    const firstDatabase = createDatabase(filename);
    const secondDatabase = new Database(filename);
    let now = 1_000;
    const first = new LibraryWriteCoordinator(firstDatabase, 'library-1', {
      now: () => now,
      newOwnerId: () => 'first-owner',
    });
    const second = new LibraryWriteCoordinator(secondDatabase, 'library-1', {
      now: () => now,
      newOwnerId: () => 'second-owner',
    });

    const firstLease = await first.acquire({ timeoutMs: 0, leaseDurationMs: 25 });
    now += 26;
    const secondLease = await second.acquire({ timeoutMs: 0 });

    expectBusy(() => firstLease.renew());
    expect(secondLease.ownerId).toBe('second-owner');
    secondLease.release();
    firstDatabase.close();
    secondDatabase.close();
  });

  it('increments and reads the persisted change sequence only while its owner still holds the lease', async () => {
    const filename = databasePath();
    const firstDatabase = createDatabase(filename);
    const secondDatabase = new Database(filename);
    const first = new LibraryWriteCoordinator(firstDatabase, 'library-1', {
      newOwnerId: () => 'first-owner',
    });
    const second = new LibraryWriteCoordinator(secondDatabase, 'library-1', {
      newOwnerId: () => 'second-owner',
    });

    const lease = await first.acquire({ timeoutMs: 0 });
    expect(first.currentChangeSequence()).toBe(0);
    expect(lease.bumpChangeSequence()).toBe(1);
    expect(second.currentChangeSequence()).toBe(1);
    lease.release();

    expectBusy(() => lease.bumpChangeSequence());
    firstDatabase.close();
    secondDatabase.close();
  });
});
