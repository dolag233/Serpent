import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
  openConfiguredDatabase,
  type LibraryServiceOptions,
} from '../../src/worker/library-service';

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function newNetworkService(
  cacheDirectory: string,
  events: Array<{ type: string; reason?: string }>,
  trace: string[] = [],
  primaryDelayMs = 0,
  extraOptions: Partial<LibraryServiceOptions> = {},
): LibraryService {
  const service = new LibraryService({
    ...extraOptions,
    networkMetadataCacheDirectory: cacheDirectory,
    networkScanIntervalMs: 0,
    storageKindOverrideForTests: 'network',
    observerFactory: () => ({ close() {} }),
    onDbStatement: (sql) => {
      trace.push(sql);
      const deadline = performance.now() + primaryDelayMs;
      while (performance.now() < deadline) {
        // Simulate a bounded per-statement network round trip. This seam is
        // deliberately synthetic; real NAS/SMB latency is reported separately.
      }
    },
    onNetworkMetadataCacheEvent: (event) => events.push(event),
  });
  services.push(service);
  return service;
}

function isCatalogBrowseStatement(sql: string): boolean {
  return sql.includes('SELECT COUNT(*) AS total FROM assets a')
    || /SELECT a\.asset_id,\s*a\.location_kind/u.test(sql);
}

