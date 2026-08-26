import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createNetworkReadThroughConnection,
  NetworkMetadataCache,
  networkMetadataCacheKey,
  networkMetadataSourceFingerprintEqual,
  type NetworkMetadataCacheDatabase,
} from '../../src/worker/network-metadata-cache';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots) rmSync(root, { force: true, recursive: true });
  temporaryRoots.length = 0;
});

class FakeStatement {
  constructor(
    private readonly operation: 'read' | 'write',
    private readonly owner: FakeDatabase,
    private readonly sql: string,
  ) {}

  all(): unknown[] {
    this.owner.calls.push(`${this.operation}:all:${this.sql}`);
    return [{ value: this.owner.value }];
  }

  get(): unknown {
    this.owner.calls.push(`${this.operation}:get:${this.sql}`);
    return { value: this.owner.value };
  }

  run(): { changes: number } {
    this.owner.calls.push(`${this.operation}:run:${this.sql}`);
    this.owner.value += 1;
    return { changes: 1 };
  }
}

class FakeDatabase implements NetworkMetadataCacheDatabase {
  readonly calls: string[] = [];
  value = 1;
  closed = false;

  async backup(filename: string): Promise<{ remainingPages: number; totalPages: number }> {
    writeFileSync(filename, 'fake snapshot');
    return { remainingPages: 0, totalPages: 1 };
  }

  close(): void {
    this.closed = true;
  }

  exec(sql: string): void {
    this.calls.push(`exec:${sql}`);
  }

  pragma(source: string): unknown {
    this.calls.push(`pragma:${source}`);
    return source === 'quick_check(1)' ? 'ok' : 0;
  }

  prepare(sql: string): FakeStatement {
    const operation = /^(?:SELECT|EXPLAIN)\b/iu.test(sql.trimStart()) ? 'read' : 'write';
    return new FakeStatement(operation, this, sql);
  }

  transaction<T>(operation: () => T): (() => T) & { immediate(): T } {
    const invoke = (): T => operation();
    const transaction = invoke as (() => T) & { immediate(): T };
    transaction.immediate = invoke;
    return transaction;
  }
}

class QuickCheckFailureDatabase extends FakeDatabase {
  override pragma(source: string): unknown {
    return source === 'quick_check(1)' ? 'not ok' : super.pragma(source);
  }
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-network-cache-test-'));
  temporaryRoots.push(root);
  return root;
}

