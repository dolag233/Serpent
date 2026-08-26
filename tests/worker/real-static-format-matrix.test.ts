import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const oiiotoolPath = process.env['SERPENT_REAL_OIIO_PATH'];
const psdFixturePath = process.env['SERPENT_REAL_PSD_PATH'];
const canRun = Boolean(oiiotoolPath && existsSync(oiiotoolPath));
const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-real-static-formats-'));
  temporaryRoots.push(root);
  return root;
}

function runOiiotool(args: string[]): void {
  const result = spawnSync(oiiotoolPath!, args, {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, `${oiiotoolPath} ${args.join(' ')}\n${result.stderr}`).toBe(0);
}

function buildFixtures(sourceRoot: string): string[] {
  mkdirSync(sourceRoot, { recursive: true });
  const paths = ['bmp', 'tiff', 'tga', 'exr', 'ico'].map((extension) => {
    const fixturePath = path.join(sourceRoot, `checker.${extension}`);
    runOiiotool(['--pattern', 'checker', '64x48', '3', '-o', fixturePath]);
    return fixturePath;
  });
  const svgPath = path.join(sourceRoot, 'checker.svg');
  writeFileSync(
    svgPath,
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#245bff"/><circle cx="32" cy="24" r="12" fill="#fff"/></svg>',
  );
  paths.push(svgPath);
  return paths;
}

function processAllJobs(service: LibraryService, libraryId: string): Promise<void> {
  return (async () => {
    while (service.listMediaJobs(libraryId).queued > 0) {
      expect(await service.processThumbnailQueue(libraryId)).toBeGreaterThan(0);
    }
  })();
}

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) {
    // OIIO/SQLite can release a Windows file handle a tick after the final
    // Worker call. Bounded retries keep a transient EPERM from masking a
    // successful decode assertion.
    rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 });
  }
});

/**
 * Opt-in development evidence for the checksum-pinned OIIO binary. It only
 * runs with an explicit path, so a developer's unrelated PATH installation
 * can never be mistaken for the product runtime.
 */