describe('remote library metadata cache', () => {
  it('records a measurable synthetic remote-vs-snapshot browse contrast', async () => {
    const root = temporaryRoot('serpent-network-metadata-perf-');
    const cacheDirectory = path.join(root, 'cache');
    const seedEvents: Array<{ type: string; reason?: string }> = [];
    const seed = newNetworkService(cacheDirectory, seedEvents);
    const library = seed.createLibrary({
      displayName: 'Metadata perf',
      selectedParentPath: root,
    });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'perf.txt'), 'perf');
    seed.refreshManagedAssets(library.libraryId);
    seed.closeLibrary(library.libraryId);

    const builderEvents: Array<{ type: string; reason?: string }> = [];
    const builder = newNetworkService(cacheDirectory, builderEvents);
    const built = builder.openLibrary(library.libraryPath);
    await builder.runOpenBackgroundReconciliation(built.libraryId);
    builder.closeLibrary(built.libraryId);

    const remoteTrace: string[] = [];
    const remote = newNetworkService(
      path.join(root, 'uncached'),
      [],
      remoteTrace,
      4,
    );
    const remoteOpen = remote.openLibrary(library.libraryPath);
    remote.searchAssets({ libraryId: remoteOpen.libraryId, limit: 10, offset: 0 });
    remoteTrace.length = 0;
    const remoteStartedAt = performance.now();
    remote.searchAssets({ libraryId: remoteOpen.libraryId, limit: 10, offset: 0 });
    const remoteElapsedMs = performance.now() - remoteStartedAt;
    const remoteBrowseStatements = remoteTrace.filter(isCatalogBrowseStatement).length;
    remote.closeLibrary(remoteOpen.libraryId);

    const cachedTrace: string[] = [];
    const cachedEvents: Array<{ type: string; reason?: string }> = [];
    const cached = newNetworkService(cacheDirectory, cachedEvents, cachedTrace, 4);
    const cachedOpen = cached.openLibrary(library.libraryPath);
    cached.searchAssets({ libraryId: cachedOpen.libraryId, limit: 10, offset: 0 });
    cachedTrace.length = 0;
    const cachedStartedAt = performance.now();
    cached.searchAssets({ libraryId: cachedOpen.libraryId, limit: 10, offset: 0 });
    const cachedElapsedMs = performance.now() - cachedStartedAt;
    const cachedBrowseStatements = cachedTrace.filter(isCatalogBrowseStatement).length;
    cached.closeLibrary(cachedOpen.libraryId);

    console.info(`NETWORK_METADATA_CACHE_PERF_JSON ${JSON.stringify({
      remoteBrowseStatements,
      cachedBrowseStatements,
      remoteElapsedMs: Number(remoteElapsedMs.toFixed(1)),
      cachedElapsedMs: Number(cachedElapsedMs.toFixed(1)),
      syntheticPrimaryDelayMs: 4,
    })}`);
    expect(remoteBrowseStatements).toBeGreaterThan(0);
    expect(cachedBrowseStatements).toBe(0);
  }, 120_000);

  it('creates a local snapshot, hits it on the next open, and keeps writes remote', async () => {
    const root = temporaryRoot('serpent-network-metadata-');
    const cacheDirectory = path.join(root, 'user-data', 'library-metadata-cache');
    const service = newNetworkService(cacheDirectory, []);
    const library = service.createLibrary({
      displayName: 'Remote metadata',
      selectedParentPath: root,
    });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'remote.txt'), 'remote');
    service.refreshManagedAssets(library.libraryId);
    service.closeLibrary(library.libraryId);

    const firstEvents: Array<{ type: string; reason?: string }> = [];
    const first = newNetworkService(cacheDirectory, firstEvents);
    const opened = first.openLibrary(library.libraryPath);
    await first.runOpenBackgroundReconciliation(opened.libraryId);
    expect(firstEvents.some((event) => event.type === 'refresh-started')).toBe(true);
    expect(firstEvents.some((event) => event.type === 'refreshed')).toBe(true);
    expect(first.listAssets({ libraryId: opened.libraryId, recursive: true })).toHaveLength(1);
    const cacheFiles = existsSync(cacheDirectory)
      ? readdirSync(cacheDirectory)
      : [];
    expect(cacheFiles.some((file) => file.endsWith('.db'))).toBe(true);
    first.closeLibrary(opened.libraryId);

    const secondEvents: Array<{ type: string; reason?: string }> = [];
    const trace: string[] = [];
    const second = newNetworkService(cacheDirectory, secondEvents, trace);
    const reopened = second.openLibrary(library.libraryPath);
    expect(secondEvents.some((event) => event.type === 'hit')).toBe(true);
    const traceBeforeBrowse = trace.length;
    expect(second.searchAssets({
      libraryId: reopened.libraryId,
      limit: 10,
      offset: 0,
    }).items).toHaveLength(1);
    // The browse SELECTs are served by the readonly snapshot, not the traced
    // remote primary connection. This is the concrete read/write split proof.
    expect(trace.slice(traceBeforeBrowse).filter(isCatalogBrowseStatement)).toHaveLength(0);

    second.renameLibrary({ libraryId: reopened.libraryId, displayName: 'Renamed remotely' });
    const traceBeforePrimaryRead = trace.length;
    expect(second.searchAssets({
      libraryId: reopened.libraryId,
      limit: 10,
      offset: 0,
    }).items).toHaveLength(1);
    expect(trace.length).toBeGreaterThan(traceBeforePrimaryRead);
    second.closeLibrary(reopened.libraryId);

    const verification = openConfiguredDatabase(
      path.join(library.libraryPath, '.serpent', 'library.db'),
      5_000,
      { readonly: true },
    );
    try {
      const row = verification.prepare('SELECT display_name FROM library').get() as {
        display_name: string;
      };
      expect(row.display_name).toBe('Renamed remotely');
    } finally {
      verification.close();
    }
  }, 120_000);

  it('opens the last verified snapshot read-only when the network mount is gone', async () => {
    const root = temporaryRoot('serpent-network-metadata-offline-');
    const cacheDirectory = path.join(root, 'cache');
    const seed = newNetworkService(cacheDirectory, []);
    const library = seed.createLibrary({
      displayName: 'Offline metadata',
      selectedParentPath: root,
    });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'offline.txt'), 'offline');
    seed.refreshManagedAssets(library.libraryId);
    seed.closeLibrary(library.libraryId);

    const builder = newNetworkService(cacheDirectory, []);
    const opened = builder.openLibrary(library.libraryPath);
    await builder.runOpenBackgroundReconciliation(opened.libraryId);
    builder.closeLibrary(opened.libraryId);
    rmSync(library.libraryPath, { force: true, recursive: true });

    const events: Array<{ type: string; reason?: string }> = [];
    const offline = newNetworkService(cacheDirectory, events);
    const degraded = offline.openLibrary(library.libraryPath);
    expect(degraded.readOnly).toBe(true);
    expect(degraded.networkStorage).toBe(true);
    expect(offline.searchAssets({
      libraryId: degraded.libraryId,
      limit: 10,
      offset: 0,
    }).items).toHaveLength(1);
    expect(events).toContainEqual({
      type: 'offline',
      libraryId: degraded.libraryId,
      sourceChangeSequence: expect.any(Number),
      reason: 'cached-snapshot-opened',
    });
    expect(() => offline.renameLibrary({
      libraryId: degraded.libraryId,
      displayName: 'Should not write',
    })).toThrow();
  }, 120_000);

  it('invalidates and rebuilds the snapshot after an external writer advances the source', async () => {
    const root = temporaryRoot('serpent-network-metadata-external-');
    const cacheDirectory = path.join(root, 'cache');
    const seedEvents: Array<{ type: string; reason?: string }> = [];
    const seedService = newNetworkService(cacheDirectory, seedEvents);
    const library = seedService.createLibrary({
      displayName: 'External change',
      selectedParentPath: root,
    });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'external.txt'), 'external');
    seedService.refreshManagedAssets(library.libraryId);
    seedService.closeLibrary(library.libraryId);

    const events: Array<{ type: string; reason?: string }> = [];
    const service = newNetworkService(cacheDirectory, events);
    const opened = service.openLibrary(library.libraryPath);
    await service.runOpenBackgroundReconciliation(opened.libraryId);
    expect(events.some((event) => event.type === 'refreshed')).toBe(true);

    const external = openConfiguredDatabase(
      path.join(library.libraryPath, '.serpent', 'library.db'),
      5_000,
      { storageKind: 'network' },
    );
    try {
      external.prepare("UPDATE assets SET availability = 'missing'").run();
    } finally {
      external.close();
    }

    await service.runOpenBackgroundReconciliation(opened.libraryId);
    expect(events.some((event) => event.type === 'stale')).toBe(true);
    expect(events.filter((event) => event.type === 'refreshed').length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('keeps the last verified snapshot when source validation is temporarily unavailable', async () => {
    const root = temporaryRoot('serpent-network-metadata-source-unavailable-');
    const cacheDirectory = path.join(root, 'cache');
    const seed = newNetworkService(cacheDirectory, []);
    const library = seed.createLibrary({
      displayName: 'Source unavailable',
      selectedParentPath: root,
    });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'source.txt'), 'source');
    seed.refreshManagedAssets(library.libraryId);
    seed.closeLibrary(library.libraryId);

    const builder = newNetworkService(cacheDirectory, []);
    const built = builder.openLibrary(library.libraryPath);
    await builder.runOpenBackgroundReconciliation(built.libraryId);
    builder.closeLibrary(built.libraryId);

    const events: Array<{ type: string; reason?: string }> = [];
    const trace: string[] = [];
    const service = newNetworkService(
      cacheDirectory,
      events,
      trace,
      0,
      { networkMetadataSourceStateForTests: () => undefined },
    );
    const opened = service.openLibrary(library.libraryPath);
    expect(events.some((event) => event.type === 'hit')).toBe(true);
    trace.length = 0;
    expect(service.searchAssets({ libraryId: opened.libraryId, limit: 10, offset: 0 }).items)
      .toHaveLength(1);
    expect(trace.filter(isCatalogBrowseStatement)).toHaveLength(0);
    await service.runOpenBackgroundReconciliation(opened.libraryId);
    expect(events).toContainEqual({
      type: 'offline',
      libraryId: opened.libraryId,
      sourceChangeSequence: expect.any(Number),
      reason: 'remote-source-state-unavailable',
    });
  }, 120_000);

  it('does not publish a snapshot made stale by a writer during backup', async () => {
    const root = temporaryRoot('serpent-network-metadata-backup-race-');
    const cacheDirectory = path.join(root, 'cache');
    const seed = newNetworkService(cacheDirectory, []);
    const library = seed.createLibrary({
      displayName: 'Backup race',
      selectedParentPath: root,
    });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'race.txt'), 'race');
    seed.refreshManagedAssets(library.libraryId);
    seed.closeLibrary(library.libraryId);

    const firstBuilder = newNetworkService(cacheDirectory, []);
    const firstOpen = firstBuilder.openLibrary(library.libraryPath);
    await firstBuilder.runOpenBackgroundReconciliation(firstOpen.libraryId);
    firstBuilder.closeLibrary(firstOpen.libraryId);
    const manifestFile = readdirSync(cacheDirectory).find((file) => file.endsWith('.json'));
    if (!manifestFile) throw new Error('Expected a published network metadata manifest.');
    const manifestBefore = JSON.parse(
      readFileSync(path.join(cacheDirectory, manifestFile), 'utf8'),
    ) as { snapshotFile: string };
    const snapshotBeforePath = path.join(cacheDirectory, manifestBefore.snapshotFile);

    const events: Array<{ type: string; reason?: string }> = [];
    let external: ReturnType<typeof openConfiguredDatabase> | undefined;
    let injected = false;
    const racing = newNetworkService(
      cacheDirectory,
      events,
      [],
      0,
      {
        onNetworkMetadataSnapshotProgress: () => {
          if (injected || !external) return;
          injected = true;
          external.prepare("UPDATE assets SET availability = 'available'").run();
        },
      },
    );
    const opened = racing.openLibrary(library.libraryPath);
    external = openConfiguredDatabase(
      path.join(library.libraryPath, '.serpent', 'library.db'),
      5_000,
      { storageKind: 'network' },
    );
    try {
      external.prepare("UPDATE assets SET availability = 'missing'").run();
      await racing.runOpenBackgroundReconciliation(opened.libraryId);
    } finally {
      external.close();
      external = undefined;
    }
    expect(injected).toBe(true);
    expect(events.some((event) => event.type === 'refresh-skipped')).toBe(true);
    const manifestAfter = JSON.parse(
      readFileSync(path.join(cacheDirectory, manifestFile), 'utf8'),
    ) as { snapshotFile: string };
    expect(manifestAfter.snapshotFile).toBe(manifestBefore.snapshotFile);
    expect(existsSync(snapshotBeforePath)).toBe(true);
    expect(readdirSync(cacheDirectory).filter((file) => file.endsWith('.db'))).toHaveLength(1);
  }, 120_000);

  it('advances the browse cursor when ignore materialization changes', () => {
    const root = temporaryRoot('serpent-network-metadata-ignore-cursor-');
    const service = newNetworkService(path.join(root, 'cache'), []);
    const library = service.createLibrary({
      displayName: 'Ignore cursor',
      selectedParentPath: root,
    });
    writeFileSync(path.join(library.libraryPath, 'Assets', 'ignored.txt'), 'ignored');
    service.refreshManagedAssets(library.libraryId);
    const databaseFile = path.join(library.libraryPath, '.serpent', 'library.db');
    const readCursor = (): number => {
      const connection = openConfiguredDatabase(databaseFile, 5_000, { readonly: true });
      try {
        return (connection.prepare(
          'SELECT sequence FROM browse_change_sequence WHERE library_id = ?',
        ).get(library.libraryId) as { sequence: number }).sequence;
      } finally {
        connection.close();
      }
    };

    const before = readCursor();
    service.setGitignore({ libraryId: library.libraryId, content: 'Assets/ignored.txt\n' });
    expect(readCursor()).toBeGreaterThan(before);
  });
});
