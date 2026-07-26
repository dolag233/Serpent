import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const oiiotoolPath = process.env['SERPENT_REAL_OIIO_PATH'];
const rawFixtureDirectory = process.env['SERPENT_REAL_RAW_FIXTURE_DIR'];
const canRun = Boolean(
  oiiotoolPath
  && rawFixtureDirectory
  && existsSync(oiiotoolPath)
  && existsSync(rawFixtureDirectory),
);
const expectedExtensions = ['dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2'] as const;
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-real-raw-formats-'));
  temporaryRoots.push(root);
  return root;
}

function rawFixturePaths(): string[] {
  const available = new Map(
    readdirSync(rawFixtureDirectory!, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => [path.extname(entry.name).slice(1).toLowerCase(), entry.name]),
  );
  const missing = expectedExtensions.filter((extension) => !available.has(extension));
  expect(missing, 'SERPENT_REAL_RAW_FIXTURE_DIR must contain one real file for every MVP RAW extension')
    .toEqual([]);
  return expectedExtensions.map((extension) => path.join(rawFixtureDirectory!, available.get(extension)!));
}

async function processAllJobs(service: LibraryService, libraryId: string): Promise<void> {
  while (service.listMediaJobs(libraryId).queued > 0) {
    expect(await service.processThumbnailQueue(libraryId)).toBeGreaterThan(0);
  }
}

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Opt-in evidence for LibRaw as linked into the checksum-pinned OIIO bundle.
 * Fixtures are deliberately external: camera RAW files are large and their
 * licences vary, so this test never treats a developer's arbitrary PATH
 * installation or unverified sample as product-release evidence.
 */
describe.runIf(canRun)('real LibRaw format matrix', () => {
  it('decodes every MVP camera-RAW extension into a PNG thumbnail', async () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'sources');
    mkdirSync(sourceRoot, { recursive: true });
    const sourcePaths = rawFixturePaths().map((fixturePath) => {
      const destination = path.join(sourceRoot, path.basename(fixturePath));
      copyFileSync(fixturePath, destination);
      return destination;
    });
    process.env['SERPENT_OIIO_PATH'] = oiiotoolPath;
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'RealRawFormats', selectedParentPath: root });
    for (const sourcePath of sourcePaths) {
      importNoConflict(service, library.libraryId, sourcePath);
    }

    service.enqueueThumbnailJobs(library.libraryId);
    await processAllJobs(service, library.libraryId);

    const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    expect(assets).toHaveLength(expectedExtensions.length);
    for (const asset of assets) {
      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail'), asset.displayName)
        .toMatchObject({ status: 'ready', mimeType: 'image/png' });
    }
    service.closeAll();
  }, 300_000);
});
