import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import {
  type LargeLibraryFixtureManifest,
  LARGE_LIBRARY_SEARCH_TOKEN,
} from './large-library-fixture';

const fixturePath = process.env.SERPENT_LARGE_LIBRARY_PERF_PATH;
let manifest: LargeLibraryFixtureManifest;
let service: LibraryService;
let initialLiveAssetCount = 0;

function benchmark(operation: () => unknown): number {
  operation();
  const samples = Array.from({ length: 3 }, () => {
    const startedAt = performance.now();
    operation();
    return performance.now() - startedAt;
  });
  samples.sort((left, right) => left - right);
  return samples[1]!;
}

function percentile(samples: number[], percentileValue: number): number {
  if (samples.length === 0) return 0;
  const ordered = samples.toSorted((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * percentileValue) - 1),
  );
  return ordered[index]!;
}

function isCatalogBrowseStatement(sql: string): boolean {
  return sql.includes('SELECT COUNT(*) AS total FROM assets a')
    || /SELECT a\.asset_id,\s*a\.location_kind/u.test(sql);
}

function measureBrowseSamples(
  service: LibraryService,
  libraryId: string,
  trace: string[],
): { samples: number[]; primaryBrowseStatements: number[] } {
  service.searchAssets({ libraryId, limit: 50, offset: 0 });
  const samples: number[] = [];
  const primaryBrowseStatements: number[] = [];
  for (let index = 0; index < 7; index += 1) {
    trace.length = 0;
    const startedAt = performance.now();
    service.searchAssets({ libraryId, limit: 50, offset: 0 });
    samples.push(performance.now() - startedAt);
    primaryBrowseStatements.push(trace.filter(isCatalogBrowseStatement).length);
  }
  return { samples, primaryBrowseStatements };
}

async function measureReconciliationWithViewer(
  operation: () => Promise<void>,
  viewerOperations: Array<() => Promise<unknown>>,
): Promise<{
  elapsedMs: number;
  eventLoopLagP95Ms: number;
  eventLoopLagMaxMs: number;
  viewerP50Ms: number;
  viewerP95Ms: number;
  viewerMaxMs: number;
  viewerSamples: number;
}> {
  const eventLoopLagSamples: number[] = [];
  const viewerLatencySamples: number[] = [];
  const pendingViewerRequests = new Set<Promise<void>>();
  const intervalMs = 5;
  let previousTick = performance.now();
  const eventLoopTimer = setInterval(() => {
    const now = performance.now();
    eventLoopLagSamples.push(Math.max(0, now - previousTick - intervalMs));
    previousTick = now;
  }, intervalMs);
  let viewerIndex = 0;
  let stopped = false;
  const issueViewerRequest = (): void => {
    if (stopped) return;
    const request = viewerOperations[viewerIndex % viewerOperations.length]!;
    viewerIndex += 1;
    const startedAt = performance.now();
    const pending = request()
      .catch(() => undefined)
      .then(() => {
        viewerLatencySamples.push(performance.now() - startedAt);
      });
    pendingViewerRequests.add(pending);
    void pending.finally(() => pendingViewerRequests.delete(pending));
  };
  issueViewerRequest();
  const viewerTimer = setInterval(issueViewerRequest, 25);
  const startedAt = performance.now();
  try {
    await operation();
  } finally {
    stopped = true;
    clearInterval(viewerTimer);
    clearInterval(eventLoopTimer);
    await Promise.all([...pendingViewerRequests]);
  }
  return {
    elapsedMs: performance.now() - startedAt,
    eventLoopLagP95Ms: percentile(eventLoopLagSamples, 0.95),
    eventLoopLagMaxMs: Math.max(...eventLoopLagSamples, 0),
    viewerP50Ms: percentile(viewerLatencySamples, 0.5),
    viewerP95Ms: percentile(viewerLatencySamples, 0.95),
    viewerMaxMs: Math.max(...viewerLatencySamples, 0),
    viewerSamples: viewerLatencySamples.length,
  };
}

