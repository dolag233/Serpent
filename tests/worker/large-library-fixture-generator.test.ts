import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ensureLargeLibraryFixture,
  LARGE_LIBRARY_ASSET_COUNT,
  LARGE_LIBRARY_FIXTURE_VERSION,
  LARGE_LIBRARY_SEARCH_TOKEN,
} from './large-library-fixture';
import { imageOnlyCountsFor, mixCountsFor } from './large-library-mix';

const outputPath = process.env.SERPENT_LARGE_LIBRARY_OUTPUT;
const assetCount = Number(process.env.SERPENT_LARGE_LIBRARY_ASSETS ?? LARGE_LIBRARY_ASSET_COUNT);
const seed = Number(process.env.SERPENT_LARGE_LIBRARY_SEED ?? 20260816);
const reset = process.env.SERPENT_LARGE_LIBRARY_RESET === '1';
const assetProfile = process.env.SERPENT_LARGE_LIBRARY_ASSET_PROFILE === 'images-only'
  ? 'images-only'
  : 'mixed';

describe.skipIf(!outputPath)('large-library fixture generator', () => {
  it('creates a deterministic reusable large library with the selected asset profile', async () => {
    const expected = assetProfile === 'images-only'
      ? imageOnlyCountsFor(assetCount)
      : mixCountsFor(assetCount);
    const manifest = await ensureLargeLibraryFixture({
      outputPath: outputPath!,
      assetCount,
      seed,
      reset,
      assetProfile,
    });
    expect(manifest.version).toBe(LARGE_LIBRARY_FIXTURE_VERSION);
    expect(manifest.assetCount).toBe(assetCount);
    expect(manifest.imageCount).toBe(expected.imageCount);
    expect(manifest.videoCount).toBe(expected.videoCount);
    expect(manifest.modelCount).toBe(expected.modelCount);
    expect(manifest.textCount).toBe(expected.textCount);
    expect(manifest.audioCount).toBe(expected.audioCount);
    expect(manifest.unsupportedCount).toBe(expected.unsupportedCount);
    expect(manifest.assetProfile).toBe(assetProfile);
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
  }, 900_000);
});