describe('NetworkMetadataCache', () => {
  it('writes a verified snapshot and uses the change cursor as the cross-open freshness key', async () => {
    const root = temporaryRoot();
    const cache = new NetworkMetadataCache(root);
    const source = new FakeDatabase();
    const cacheKey = networkMetadataCacheKey('/nas/serpent.library');
    const fingerprint = { size: 42, mtimeMs: 1234 };
    const opened: FakeDatabase[] = [];
    const openReadonly = (): FakeDatabase => {
      const connection = new FakeDatabase();
      opened.push(connection);
      return connection;
    };
    const validate = (connection: NetworkMetadataCacheDatabase): void => {
      connection.prepare('SELECT 1').get();
    };

    const created = await cache.createSnapshot({
      cacheKey,
      libraryId: 'library-1',
      schemaVersion: 45,
      sourceChangeSequence: 9,
      sourceFingerprint: fingerprint,
      sourceConnection: source,
      openReadonly,
      validate,
    });

    expect(created.manifest.sourceChangeSequence).toBe(9);
    expect(created.manifest.byteSize).toBeGreaterThan(0);
    expect(readFileSync(created.snapshotPath, 'utf8')).toBe('fake snapshot');
    expect(opened.length).toBeGreaterThan(0);
    created.connection.close();

    const hit = cache.load({
      cacheKey,
      libraryId: 'library-1',
      schemaVersion: 45,
      sourceChangeSequence: 9,
      sourceFingerprint: fingerprint,
      openReadonly,
      validate,
    });
    expect(hit).toBeDefined();
    expect(hit?.fingerprintMatches).toBe(true);
    hit?.connection.close();

    const offlineHit = cache.loadLatest({
      cacheKey,
      openReadonly,
      validate: (connection, manifest) => {
        expect(manifest.libraryId).toBe('library-1');
        validate(connection);
      },
    });
    expect(offlineHit).toBeDefined();
    expect(offlineHit?.fingerprintMatches).toBe(false);
    offlineHit?.connection.close();

    const maintenanceFingerprint = { size: 43, mtimeMs: 5678 };
    expect(networkMetadataSourceFingerprintEqual(fingerprint, fingerprint)).toBe(true);
    expect(networkMetadataSourceFingerprintEqual(fingerprint, maintenanceFingerprint)).toBe(false);
    const sameCursorAfterMaintenance = cache.load({
      cacheKey,
      libraryId: 'library-1',
      schemaVersion: 45,
      sourceChangeSequence: 9,
      sourceFingerprint: maintenanceFingerprint,
      openReadonly,
      validate,
    });
    // SQLite journal/checkpoint maintenance can change the file fingerprint
    // without changing rows; the service handles that fingerprint within the
    // current open generation instead of forcing every reopen cold.
    expect(sameCursorAfterMaintenance).toBeDefined();
    expect(sameCursorAfterMaintenance?.fingerprintMatches).toBe(false);
    sameCursorAfterMaintenance?.connection.close();

    const corrupt = cache.load({
      cacheKey,
      libraryId: 'library-1',
      schemaVersion: 45,
      sourceChangeSequence: 9,
      sourceFingerprint: fingerprint,
      openReadonly: () => new QuickCheckFailureDatabase(),
      validate,
    });
    expect(corrupt).toBeUndefined();

    const stale = cache.load({
      cacheKey,
      libraryId: 'library-1',
      schemaVersion: 45,
      sourceChangeSequence: 10,
      sourceFingerprint: fingerprint,
      openReadonly,
      validate,
    });
    expect(stale).toBeUndefined();
  });

  it('prunes the oldest snapshot while retaining the newly published cache key', async () => {
    const root = temporaryRoot();
    const cache = new NetworkMetadataCache(root, { maxBytes: 13 });
    const openReadonly = (): FakeDatabase => new FakeDatabase();
    const validate = (): void => {};
    const firstKey = networkMetadataCacheKey('/nas/first.library');
    const secondKey = networkMetadataCacheKey('/nas/second.library');
    const create = async (cacheKey: string, libraryId: string) => {
      const snapshot = await cache.createSnapshot({
        cacheKey,
        libraryId,
        schemaVersion: 46,
        sourceChangeSequence: 1,
        sourceFingerprint: { size: 42, mtimeMs: 1234 },
        sourceConnection: new FakeDatabase(),
        openReadonly,
        validate,
      });
      await cache.prune(cacheKey);
      return snapshot;
    };

    const first = await create(firstKey, 'library-first');
    first.connection.close();
    const second = await create(secondKey, 'library-second');
    second.connection.close();

    expect(cache.loadLatest({ cacheKey: firstKey, openReadonly, validate })).toBeUndefined();
    const retained = cache.loadLatest({ cacheKey: secondKey, openReadonly, validate });
    expect(retained).toBeDefined();
    retained?.connection.close();
  });

  it('removes superseded generation files even while the cache is under budget', async () => {
    const root = temporaryRoot();
    const cache = new NetworkMetadataCache(root, { maxBytes: 1024 * 1024 });
    const cacheKey = networkMetadataCacheKey('/nas/generation.library');
    const create = async (sourceChangeSequence: number) => {
      const snapshot = await cache.createSnapshot({
        cacheKey,
        libraryId: 'library-generation',
        schemaVersion: 47,
        sourceChangeSequence,
        sourceFingerprint: { size: 42, mtimeMs: 1234 + sourceChangeSequence },
        sourceConnection: new FakeDatabase(),
        openReadonly: () => new FakeDatabase(),
        validate: () => {},
      });
      await cache.prune(cacheKey);
      return snapshot;
    };

    const first = await create(1);
    first.connection.close();
    const second = await create(2);
    second.connection.close();

    expect(readdirSync(root).filter((file) => file.endsWith('.db'))).toHaveLength(1);
    const latest = cache.loadLatest({
      cacheKey,
      openReadonly: () => new FakeDatabase(),
      validate: () => {},
    });
    expect(latest?.manifest.sourceChangeSequence).toBe(2);
    latest?.connection.close();
  });

  it('rejects a snapshot larger than the configured disposable-cache budget', async () => {
    const root = temporaryRoot();
    const cache = new NetworkMetadataCache(root, { maxBytes: 5 });
    const cacheKey = networkMetadataCacheKey('/nas/oversized.library');

    await expect(cache.createSnapshot({
      cacheKey,
      libraryId: 'library-oversized',
      schemaVersion: 47,
      sourceChangeSequence: 1,
      sourceFingerprint: { size: 42, mtimeMs: 1234 },
      sourceConnection: new FakeDatabase(),
      openReadonly: () => new FakeDatabase(),
      validate: () => {},
    })).rejects.toMatchObject({
      code: 'NETWORK_METADATA_SNAPSHOT_REJECTED',
      reason: 'snapshot-over-budget',
    });
    expect(readdirSync(root).filter((file) => file.endsWith('.db'))).toHaveLength(0);
  });

  it('rolls back the published generation when the final source gate rejects it', async () => {
    const root = temporaryRoot();
    const cache = new NetworkMetadataCache(root);
    const cacheKey = networkMetadataCacheKey('/nas/after-publish.library');
    const create = (sourceChangeSequence: number, afterPublish?: () => boolean) => cache.createSnapshot({
      cacheKey,
      libraryId: 'library-after-publish',
      schemaVersion: 47,
      sourceChangeSequence,
      sourceFingerprint: { size: 42, mtimeMs: 1234 + sourceChangeSequence },
      sourceConnection: new FakeDatabase(),
      openReadonly: () => new FakeDatabase(),
      validate: () => {},
      afterPublish,
    });

    const initial = await create(1);
    initial.connection.close();
    const manifestPath = path.join(root, `${cacheKey}.json`);
    const previousManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      snapshotFile: string;
      sourceChangeSequence: number;
    };

    await expect(create(2, () => false)).rejects.toMatchObject({
      code: 'NETWORK_METADATA_SNAPSHOT_REJECTED',
      reason: 'remote-changed-during-backup',
    });

    const restoredManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      snapshotFile: string;
      sourceChangeSequence: number;
    };
    expect(restoredManifest).toMatchObject(previousManifest);
    expect(readdirSync(root).filter((file) => file.endsWith('.db'))).toEqual([
      previousManifest.snapshotFile,
    ]);
    const restored = cache.loadLatest({
      cacheKey,
      openReadonly: () => new FakeDatabase(),
      validate: () => {},
    });
    expect(restored?.manifest.sourceChangeSequence).toBe(1);
    restored?.connection.close();
  });

  it('serializes concurrent publishers through the shared cache publication lock', async () => {
    const root = temporaryRoot();
    const firstCache = new NetworkMetadataCache(root);
    const secondCache = new NetworkMetadataCache(root);
    const cacheKey = networkMetadataCacheKey('/nas/concurrent-publication.library');
    let releaseFirstGate!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirstGate = resolve;
    });
    let firstAfterPublishStarted!: () => void;
    const firstAfterPublish = new Promise<void>((resolve) => {
      firstAfterPublishStarted = resolve;
    });

    const firstPromise = firstCache.createSnapshot({
      cacheKey,
      libraryId: 'library-concurrent-publication',
      schemaVersion: 47,
      sourceChangeSequence: 1,
      sourceFingerprint: { size: 42, mtimeMs: 1235 },
      sourceConnection: new FakeDatabase(),
      openReadonly: () => new FakeDatabase(),
      validate: () => {},
      afterPublish: async () => {
        firstAfterPublishStarted();
        await firstGate;
        return false;
      },
    });
    await firstAfterPublish;

    let secondSettled = false;
    const secondPromise = secondCache.createSnapshot({
      cacheKey,
      libraryId: 'library-concurrent-publication',
      schemaVersion: 47,
      sourceChangeSequence: 2,
      sourceFingerprint: { size: 42, mtimeMs: 1236 },
      sourceConnection: new FakeDatabase(),
      openReadonly: () => new FakeDatabase(),
      validate: () => {},
    }).then((snapshot) => {
      secondSettled = true;
      return snapshot;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(secondSettled).toBe(false);

    releaseFirstGate();
    await expect(firstPromise).rejects.toMatchObject({
      code: 'NETWORK_METADATA_SNAPSHOT_REJECTED',
      reason: 'remote-changed-during-backup',
    });
    const second = await secondPromise;
    expect(second.manifest.sourceChangeSequence).toBe(2);
    second.connection.close();

    const latest = firstCache.loadLatest({
      cacheKey,
      openReadonly: () => new FakeDatabase(),
      validate: () => {},
    });
    expect(latest?.manifest.sourceChangeSequence).toBe(2);
    latest?.connection.close();
  });

  it('rejects handing off a snapshot after another generation becomes current', async () => {
    const root = temporaryRoot();
    const cache = new NetworkMetadataCache(root);
    const cacheKey = networkMetadataCacheKey('/nas/accept-generation.library');
    const create = (sourceChangeSequence: number) => cache.createSnapshot({
      cacheKey,
      libraryId: 'library-accept-generation',
      schemaVersion: 47,
      sourceChangeSequence,
      sourceFingerprint: { size: 42, mtimeMs: 1234 + sourceChangeSequence },
      sourceConnection: new FakeDatabase(),
      openReadonly: () => new FakeDatabase(),
      validate: () => {},
    });

    const first = await create(1);
    const second = await create(2);
    let staleCallbackCalled = false;
    expect(await cache.acceptSnapshot({
      snapshot: first,
      accept: () => {
        staleCallbackCalled = true;
        return true;
      },
    })).toBe(false);
    expect(staleCallbackCalled).toBe(false);
    expect((first.connection as FakeDatabase).closed).toBe(true);

    expect(await cache.acceptSnapshot({
      snapshot: second,
      accept: (snapshot) => snapshot.connection === second.connection,
    })).toBe(true);
    second.connection.close();
  });
});