function openBaselineService(): void {
  service = new LibraryService({ observerFactory: () => ({ close() {} }) });
  // Fixture 生成时的 libraryId 与重建后的 DB libraryId 可能不一致
  // （生成器每次 randomUUID）；以打开后 DB 实际 id 为准。
  const opened = service.openLibrary(manifest.libraryPath);
  manifest = { ...manifest, libraryId: opened.libraryId };
  initialLiveAssetCount = service.searchAssets({
    libraryId: opened.libraryId,
    limit: 1,
    offset: 0,
  }).total;
}

describe.skipIf(!fixturePath)('20k asset large-library performance baseline', () => {
  beforeAll(() => {
    const manifestFile = `${fixturePath}/.serpent/large-library-fixture.json`;
    if (!existsSync(manifestFile)) throw new Error(`Missing fixture manifest: ${manifestFile}`);
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as LargeLibraryFixtureManifest;
    openBaselineService();
  }, 120_000);

  afterAll(() => service?.closeAll());

  it('records startup, folder switch, search, Inspector and delete-refresh baselines', () => {
    const startupService = new LibraryService({ observerFactory: () => ({ close() {} }) });
    startupService.closeAll();
    const startupStartedAt = performance.now();
    startupService.openLibrary(manifest.libraryPath);
    const startupMs = performance.now() - startupStartedAt;
    startupService.closeAll();

    // Serpent-6355d7: keep the all-scope baseline separate from a real folder
    // scope so collection switching has a like-for-like navigation reference.
    const allBrowseMs = benchmark(() => service.searchAssets({
      libraryId: manifest.libraryId,
      limit: 50,
      offset: 0,
    }));
    const sampleFolderId = service.listManagedFolders(manifest.libraryId)[0]?.folderId;
    const folderSwitchMs = sampleFolderId === undefined
      ? -1
      : benchmark(() => service.searchAssets({
          libraryId: manifest.libraryId,
          scope: { kind: 'folder', folderId: sampleFolderId, recursive: false },
          limit: 50,
          offset: 0,
        }));
    // 合集切换（非递归 + 递归，递归含子合集范围）。
    const firstCollectionId = service.listCollections(manifest.libraryId)[0]?.collectionId;
    let collectionSwitchMs = -1;
    let collectionRecursiveSwitchMs = -1;
    let collectionRecursiveLayoutMs = -1;
    if (firstCollectionId) {
      collectionSwitchMs = benchmark(() => service.searchAssets({
        libraryId: manifest.libraryId,
        scope: { kind: 'collection', collectionId: firstCollectionId, recursive: false },
        limit: 50,
        offset: 0,
      }));
      collectionRecursiveLayoutMs = benchmark(() => service.searchAssets({
        libraryId: manifest.libraryId,
        scope: { kind: 'collection', collectionId: firstCollectionId, recursive: true },
        layoutOnly: true,
      }));
      collectionRecursiveSwitchMs = benchmark(() => service.searchAssets({
        libraryId: manifest.libraryId,
        scope: { kind: 'collection', collectionId: firstCollectionId, recursive: true },
        limit: 50,
        offset: 0,
      }));
    }
    const searchMs = benchmark(() => service.searchAssets({
      libraryId: manifest.libraryId,
      query: { clauses: [{ field: null, values: [LARGE_LIBRARY_SEARCH_TOKEN], exclude: false }] },
      limit: 50,
      offset: 0,
    }));
    const layoutMs = benchmark(() => service.searchAssets({
      libraryId: manifest.libraryId,
      layoutOnly: true,
    }));
    // Stage C: the ordered BrowseSession is the shared source for later page,
    // geometry and select-all reads. Keep these timings beside the historical
    // raw-search baseline so a future optimization cannot silently regress to
    // rebuilding the scope for every scrollbar jump.
    const sessionOpenMs = benchmark(() => service.createBrowseSession({
      libraryId: manifest.libraryId,
      libraryGeneration: 1,
      query: null,
      sort: { field: 'name', order: 'asc' },
      limit: 50,
    }));
    const sessionForBenchmark = service.createBrowseSession({
      libraryId: manifest.libraryId,
      libraryGeneration: 1,
      query: null,
      sort: { field: 'name', order: 'asc' },
      limit: 50,
    });
    const sessionOffset = initialLiveAssetCount > 100 ? 100 : 0;
    const sessionPageMs = benchmark(() => service.readBrowseSessionPage({
      libraryId: manifest.libraryId,
      libraryGeneration: 1,
      sessionId: sessionForBenchmark.session.sessionId,
      limit: 50,
      offset: sessionOffset,
    }));
    const sessionGeometryMs = benchmark(() => service.readBrowseSessionGeometry({
      libraryId: manifest.libraryId,
      libraryGeneration: 1,
      sessionId: sessionForBenchmark.session.sessionId,
      startIndex: sessionOffset,
      limit: 128,
    }));
    const navigationColdStartedAt = performance.now();
    service.getLibraryNavigationSummary({
      libraryId: manifest.libraryId,
      showIgnored: false,
      includeTrashedFolders: false,
    });
    const navigationInitialMs = performance.now() - navigationColdStartedAt;
    const navigationWarmMs = benchmark(() => service.getLibraryNavigationSummary({
      libraryId: manifest.libraryId,
      showIgnored: false,
      includeTrashedFolders: false,
    }));
    // 用 DB 实际 asset（fixture 生成时的 sampleAssetId 基于旧 libraryId）。
    const sampleAssetId = service.searchAssets({ libraryId: manifest.libraryId, limit: 1, offset: 0 }).items[0]?.assetId;
    if (!sampleAssetId) throw new Error('Large-library fixture contains no assets');
    const inspectorMs = benchmark(() => {
      service.getAssetMetadata({ libraryId: manifest.libraryId, assetId: sampleAssetId });
      service.listAssetCollectionMemberships({ libraryId: manifest.libraryId, assetIds: [sampleAssetId] });
    });
    const beforeDelete = service.searchAssets({ libraryId: manifest.libraryId, limit: 50, offset: 0 });
    expect(beforeDelete.total).toBe(initialLiveAssetCount);

    console.info(JSON.stringify({
      suite: `large-library-${manifest.assetCount}`,
      targetAssets: manifest.assetCount,
      liveAssets: initialLiveAssetCount,
      startupMs: Number(startupMs.toFixed(1)),
      allBrowseMs: Number(allBrowseMs.toFixed(1)),
      folderSwitchMs: Number(folderSwitchMs.toFixed(1)),
      collectionSwitchMs: collectionSwitchMs < 0 ? null : Number(collectionSwitchMs.toFixed(1)),
      collectionRecursiveSwitchMs: collectionRecursiveSwitchMs < 0 ? null : Number(collectionRecursiveSwitchMs.toFixed(1)),
      collectionRecursiveLayoutMs: collectionRecursiveLayoutMs < 0 ? null : Number(collectionRecursiveLayoutMs.toFixed(1)),
      searchMs: Number(searchMs.toFixed(1)),
      layoutMs: Number(layoutMs.toFixed(1)),
      browseSessionOpenMs: Number(sessionOpenMs.toFixed(1)),
      browseSessionPageMs: Number(sessionPageMs.toFixed(1)),
      browseSessionGeometryMs: Number(sessionGeometryMs.toFixed(1)),
      navigationSummaryInitialMs: Number(navigationInitialMs.toFixed(1)),
      navigationSummaryWarmMs: Number(navigationWarmMs.toFixed(1)),
      inspectorMs: Number(inspectorMs.toFixed(1)),
      deleteRefreshMs: null,
      deleteRefreshNote: 'Not exercised by this baseline; Serpent-x710 is explicitly excluded.',
    }));
    expect(searchMs).toBeLessThan(5_000);
    expect(layoutMs).toBeLessThan(5_000);
    if (folderSwitchMs >= 0) expect(folderSwitchMs).toBeLessThan(5_000);
    // 合集切换 ≤ 5s 兜底线；真实目标随报告与文件夹同量级（500ms 首屏）。
    if (collectionSwitchMs >= 0) expect(collectionSwitchMs).toBeLessThan(5_000);
    if (collectionRecursiveSwitchMs >= 0) expect(collectionRecursiveSwitchMs).toBeLessThan(5_000);
    if (collectionRecursiveLayoutMs >= 0) expect(collectionRecursiveLayoutMs).toBeLessThan(5_000);
    expect(sessionOpenMs).toBeLessThan(5_000);
    expect(sessionPageMs).toBeLessThan(5_000);
    expect(sessionGeometryMs).toBeLessThan(5_000);
    expect(navigationInitialMs).toBeLessThan(5_000);
    expect(navigationWarmMs).toBeLessThan(5_000);
    expect(inspectorMs).toBeLessThan(5_000);
  }, 120_000);

  it('records the 20k remote metadata cache cold/hot browse baseline', async () => {
    expect(manifest.assetCount).toBeGreaterThanOrEqual(20_000);
    // better-sqlite3 deliberately serializes PRAGMA journal setup with other
    // writers. This benchmark needs exclusive ownership of the fixture while
    // it opens the network-mode services; restore the baseline service in the
    // finally block for the viewer-responsiveness test that follows.
    service.closeAll();
    const benchmarkRoot = mkdtempSync(path.join(tmpdir(), 'serpent-network-metadata-20k-'));
    const cacheDirectory = path.join(benchmarkRoot, 'cache');
    const uncachedDirectory = path.join(benchmarkRoot, 'uncached');
    let builder: LibraryService | undefined;
    let remote: LibraryService | undefined;
    let cached: LibraryService | undefined;
    const rssBefore = process.memoryUsage().rss;
    try {
      builder = new LibraryService({
        networkMetadataCacheDirectory: cacheDirectory,
        networkScanIntervalMs: 0,
        storageKindOverrideForTests: 'network',
        observerFactory: () => ({ close() {} }),
      });
      const builderOpen = builder.openLibrary(manifest.libraryPath);
      const snapshotStartedAt = performance.now();
      await builder.runOpenBackgroundReconciliation(builderOpen.libraryId);
      const snapshotBuildMs = performance.now() - snapshotStartedAt;
      builder.closeAll();
      builder = undefined;

      const remoteTrace: string[] = [];
      remote = new LibraryService({
        networkMetadataCacheDirectory: uncachedDirectory,
        networkScanIntervalMs: 0,
        storageKindOverrideForTests: 'network',
        observerFactory: () => ({ close() {} }),
        onDbStatement: (sql) => remoteTrace.push(sql),
      });
      const remoteOpenStartedAt = performance.now();
      const remoteOpen = remote.openLibrary(manifest.libraryPath);
      const remoteOpenMs = performance.now() - remoteOpenStartedAt;
      const remoteSamples = measureBrowseSamples(remote, remoteOpen.libraryId, remoteTrace);
      const rssAfterRemote = process.memoryUsage().rss;

      const cachedTrace: string[] = [];
      const cachedEvents: string[] = [];
      cached = new LibraryService({
        networkMetadataCacheDirectory: cacheDirectory,
        networkScanIntervalMs: 0,
        storageKindOverrideForTests: 'network',
        observerFactory: () => ({ close() {} }),
        onDbStatement: (sql) => cachedTrace.push(sql),
        onNetworkMetadataCacheEvent: (event) => cachedEvents.push(event.type),
      });
      const cachedOpenStartedAt = performance.now();
      const cachedOpen = cached.openLibrary(manifest.libraryPath);
      const cachedOpenMs = performance.now() - cachedOpenStartedAt;
      const cachedSamples = measureBrowseSamples(cached, cachedOpen.libraryId, cachedTrace);
      const rssAfterCached = process.memoryUsage().rss;

      const cachedBrowseStatements = cachedSamples.primaryBrowseStatements;
      console.info(`NETWORK_METADATA_CACHE_20K_PERF_JSON ${JSON.stringify({
        targetAssets: manifest.assetCount,
        liveAssets: initialLiveAssetCount,
        snapshotBuildMs: Number(snapshotBuildMs.toFixed(1)),
        remoteOpenMs: Number(remoteOpenMs.toFixed(1)),
        cachedOpenMs: Number(cachedOpenMs.toFixed(1)),
        remoteBrowseP50Ms: Number(percentile(remoteSamples.samples, 0.5).toFixed(1)),
        remoteBrowseP95Ms: Number(percentile(remoteSamples.samples, 0.95).toFixed(1)),
        remoteBrowseMaxMs: Number(Math.max(...remoteSamples.samples).toFixed(1)),
        cachedBrowseP50Ms: Number(percentile(cachedSamples.samples, 0.5).toFixed(1)),
        cachedBrowseP95Ms: Number(percentile(cachedSamples.samples, 0.95).toFixed(1)),
        cachedBrowseMaxMs: Number(Math.max(...cachedSamples.samples).toFixed(1)),
        remoteBrowseStatements: remoteSamples.primaryBrowseStatements,
        cachedBrowseStatements,
        cachedHit: cachedEvents.includes('hit'),
        rssBeforeMiB: Number((rssBefore / 1024 / 1024).toFixed(1)),
        rssAfterRemoteMiB: Number((rssAfterRemote / 1024 / 1024).toFixed(1)),
        rssAfterCachedMiB: Number((rssAfterCached / 1024 / 1024).toFixed(1)),
      })}`);
      expect(remoteSamples.primaryBrowseStatements.every((count) => count > 0)).toBe(true);
      expect(cachedSamples.primaryBrowseStatements.every((count) => count === 0)).toBe(true);
      expect(cachedEvents.includes('hit')).toBe(true);
    } finally {
      cached?.closeAll();
      remote?.closeAll();
      builder?.closeAll();
      rmSync(benchmarkRoot, { recursive: true, force: true });
      openBaselineService();
    }
  }, 300_000);

  it('keeps viewer requests responsive during the complete open reconciliation', async () => {
    const sampleAssets = service.searchAssets({
      libraryId: manifest.libraryId,
      limit: 500,
      offset: 0,
    }).items;
    const imageAsset = sampleAssets.find((asset) => asset.mediaType === 'image')
      ?? sampleAssets[0];
    const nonImageAsset = sampleAssets.find((asset) => asset.mediaType !== 'image')
      ?? sampleAssets[0];
    if (!imageAsset || !nonImageAsset) throw new Error('Large-library fixture contains no sample assets');

    const measured = await measureReconciliationWithViewer(
      () => service.runOpenBackgroundReconciliation(manifest.libraryId),
      [
        () => service.resolvePreviewArtifact(manifest.libraryId, imageAsset.assetId),
        () => service.resolvePreviewArtifact(manifest.libraryId, nonImageAsset.assetId),
      ],
    );
    const liveAssets = service.searchAssets({
      libraryId: manifest.libraryId,
      limit: 1,
      offset: 0,
    }).total;
    const result = {
      suite: `large-library-${manifest.assetCount}-reconciliation-viewer`,
      targetAssets: manifest.assetCount,
      liveAssets: initialLiveAssetCount,
      reconciliationMs: Number(measured.elapsedMs.toFixed(1)),
      eventLoopLagP95Ms: Number(measured.eventLoopLagP95Ms.toFixed(1)),
      eventLoopLagMaxMs: Number(measured.eventLoopLagMaxMs.toFixed(1)),
      viewerResolveP50Ms: Number(measured.viewerP50Ms.toFixed(1)),
      viewerResolveP95Ms: Number(measured.viewerP95Ms.toFixed(1)),
      viewerResolveMaxMs: Number(measured.viewerMaxMs.toFixed(1)),
      viewerSamples: measured.viewerSamples,
      imageAssetId: imageAsset.assetId,
      nonImageAssetId: nonImageAsset.assetId,
    };
    console.info(JSON.stringify(result));

    // These are regression gates for the Worker starvation failure mode, not
    // claims that a NAS can read a multi-gigabyte source in 500ms. The source
    // bytes are intentionally not read by this Worker-layer benchmark; the
    // browser E2E benchmark owns decode/paint timing.
    expect(liveAssets).toBe(initialLiveAssetCount);
    expect(measured.viewerSamples).toBeGreaterThanOrEqual(3);
    expect(measured.eventLoopLagP95Ms).toBeLessThan(25);
    expect(measured.eventLoopLagMaxMs).toBeLessThan(150);
    expect(measured.viewerP95Ms).toBeLessThan(250);
  }, 300_000);
});
