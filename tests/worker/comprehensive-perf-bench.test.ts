import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import {
  type LargeLibraryFixtureManifest,
} from './large-library-fixture';

const fixturePath = process.env.SERPENT_PERF_BENCH_PATH;
let manifest: LargeLibraryFixtureManifest;
let service: LibraryService;

function bench(operation: () => unknown, samples = 5): number {
  operation();
  const times = Array.from({ length: samples }, () => {
    const startedAt = performance.now();
    operation();
    return performance.now() - startedAt;
  });
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

function once(operation: () => unknown): number {
  const startedAt = performance.now();
  operation();
  return performance.now() - startedAt;
}

describe.skipIf(!fixturePath)('comprehensive perf benchmark', () => {
  beforeAll(() => {
    const manifestFile = `${fixturePath}/.serpent/large-library-fixture.json`;
    if (!existsSync(manifestFile)) throw new Error(`Missing manifest: ${manifestFile}`);
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    const opened = service.openLibrary(manifest.libraryPath);
    manifest = { ...manifest, libraryId: opened.libraryId };
  }, 180_000);

  afterAll(() => service?.closeAll());

  it('measures all goal metrics and prints JSON', async () => {
    const libId = { libraryId: manifest.libraryId };
    const results: Record<string, number | string> = {};

    // ── 1. 打开库（冷：新 service 实例）──
    const coldService = new LibraryService({ observerFactory: () => ({ close() {} }) });
    results.openLibraryMs = Number(once(() => {
      coldService.openLibrary(manifest.libraryPath);
    }).toFixed(1));
    coldService.closeAll();

    // 取样资产/文件夹/合集
    const firstPage = service.searchAssets({ ...libId, limit: 50, offset: 0 });
    const sampleIds = firstPage.items.slice(0, 5).map((i) => i.assetId);
    const folders = (service as unknown as { listManagedFolders(l: string): Array<{ folderId: string }> })
      .listManagedFolders(manifest.libraryId);
    const sampleFolderId = folders[1]?.folderId ?? null;
    const collections = service.listCollections(manifest.libraryId);
    const sampleCollectionId = collections[0]?.collectionId;

    // ── 2. 浏览/切换 ──
    results.allBrowseFirstPageMs = Number(bench(() => service.searchAssets({
      ...libId, limit: 50, offset: 0 })).toFixed(2));
    if (sampleFolderId) {
      results.folderSwitchMs = Number(bench(() => service.searchAssets({
        ...libId, scope: { kind: 'folder', folderId: sampleFolderId, recursive: false },
        limit: 50, offset: 0 })).toFixed(2));
      results.folderSwitchRecursiveMs = Number(bench(() => service.searchAssets({
        ...libId, scope: { kind: 'folder', folderId: sampleFolderId, recursive: true },
        limit: 50, offset: 0 })).toFixed(2));
    }
    if (sampleCollectionId) {
      results.collectionSwitchMs = Number(bench(() => service.searchAssets({
        ...libId, scope: { kind: 'collection', collectionId: sampleCollectionId, recursive: false },
        limit: 50, offset: 0 })).toFixed(2));
      results.collectionRecursiveSwitchMs = Number(bench(() => service.searchAssets({
        ...libId, scope: { kind: 'collection', collectionId: sampleCollectionId, recursive: true },
        limit: 50, offset: 0 })).toFixed(2));
    }

    // ── 3. 深分页（滚动跳转）──
    results.deepOffsetPageMs = Number(bench(() => service.searchAssets({
      ...libId, limit: 50, offset: 10000 })).toFixed(2));

    // ── 4. layoutOnly（瀑布流几何）──
    results.layoutOnlyMs = Number(bench(() => service.searchAssets({
      ...libId, layoutOnly: true }), 3).toFixed(2));

    // ── 5. 搜索 ──
    results.searchFixedTokenMs = Number(bench(() => service.searchAssets({
      ...libId,
      query: { clauses: [{ field: null, values: ['asset'], exclude: false }] },
      limit: 50, offset: 0 })).toFixed(2));

    // ── 6. 排序变体 ──
    results.sortNameAscMs = Number(bench(() => service.searchAssets({
      ...libId, sort: { field: 'name', order: 'asc' }, limit: 50, offset: 0 })).toFixed(2));
    results.sortCreatedAtDescMs = Number(bench(() => service.searchAssets({
      ...libId, sort: { field: 'created_at', order: 'desc' }, limit: 50, offset: 0 })).toFixed(2));
    results.sortModifiedDescMs = Number(bench(() => service.searchAssets({
      ...libId, sort: { field: 'modified_at', order: 'desc' }, limit: 50, offset: 0 })).toFixed(2));
    results.sortByteSizeDescMs = Number(bench(() => service.searchAssets({
      ...libId, sort: { field: 'byte_size', order: 'desc' }, limit: 50, offset: 0 })).toFixed(2));
    results.sortRatingDescMs = Number(bench(() => service.searchAssets({
      ...libId, sort: { field: 'rating', order: 'desc' }, limit: 50, offset: 0 })).toFixed(2));

    // ── 7. 筛选 ──
    results.filterRatingMs = Number(bench(() => service.searchAssets({
      ...libId, filters: [{ field: 'rating', values: ['3', '4', '5'], exclude: false }],
      limit: 50, offset: 0 })).toFixed(2));

    // ── 8. Inspector 元数据 ──
    results.inspectorMetadataMs = Number(bench(() => {
      service.getAssetMetadata({ ...libId, assetId: sampleIds[0]! });
      service.listAssetCollectionMemberships({ ...libId, assetIds: [sampleIds[0]!] });
    }).toFixed(2));

    // ── 9. 侧栏 ──
    const svc = service as unknown as {
      listManagedFolders(l: string, showIgnored?: boolean): unknown[];
    };
    results.sidebarListFoldersMs = Number(bench(() =>
      svc.listManagedFolders(manifest.libraryId)).toFixed(2));
    results.sidebarListCollectionsMs = Number(bench(() =>
      service.listCollections(manifest.libraryId)).toFixed(2));

    // ── 10. 删除路径（trash 5 个 → trash 2 个新的 → 恢复全部 → 永久删除）──
    // 每次 trash 使用互不重叠的资产，避免二次删除已删资产触发 INVALID_IMPORT_DECISION
    const deleteBatchA = firstPage.items.slice(10, 15).map((i) => i.assetId); // 5 个
    const deleteBatchB = firstPage.items.slice(15, 17).map((i) => i.assetId); // 2 个
    results.trashFiveAssetsMs = Number(once(() =>
      service.trashSelection({
        libraryId: manifest.libraryId,
        assetIds: deleteBatchA,
        folderIds: [],
        source: 'desktop',
      })).toFixed(1));
    results.trashTwoAssetsMs = Number(once(() =>
      service.trashSelection({
        libraryId: manifest.libraryId,
        assetIds: deleteBatchB,
        folderIds: [],
        source: 'desktop',
      })).toFixed(1));

    // 恢复（trash 过的 7 个）
    const svcRestore = service as unknown as {
      restoreAssets(input: { libraryId: string; assetIds: string[] }): unknown;
    };
    const trashedAll = [...deleteBatchA, ...deleteBatchB];
    results.restoreSevenAssetsMs = Number(once(() =>
      svcRestore.restoreAssets({ libraryId: manifest.libraryId, assetIds: trashedAll }))
        .toFixed(1));

    // 再次 trash 后永久删除同一批
    service.trashSelection({ libraryId: manifest.libraryId, assetIds: trashedAll, folderIds: [], source: 'desktop' });
    const svcPermanent = service as unknown as {
      deleteAssetsPermanent(input: { libraryId: string; assetIds: string[] }): unknown;
    };
    results.deletePermanentSevenAssetsMs = Number(once(() =>
      svcPermanent.deleteAssetsPermanent({ libraryId: manifest.libraryId, assetIds: trashedAll }))
        .toFixed(1));

    // ── 11. rating 写入 ──
    const svcRating = service as unknown as {
      setAssetsRating(input: { libraryId: string; assetIds: string[]; rating: number }): unknown;
    };
    results.setRatingFiveAssetsMs = Number(once(() =>
      svcRating.setAssetsRating({ libraryId: manifest.libraryId, assetIds: sampleIds, rating: 4 }))
        .toFixed(1));

    // ── 12. 合集资产重排（goal 指标：资产重新排列）──
    if (sampleCollectionId) {
      const members = service.listCollectionAssets({
        ...libId,
        collectionId: sampleCollectionId,
        recursive: false,
      }).slice(0, 100);
      const memberIds = members.map((m) => m.assetId);
      if (memberIds.length >= 2) {
        const reordered = [...memberIds].reverse();
        results.collectionReorderAllMs = Number(once(() =>
          (service as unknown as {
            reorderCollectionAssets(input: { libraryId: string; collectionId: string; orderedAssetIds: string[] }): unknown;
          }).reorderCollectionAssets({
            libraryId: manifest.libraryId,
            collectionId: sampleCollectionId,
            orderedAssetIds: reordered,
          })).toFixed(2));
      }
    }

    // ── 13. 导入准备+放弃（goal 指标：添加文件；不落盘，保持 fixture 干净）──
    const fsSync = await import('node:fs');
    const osSync = await import('node:os');
    const pathMod = await import('node:path');
    const importStaging = fsSync.mkdtempSync(pathMod.join(osSync.tmpdir(), 'serpent-import-probe-'));
    for (let i = 0; i < 5; i++) {
      fsSync.writeFileSync(pathMod.join(importStaging, `probe-import-${i}.jpg`), Buffer.alloc(4096, i));
    }
    const svcImport = service as unknown as {
      prepareImport(input: { libraryId: string; sourceKind: string; sourcePaths: string[] }): { importId: string };
      abandonImport(importId: string): unknown;
    };
    results.importPrepareFiveFilesMs = Number(once(() => {
      const plan = svcImport.prepareImport({
        libraryId: manifest.libraryId,
        sourceKind: 'files',
        sourcePaths: [importStaging],
      });
      svcImport.abandonImport(plan.importId);
    }).toFixed(2));
    fsSync.rmSync(importStaging, { recursive: true, force: true });

    console.info(`PERF_BENCH_JSON ${JSON.stringify({ suite: 'comprehensive-20k', assets: manifest.assetCount, ...results })}`);
    expect(results.allBrowseFirstPageMs).toBeGreaterThan(0);
  }, 300_000);
});
