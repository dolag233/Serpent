import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { resolveOiiotoolPath } from '../../src/worker/binary-resolver';
import { OIIO_LITERAL_PATHS_MARK } from '../../src/worker/oiio-invocation';

const require = createRequire(import.meta.url);
const roots: string[] = [];
const services: LibraryService[] = [];

function setup(options: ConstructorParameters<typeof LibraryService>[0] = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-oiio-paths-'));
  roots.push(root);
  const parent = path.join(root, '#library-parent');
  const sourceRoot = path.join(root, '#linked');
  mkdirSync(parent);
  mkdirSync(sourceRoot);
  const service = new LibraryService({ observerFactory: () => ({ close() {} }), ...options });
  services.push(service);
  const library = service.createLibrary({ displayName: 'LiteralPaths', selectedParentPath: parent });
  return { root, sourceRoot, service, library };
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(['tga', 'bmp', 'exr'])('decodes linked %s thumbnails and viewer images under # ancestors', async (extension) => {
  const { service, library, sourceRoot } = setup();
  const source = path.join(sourceRoot, `image.${extension}`);
  execFileSync(resolveOiiotoolPath(), ['--wildcardoff', '--pattern', 'checker', '16x8', '3', '-o', source]);
  service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: sourceRoot });
  const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
  await service.generateThumbnail({ libraryId: library.libraryId, assetId: asset.assetId });
  await service.resolvePreviewArtifact(library.libraryId, asset.assetId);
  const sharp = require('sharp');
  for (const kind of ['thumbnail', 'viewer_image']) {
    const artifact = service.getCurrentArtifact(library.libraryId, asset.assetId, kind);
    expect(artifact?.status).toBe('ready');
    expect(artifact?.generatorVersion).toContain(OIIO_LITERAL_PATHS_MARK);
    const decoded = await sharp(path.join(library.libraryPath, '.serpent', 'artifacts', artifact!.filePath))
      .raw().toBuffer({ resolveWithObject: true });
    expect(decoded.info.width).toBeGreaterThan(0);
    expect(decoded.info.height).toBeGreaterThan(0);
    expect(decoded.data.length).toBeGreaterThan(0);
  }
});

it('recovers old # failures once and keeps new-version input failures terminal', async () => {
  const { service, library, sourceRoot } = setup({
    spawnFn: async () => ({ stdout: Buffer.alloc(0), stderr: 'No filenames found matching pattern', exitCode: 1 }),
  });
  writeFileSync(path.join(sourceRoot, 'image.tga'), Buffer.alloc(4096));
  service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: sourceRoot });
  const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
  await expect(service.generateThumbnail({ libraryId: library.libraryId, assetId: asset.assetId })).rejects.toThrow();
  const Database = require('better-sqlite3');
  const database = new Database(path.join(library.libraryPath, '.serpent', 'library.db'));
  try {
    database.prepare('DELETE FROM jobs').run();
    database.prepare("UPDATE revision_artifacts SET generator_version = 'oiio@legacy', error_code = 'OIIO_COLOR_TRANSFORM_FAILED' WHERE kind = 'thumbnail'").run();
    service.enqueueThumbnailJobs(library.libraryId, { assetIds: [asset.assetId], limit: 1, retryFailed: true, skipStaleRepair: true });
    expect(database.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'generate_thumbnail' AND status = 'queued'").get()).toEqual({ n: 1 });
    database.prepare('DELETE FROM jobs').run();
    await expect(service.generateThumbnail({ libraryId: library.libraryId, assetId: asset.assetId })).rejects.toThrow();
    database.prepare("UPDATE revision_artifacts SET generated_at = '2000-01-01T00:00:00.000Z' WHERE status = 'failed'").run();
    service.enqueueThumbnailJobs(library.libraryId, { assetIds: [asset.assetId], limit: 1, retryFailed: true, skipStaleRepair: true });
    expect(database.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'generate_thumbnail' AND status = 'queued'").get()).toEqual({ n: 0 });
    const artifact = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail');
    expect(artifact?.errorCode).toBe('OIIO_GENERATION_FAILED');
    expect(artifact?.generatorVersion).toContain(OIIO_LITERAL_PATHS_MARK);
  } finally {
    database.close();
  }
});
