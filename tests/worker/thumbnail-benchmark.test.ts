import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryService,
} from '../../src/worker/library-service';

const temporaryRoots: string[] = [];

// Realistic Pixiv-style large photo (2400x1800 JPEG) and a large PNG with
// alpha — decode + shrink + encode is where a real large library spends its
// thumbnail time, unlike the 1x1 fixture images. Pixel content is
// high-entropy (per-pixel variation), so the JPEG decoder does real work
// like a photograph would.
async function buildSourceAssets(
  sourceDir: string,
  largeCount: number,
): Promise<void> {
  const sharp = (await import('sharp')).default as (input: unknown) => unknown;
  mkdirSync(sourceDir, { recursive: true });
  const width = 2400;
  const height = 1800;
  for (let index = 0; index < largeCount; index += 1) {
    const jpegPath = path.join(sourceDir, `photo-${index}a.jpg`);
    const buffer = Buffer.alloc(width * height * 3);
    const seed = index * 2654435761;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        buffer[offset] = ((x * 7 + y * 13 + seed) % 256) & 0xff;
        buffer[offset + 1] = ((x * 3 + y * 17 + seed) % 256) & 0xff;
        buffer[offset + 2] = ((x * 11 + y * 5 + seed) % 256) & 0xff;
      }
    }
    await (sharp as any)(buffer, {
      raw: { width, height, channels: 3 },
    }).jpeg({ quality: 90 }).toFile(jpegPath);
  }
  for (let index = 0; index < Math.max(4, largeCount / 10); index += 1) {
    const pngPath = path.join(sourceDir, `alpha-${index}a.png`);
    await (sharp as any)({
      create: {
        width: 1600,
        height: 1200,
        channels: 4,
        background: { r: 20, g: 90, b: 200, alpha: 0.5 },
      },
    }).png().toFile(pngPath);
  }
}

function importFolderNoConflict(service: LibraryService, libraryId: string, folderPath: string): void {
  const prepared = service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'folder',
    sourcePaths: [folderPath],
  });
  if ('importId' in prepared) {
    service.resolveImport({
      importId: prepared.importId,
      suspectedDuplicate: 'create-copy',
      nameConflict: 'keep-both',
    });
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    try {
      rmSync(root, { force: true, recursive: true });
    } catch {
      // Cleanup is best-effort.
    }
  }
});

describe.skipIf(process.env.SERPENT_THUMB_BENCH !== '1')('thumbnail generation benchmark (manual, not CI)', () => {
  it('times processThumbnailQueue for a mixed large-image library', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-thumb-bench-'));
    temporaryRoots.push(root);
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Bench', selectedParentPath: root });
    const sourceDir = path.join(root, 'sources');
    await buildSourceAssets(sourceDir, 60);

    const t0 = Date.now();
    importFolderNoConflict(service, created.libraryId, sourceDir);
    const imported = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const importMs = Date.now() - t0;

    const assetCount = imported.length;
    // The import itself enqueued the mutation wave; the benchmark times the
    // queue drain only. Any leftover (none here) is covered by maxJobs.
    const queued = service.enqueueThumbnailJobs(created.libraryId, { limit: 500 });
    expect(queued).toBeGreaterThanOrEqual(0);

    const t1 = Date.now();
    const processed = await service.processThumbnailQueue(created.libraryId, { maxJobs: assetCount });
    const processMs = Date.now() - t1;

    // eslint-disable-next-line no-console
    console.log(
      `[bench] assets=${assetCount} importMs=${importMs} processMs=${processMs} ` +
      `perAssetMs=${(processMs / Math.max(1, processed)).toFixed(1)} processed=${processed}`,
    );
    expect(processed).toBe(assetCount);
    service.closeAll();
  }, 600_000);
});
