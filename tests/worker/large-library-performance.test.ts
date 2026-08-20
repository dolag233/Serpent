import { existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import {
  type LargeLibraryFixtureManifest,
  LARGE_LIBRARY_SEARCH_TOKEN,
} from './large-library-fixture';

const fixturePath = process.env.SERPENT_LARGE_LIBRARY_PERF_PATH;
let manifest: LargeLibraryFixtureManifest;
let service: LibraryService;

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

describe.skipIf(!fixturePath)('20k asset large-library performance baseline', () => {
  beforeAll(() => {
    const manifestFile = `${fixturePath}/.serpent/large-library-fixture.json`;
    if (!existsSync(manifestFile)) throw new Error(`Missing fixture manifest: ${manifestFile}`);
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as LargeLibraryFixtureManifest;
    service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    // Fixture 生成时的 libraryId 与重建后的 DB libraryId 可能不一致
    // （生成器每次 randomUUID）；以打开后 DB 实际 id 为准。
    const opened = service.openLibrary(manifest.libraryPath);
    manifest = { ...manifest, libraryId: opened.libraryId };
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
    const folderSwitchMs = benchmark(() => service.searchAssets({
      libraryId: manifest.libraryId,
      scope: { kind: 'folder', folderId: manifest.sampleFolderId, recursive: false },
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
    // 用 DB 实际 asset（fixture 生成时的 sampleAssetId 基于旧 libraryId）。
    const sampleAssetId = service.searchAssets({ libraryId: manifest.libraryId, limit: 1, offset: 0 }).items[0]?.assetId;
    if (!sampleAssetId) throw new Error('Large-library fixture contains no assets');
    const inspectorMs = benchmark(() => {
      service.getAssetMetadata({ libraryId: manifest.libraryId, assetId: sampleAssetId });
      service.listAssetCollectionMemberships({ libraryId: manifest.libraryId, assetIds: [sampleAssetId] });
    });
    const beforeDelete = service.searchAssets({ libraryId: manifest.libraryId, limit: 50, offset: 0 });
    expect(beforeDelete.total).toBe(manifest.assetCount);

    console.info(JSON.stringify({
      suite: 'large-library-20k',
      assets: manifest.assetCount,
      startupMs: Number(startupMs.toFixed(1)),
      allBrowseMs: Number(allBrowseMs.toFixed(1)),
      folderSwitchMs: Number(folderSwitchMs.toFixed(1)),
      collectionSwitchMs: collectionSwitchMs < 0 ? null : Number(collectionSwitchMs.toFixed(1)),
      collectionRecursiveSwitchMs: collectionRecursiveSwitchMs < 0 ? null : Number(collectionRecursiveSwitchMs.toFixed(1)),
      collectionRecursiveLayoutMs: collectionRecursiveLayoutMs < 0 ? null : Number(collectionRecursiveLayoutMs.toFixed(1)),
      searchMs: Number(searchMs.toFixed(1)),
      layoutMs: Number(layoutMs.toFixed(1)),
      inspectorMs: Number(inspectorMs.toFixed(1)),
      deleteRefreshMs: null,
      deleteRefreshNote: 'Not exercised by this baseline; Serpent-x710 is explicitly excluded.',
    }));
    expect(searchMs).toBeLessThan(5_000);
    expect(layoutMs).toBeLessThan(5_000);
    expect(folderSwitchMs).toBeLessThan(5_000);
    // 合集切换 ≤ 5s 兜底线；真实目标随报告与文件夹同量级（500ms 首屏）。
    if (collectionSwitchMs >= 0) expect(collectionSwitchMs).toBeLessThan(5_000);
    if (collectionRecursiveSwitchMs >= 0) expect(collectionRecursiveSwitchMs).toBeLessThan(5_000);
    if (collectionRecursiveLayoutMs >= 0) expect(collectionRecursiveLayoutMs).toBeLessThan(5_000);
    expect(inspectorMs).toBeLessThan(5_000);
  }, 120_000);
});
