import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { IMPORTED_THUMBNAIL_NORMALIZATION_JOB } from '../../src/worker/imported-thumbnail-policy';
import { ONE_PX_RED_PNG } from '../fixtures/fbx/ascii-fbx';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-eagle-import-'));
  temporaryRoots.push(root);
  return root;
}

function writeEagleLibrary(
  root: string,
  itemCount: number,
  options: { includeVideo?: boolean } = {},
): string {
  const libraryPath = path.join(root, 'Source.library');
  mkdirSync(path.join(libraryPath, 'images'), { recursive: true });
  writeFileSync(path.join(libraryPath, 'metadata.json'), JSON.stringify({
    folders: [{ id: 'folder-props', name: 'Props', children: [] }],
  }));
  for (let index = 0; index < itemCount; index += 1) {
    const infoName = `item-${String(index).padStart(3, '0')}.info`;
    const infoPath = path.join(libraryPath, 'images', infoName);
    mkdirSync(infoPath, { recursive: true });
    const fileName = `asset-${index}.png`;
    writeFileSync(path.join(infoPath, 'metadata.json'), JSON.stringify({
      id: `item-${index}`,
      name: `asset-${index}`,
      ext: 'png',
      tags: ['props'],
      folders: ['folder-props'],
    }));
    writeFileSync(path.join(infoPath, fileName), ONE_PX_RED_PNG);
    writeFileSync(path.join(infoPath, `asset-${index}_thumbnail.png`), ONE_PX_RED_PNG);
  }
  if (options.includeVideo) {
    const infoPath = path.join(libraryPath, 'images', 'item-video.info');
    mkdirSync(infoPath, { recursive: true });
    writeFileSync(path.join(infoPath, 'metadata.json'), JSON.stringify({
      id: 'item-video',
      name: 'clip',
      ext: 'mp4',
      tags: ['props'],
      folders: ['folder-props'],
    }));
    writeFileSync(path.join(infoPath, 'clip.mp4'), Buffer.from('ftypisom'));
    writeFileSync(path.join(infoPath, 'clip_thumbnail.png'), ONE_PX_RED_PNG);
  }
  return libraryPath;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('Eagle library import', () => {
  it('publishes collections before the first asset batch is copied', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writeEagleLibrary(root, 3);
    const seen: Array<{ collections: number; assets: number }> = [];
    let libraryId = '';
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onProgress: (event) => {
        if (event.type !== 'import.progress' || !libraryId) return;
        if (event.phase !== 'validate' || event.totalFiles === 0) return;
        seen.push({
          collections: service.listCollections(libraryId).length,
          assets: service.listAssets({ libraryId, recursive: true }).length,
        });
      },
    });
    const library = service.createLibrary({
      displayName: 'Target',
      selectedParentPath: root,
    });
    libraryId = library.libraryId;
    const result = await service.importEagleLibrary({
      libraryId: library.libraryId,
      sourceRootPath,
    });
    expect(result.importedCount).toBe(3);
    expect(result.collectionCount).toBe(1);
    expect(seen.some((snapshot) => snapshot.collections >= 1 && snapshot.assets === 0)).toBe(true);
    expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toHaveLength(3);
    service.closeAll();
  });

  it('cancels between batches and leaves already imported assets', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writeEagleLibrary(root, 160);
    let importId: string | undefined;
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onProgress: (event) => {
        if (event.type !== 'import.progress') return;
        importId = event.importId;
        if (event.phase === 'copy' && event.filesProcessed >= 128 && importId) {
          service.cancelImport(importId);
        }
      },
    });
    const library = service.createLibrary({
      displayName: 'Cancel',
      selectedParentPath: root,
    });
    await expect(service.importEagleLibrary({
      libraryId: library.libraryId,
      sourceRootPath,
    })).rejects.toMatchObject({ code: 'CANCELLED' });
    const remaining = service.listAssets({ libraryId: library.libraryId, recursive: true }).length;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(160);
    service.closeAll();
  });

  it('keeps Eagle still thumbs and suppresses automatic AI analysis', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writeEagleLibrary(root, 1, { includeVideo: true });
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    const library = service.createLibrary({
      displayName: 'Thumbs',
      selectedParentPath: root,
    });
    const result = await service.importEagleLibrary({
      libraryId: library.libraryId,
      sourceRootPath,
    });
    expect(result.importedCount).toBe(2);
    const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
    const image = assets.find((asset) => asset.mediaType === 'image');
    const video = assets.find((asset) => asset.mediaType === 'video');
    expect(image).toBeDefined();
    expect(video).toBeDefined();
    expect(service.shouldAutoAnalyzeAsset(library.libraryId, image!.assetId)).toBe(false);
    expect(service.shouldAutoAnalyzeAsset(library.libraryId, video!.assetId)).toBe(false);
    expect(service.getCurrentArtifact(library.libraryId, image!.assetId, 'thumbnail')).toMatchObject({
      status: 'ready',
      generatorVersion: 'eagle-thumbnail@1',
    });
    expect(service.getCurrentArtifact(library.libraryId, video!.assetId, 'video_poster')).toMatchObject({
      status: 'ready',
      generatorVersion: 'eagle-thumbnail@1',
    });
    expect(service.listMediaJobs(library.libraryId).jobs.filter((job) =>
      job.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB && job.status === 'queued',
    )).toHaveLength(2);
    expect(service.getCurrentArtifact(library.libraryId, video!.assetId, 'webm_proxy')).toBeNull();
    service.closeAll();
  });

  it('reports a stable full-library byte total from the first copy progress event', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writeEagleLibrary(root, 160);
    const copyTotals: number[] = [];
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onProgress: (event) => {
        if (event.type === 'import.progress' && event.phase === 'copy') {
          copyTotals.push(event.totalBytes);
        }
      },
    });
    const library = service.createLibrary({
      displayName: 'ByteTotal',
      selectedParentPath: root,
    });
    const result = await service.importEagleLibrary({
      libraryId: library.libraryId,
      sourceRootPath,
    });
    const expectedTotal = ONE_PX_RED_PNG.byteLength * 160;
    expect(result.importedCount).toBe(160);
    expect(copyTotals.length).toBeGreaterThan(1);
    expect(new Set(copyTotals)).toEqual(new Set([expectedTotal]));
    service.closeAll();
  });

  it('does not emit copy progress for every file in a batch', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writeEagleLibrary(root, 40);
    const copyEvents: number[] = [];
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onProgress: (event) => {
        if (event.type === 'import.progress' && event.phase === 'copy') {
          copyEvents.push(event.filesProcessed);
        }
      },
    });
    const library = service.createLibrary({
      displayName: 'Progress',
      selectedParentPath: root,
    });
    const result = await service.importEagleLibrary({
      libraryId: library.libraryId,
      sourceRootPath,
    });
    expect(result.importedCount).toBe(40);
    expect(copyEvents.length).toBeGreaterThan(0);
    expect(copyEvents.length).toBeLessThan(40);
    service.closeAll();
  });

  it('distinguishes unreadable Eagle metadata from copy and register failures', async () => {
    const root = temporaryRoot();
    const notEagle = path.join(root, 'plain-folder');
    mkdirSync(notEagle);

    const unreadable = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    const unreadableLibrary = unreadable.createLibrary({
      displayName: 'Unreadable',
      selectedParentPath: root,
    });
    await expect(unreadable.importEagleLibrary({
      libraryId: unreadableLibrary.libraryId,
      sourceRootPath: notEagle,
    })).rejects.toMatchObject({
      code: 'INVALID_IMPORT_SOURCE',
      reason: 'EAGLE_METADATA_UNREADABLE',
    });
    unreadable.closeAll();

    const copyFailed = new LibraryService({
      observerFactory: () => ({ close() {} }),
      failAt: 'crash-during-prepare-stage',
    });
    const copyLibrary = copyFailed.createLibrary({
      displayName: 'CopyFail',
      selectedParentPath: root,
    });
    await expect(copyFailed.importEagleLibrary({
      libraryId: copyLibrary.libraryId,
      sourceRootPath: writeEagleLibrary(root, 1),
    })).rejects.toMatchObject({
      code: 'IMPORT_APPLY_FAILED',
      reason: 'IMPORT_COPY_FAILED',
    });
    copyFailed.closeAll();

    const registerFailed = new LibraryService({
      observerFactory: () => ({ close() {} }),
      failAt: 'after-stage',
    });
    const registerLibrary = registerFailed.createLibrary({
      displayName: 'RegisterFail',
      selectedParentPath: root,
    });
    await expect(registerFailed.importEagleLibrary({
      libraryId: registerLibrary.libraryId,
      sourceRootPath: writeEagleLibrary(root, 1),
    })).rejects.toMatchObject({
      code: 'IMPORT_APPLY_FAILED',
      reason: 'IMPORT_REGISTER_FAILED',
    });
    registerFailed.closeAll();
  });
});
