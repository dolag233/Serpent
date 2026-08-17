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
    service.openLibrary(manifest.libraryPath);
  }, 120_000);

  afterAll(() => service?.closeAll());

  it('records startup, folder switch, search, Inspector and delete-refresh baselines', () => {
    const startupService = new LibraryService({ observerFactory: () => ({ close() {} }) });
    startupService.closeAll();
    const startupStartedAt = performance.now();
    startupService.openLibrary(manifest.libraryPath);
    const startupMs = performance.now() - startupStartedAt;
    startupService.closeAll();

    const folderSwitchMs = benchmark(() => service.searchAssets({
      libraryId: manifest.libraryId,
      scope: { kind: 'folder', folderId: manifest.sampleFolderId, recursive: true },
      limit: 50,
      offset: 0,
    }));
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
    const inspectorMs = benchmark(() => {
      service.getAssetMetadata({ libraryId: manifest.libraryId, assetId: manifest.sampleAssetId });
      service.listAssetCollectionMemberships({ libraryId: manifest.libraryId, assetIds: [manifest.sampleAssetId] });
    });
    const beforeDelete = service.searchAssets({ libraryId: manifest.libraryId, limit: 50, offset: 0 });
    expect(beforeDelete.total).toBe(manifest.assetCount);

    console.info(JSON.stringify({
      suite: 'large-library-20k',
      assets: manifest.assetCount,
      startupMs: Number(startupMs.toFixed(1)),
      folderSwitchMs: Number(folderSwitchMs.toFixed(1)),
      searchMs: Number(searchMs.toFixed(1)),
      layoutMs: Number(layoutMs.toFixed(1)),
      inspectorMs: Number(inspectorMs.toFixed(1)),
      deleteRefreshMs: null,
      deleteRefreshNote: 'Not exercised by this baseline; Serpent-x710 is explicitly excluded.',
    }));
    expect(searchMs).toBeLessThan(5_000);
    expect(layoutMs).toBeLessThan(5_000);
    expect(folderSwitchMs).toBeLessThan(5_000);
    expect(inspectorMs).toBeLessThan(5_000);
  }, 120_000);
});
