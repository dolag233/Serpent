import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ensureLargeLibraryFixture,
  LARGE_LIBRARY_ASSET_COUNT,
  LARGE_LIBRARY_FIXTURE_VERSION,
  LARGE_LIBRARY_SEARCH_TOKEN,
} from './large-library-fixture';

const outputPath = process.env.SERPENT_LARGE_LIBRARY_OUTPUT;
const assetCount = Number(process.env.SERPENT_LARGE_LIBRARY_ASSETS ?? LARGE_LIBRARY_ASSET_COUNT);
const seed = Number(process.env.SERPENT_LARGE_LIBRARY_SEED ?? 20260815);
const reset = process.env.SERPENT_LARGE_LIBRARY_RESET === '1';

describe.skipIf(!outputPath)('large-library fixture generator', () => {
  it('creates a deterministic, reusable 10k-asset library', () => {
    const manifest = ensureLargeLibraryFixture({ outputPath: outputPath!, assetCount, seed, reset });
    expect(manifest.version).toBe(LARGE_LIBRARY_FIXTURE_VERSION);
    expect(manifest.assetCount).toBe(assetCount);
    expect(manifest.imageCount / assetCount).toBeCloseTo(0.85, 2);
    expect(manifest.videoCount / assetCount).toBeCloseTo(0.10, 2);
    expect(manifest.folderCount).toBeGreaterThanOrEqual(150);
    expect(manifest.collectionCount).toBeGreaterThanOrEqual(50);
    expect(manifest.tagCount).toBeGreaterThanOrEqual(1);
    expect(manifest.searchToken).toBe(LARGE_LIBRARY_SEARCH_TOKEN);
    expect(manifest.searchTokenAssetCount).toBeGreaterThan(0);
    expect(existsSync(manifest.libraryPath)).toBe(true);
    expect(JSON.parse(readFileSync(
      `${manifest.libraryPath}/.serpent/large-library-fixture.json`,
      'utf8',
    ))).toMatchObject({ libraryId: manifest.libraryId, assetCount });
  }, 120_000);
});