describe('network read-through connection', () => {
  it('routes SELECTs to the snapshot and invalidates it at the first write', () => {
    const primary = new FakeDatabase();
    const snapshot = new FakeDatabase();
    const connection = createNetworkReadThroughConnection(primary, snapshot);

    expect(connection.primaryConnection).toBe(primary);
    expect(connection.prepare('SELECT value FROM assets').get()).toEqual({ value: 1 });
    expect(snapshot.calls).toHaveLength(1);
    expect(primary.calls).toHaveLength(0);
    connection.prepare('UPDATE assets SET value = 2').run();
    expect(connection.readCacheActive).toBe(false);
    connection.prepare('SELECT value FROM assets').get();
    expect(primary.calls.some((call) => call.startsWith('write:get'))).toBe(false);
    expect(primary.calls.some((call) => call.startsWith('read:get'))).toBe(true);
    expect(snapshot.closed).toBe(true);
  });

  it('forces all reads inside a transaction to the writable primary', () => {
    const primary = new FakeDatabase();
    const snapshot = new FakeDatabase();
    const connection = createNetworkReadThroughConnection(primary, snapshot);

    connection.transaction(() => {
      connection.prepare('SELECT value FROM assets').get();
      connection.prepare('UPDATE assets SET value = 2').run();
    }).immediate();

    expect(snapshot.calls).toHaveLength(0);
    expect(primary.calls.some((call) => call.startsWith('read:get'))).toBe(true);
    expect(primary.calls.some((call) => call.startsWith('write:run'))).toBe(true);
  });

  it('admits read-only CTEs but keeps data-changing CTEs on the primary', () => {
    const primary = new FakeDatabase();
    const snapshot = new FakeDatabase();
    const connection = createNetworkReadThroughConnection(primary, snapshot);

    connection.prepare('WITH rows AS (SELECT 1) SELECT * FROM rows').all();
    expect(snapshot.calls).toHaveLength(1);
    connection.prepare('WITH rows AS (SELECT 1) UPDATE assets SET value = 2').run();
    expect(primary.calls.some((call) => call.startsWith('write:run'))).toBe(true);

    const commentSnapshot = new FakeDatabase();
    connection.replaceReadConnection(commentSnapshot);
    connection.prepare('WITH rows AS (SELECT 1 /* UPDATE */) SELECT * FROM rows').all();
    expect(commentSnapshot.calls).toHaveLength(1);
    connection.prepare('WITH rows AS (SELECT 1) /* SELECT */ UPDATE assets SET value = 2').run();
    expect(primary.calls.filter((call) => call.startsWith('write:run'))).toHaveLength(2);
  });

  it('keeps volatile table reads on the primary even when the catalog snapshot is active', () => {
    const primary = new FakeDatabase();
    const snapshot = new FakeDatabase();
    const connection = createNetworkReadThroughConnection(primary, snapshot, {
      disallowedSnapshotTables: ['jobs', 'revision_artifacts'],
    });

    connection.prepare('SELECT asset_id FROM assets').all();
    connection.prepare('SELECT job_id FROM jobs').all();
    expect(snapshot.calls).toHaveLength(1);
    expect(primary.calls.some((call) => call.startsWith('read:all:SELECT job_id'))).toBe(true);
  });

  it('keeps unknown catalog tables on the primary with an explicit snapshot allowlist', () => {
    const primary = new FakeDatabase();
    const snapshot = new FakeDatabase();
    const connection = createNetworkReadThroughConnection(primary, snapshot, {
      allowedSnapshotTables: ['assets'],
    });

    connection.prepare('SELECT asset_id FROM assets').all();
    connection.prepare('WITH rows AS (SELECT asset_id FROM assets) SELECT * FROM rows').all();
    connection.prepare('SELECT display_name FROM library').all();
    expect(snapshot.calls).toHaveLength(2);
    expect(primary.calls.some((call) => call.startsWith('read:all:SELECT display_name FROM library'))).toBe(true);
  });

  it('keeps comma joins and derived tables on the primary when they cannot be proven safe', () => {
    const primary = new FakeDatabase();
    const snapshot = new FakeDatabase();
    const connection = createNetworkReadThroughConnection(primary, snapshot, {
      allowedSnapshotTables: ['assets'],
    });

    connection.prepare('SELECT * FROM assets, library').all();
    connection.prepare('SELECT * FROM (SELECT * FROM assets) AS rows').all();
    connection.prepare('SELECT * FROM temp.assets').all();

    expect(snapshot.calls).toHaveLength(0);
    expect(primary.calls).toHaveLength(3);
  });

  it('does not let a prepared statement keep using a replaced snapshot', () => {
    const primary = new FakeDatabase();
    const firstSnapshot = new FakeDatabase();
    const secondSnapshot = new FakeDatabase();
    const connection = createNetworkReadThroughConnection(primary, firstSnapshot);
    const statement = connection.prepare('SELECT value FROM assets');

    statement.get();
    connection.replaceReadConnection(secondSnapshot);
    statement.get();

    expect(firstSnapshot.closed).toBe(true);
    expect(secondSnapshot.calls).toHaveLength(1);
  });
});