describe.runIf(canRun)('real OIIO static-format matrix', () => {
  it('creates a decoded thumbnail for BMP, TIFF, TGA, EXR, ICO, and SVG', async () => {
    const root = temporaryRoot();
    const sourcePaths = buildFixtures(path.join(root, 'sources'));
    process.env['SERPENT_OIIO_PATH'] = oiiotoolPath;
    const service = new LibraryService();
    try {
      const library = service.createLibrary({ displayName: 'RealStaticFormats', selectedParentPath: root });
      for (const sourcePath of sourcePaths) {
        importNoConflict(service, library.libraryId, sourcePath);
      }

      service.enqueueThumbnailJobs(library.libraryId);
      await processAllJobs(service, library.libraryId);

      for (const asset of service.listAssets({ libraryId: library.libraryId, recursive: true })) {
        const artifact = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail');
        // SVG stays on the Sharp thumbnail route and emits WebP. Ordinary
        // bounded TIFFs use the faster Sharp path; OIIO remains reserved for
        // OIIO-only formats and TIFFs that exceed the Sharp safety admission.
        const displayName = asset.displayName.toLowerCase();
        const expectedMimeType = /\.(?:bmp|ico|exr|tga)$/u.test(displayName)
          ? 'image/png'
          : /\.tiff?$/u.test(displayName)
            ? 'image/jpeg'
            : 'image/webp';
        expect(artifact, asset.displayName).toMatchObject({ status: 'ready', mimeType: expectedMimeType });
        const outputPath = service.getArtifactAbsolutePath(library.libraryId, artifact!.artifactId, 'preview');
        const output = readFileSync(outputPath);
        if (expectedMimeType === 'image/png') {
          expect(output.subarray(0, 8)).toEqual(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          );
        } else if (expectedMimeType === 'image/jpeg') {
          expect(output.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
        } else {
          expect(output.subarray(0, 4)).toEqual(Buffer.from('RIFF'));
          expect(output.subarray(8, 12)).toEqual(Buffer.from('WEBP'));
        }
      }

      for (const asset of service.listAssets({ libraryId: library.libraryId, recursive: true })) {
        const preview = await service.resolvePreviewArtifact(library.libraryId, asset.assetId);
        expect(preview.colorSpace, asset.displayName).toMatchObject({
          source: expect.any(String),
          id: expect.any(String),
          options: expect.arrayContaining([
            expect.objectContaining({ id: 'srgb_texture' }),
          ]),
        });
        if (!asset.displayName.endsWith('.svg')) {
          const viewerArtifact = service.getCurrentArtifact(
            library.libraryId,
            asset.assetId,
            'viewer_image',
          );
          expect(viewerArtifact, asset.displayName).toMatchObject({
            status: 'ready',
            mimeType: 'image/png',
          });
          expect(viewerArtifact!.generatorVersion, asset.displayName).toMatch(/viewer-full|ico-largest|raw-viewer/u);
          expect(preview.artifactId, asset.displayName).toBe(viewerArtifact!.artifactId);
        }
      }

      const svgAsset = service.listAssets({ libraryId: library.libraryId, recursive: true })
        .find((asset) => asset.displayName === 'checker.svg');
      expect(svgAsset).toBeDefined();
      const svgPreview = service.getPreviewArtifact(library.libraryId, svgAsset!.assetId);
      expect(svgPreview).toMatchObject({
        mediaType: 'image',
        status: 'ready',
        playbackMode: 'source',
        sourceMimeType: 'image/svg+xml',
      });
    } finally {
      service.closeAll();
    }
  }, 120_000);

  it.runIf(Boolean(psdFixturePath && existsSync(psdFixturePath)))(
    'creates a composite thumbnail for a PSD without reading layers',
    async () => {
      const root = temporaryRoot();
      const sourcePath = path.join(root, 'sources', 'source.psd');
      mkdirSync(path.dirname(sourcePath), { recursive: true });
      copyFileSync(psdFixturePath!, sourcePath);
      process.env['SERPENT_OIIO_PATH'] = oiiotoolPath;
      const service = new LibraryService();
      const library = service.createLibrary({ displayName: 'RealPsdFormat', selectedParentPath: root });
      importNoConflict(service, library.libraryId, sourcePath);

      service.enqueueThumbnailJobs(library.libraryId);
      await processAllJobs(service, library.libraryId);

      const [asset] = service.listAssets({ libraryId: library.libraryId, recursive: true });
      const artifact = service.getCurrentArtifact(library.libraryId, asset!.assetId, 'thumbnail');
      expect(artifact).toMatchObject({ status: 'ready', mimeType: 'image/png' });
      const preview = await service.resolvePreviewArtifact(library.libraryId, asset!.assetId);
      expect(preview.colorSpace).toMatchObject({
        id: 'adobergb',
        source: 'embedded',
      });
      const srgbPreview = await service.resolvePreviewArtifact(
        library.libraryId,
        asset!.assetId,
        undefined,
        'srgb_texture',
      );
      expect(srgbPreview.colorSpace).toMatchObject({ id: 'srgb_texture' });
      expect(service.setAssetColorSpaceOverride({
        libraryId: library.libraryId,
        assetId: asset!.assetId,
        colorSpace: 'srgb_texture',
      })).toEqual({ assetId: asset!.assetId, colorSpaceOverride: 'srgb_texture' });
      const persistedPreview = await service.resolvePreviewArtifact(
        library.libraryId,
        asset!.assetId,
      );
      expect(persistedPreview.colorSpace).toMatchObject({ id: 'srgb_texture' });
      service.setAssetColorSpaceOverride({
        libraryId: library.libraryId,
        assetId: asset!.assetId,
        colorSpace: null,
      });
      service.closeAll();
    },
    120_000,
  );
});
