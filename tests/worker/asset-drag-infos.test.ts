import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

// LibraryService holds SQLite connections and recursive fs watchers; on
// Windows those open handles block rm of the temp tree. Always close first.
const services: LibraryService[] = [];

function newService(): LibraryService {
  const service = new LibraryService();
  services.push(service);
  return service;
}

interface TestDatabaseConnection {
  close(): void;
  prepare(source: string): {
    run(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-drag-infos-'));
  temporaryRoots.push(root);
  return root;
}

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

function createTestImage(destPath: string): void {
  mkdirSync(path.dirname(destPath), { recursive: true });
  writeFileSync(destPath, VALID_1X1_PNG);
}

afterEach(() => {
  for (const service of services.splice(0)) {
    try {
      service.closeAll();
    } catch {
      // Cleanup is best-effort.
    }
  }
  for (const root of temporaryRoots.splice(0)) {
    try {
      rmSync(root, { force: true, recursive: true });
    } catch {
      // Cleanup is best-effort.
    }
  }
});

describe('resolveAssetDragInfos (Serpent-v4jf batched drag priming)', () => {
  it('resolves managed assets in one batch with thumbnail paths matching the single-entry resolvers', async () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'DragBatch', selectedParentPath: root });

    const withThumb = path.join(root, 'with-thumb.png');
    const withoutThumb = path.join(root, 'without-thumb.png');
    createTestImage(withThumb);
    createTestImage(withoutThumb);
    importNoConflict(service, created.libraryId, withThumb);
    importNoConflict(service, created.libraryId, withoutThumb);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets).toHaveLength(2);
    const withThumbAsset = assets.find((asset) => asset.relativeFilePath.includes('with-thumb'))!;
    const withoutThumbAsset = assets.find((asset) => asset.relativeFilePath.includes('without-thumb'))!;
    await service.generateThumbnail({ libraryId: created.libraryId, assetId: withThumbAsset.assetId });

    const entries = service.resolveAssetDragInfos(created.libraryId, [
      withThumbAsset.assetId,
      withoutThumbAsset.assetId,
      'missing-asset-id',
    ]);

    expect(entries).toHaveLength(2);
    const withThumbEntry = entries.find((entry) => entry.assetId === withThumbAsset.assetId)!;
    const withoutThumbEntry = entries.find((entry) => entry.assetId === withoutThumbAsset.assetId)!;

    // Absolute paths match the single-entry resolver.
    expect(withThumbEntry.absolutePath).toBe(service.resolveAssetPath(created.libraryId, withThumbAsset.assetId));
    expect(withoutThumbEntry.absolutePath).toBe(service.resolveAssetPath(created.libraryId, withoutThumbAsset.assetId));

    // Thumbnail path matches the single-entry thumbnail resolver, and the
    // asset without a thumbnail has none.
    const singleThumb = service.getThumbnailArtifact(created.libraryId, withThumbAsset.assetId);
    expect(singleThumb).toBeTruthy();
    expect(withThumbEntry.thumbnailAbsolutePath).toBe(
      service.getArtifactAbsolutePath(created.libraryId, singleThumb!.artifactId, 'preview'),
    );
    expect(withoutThumbEntry.thumbnailAbsolutePath).toBeUndefined();
  });

  it('prefers a ready video poster for thumbnail entries like getThumbnailArtifact', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'DragPoster', selectedParentPath: root });

    const sourcePath = path.join(root, 'poster.mp4');
    writeFileSync(sourcePath, Buffer.alloc(1024, 0));
    importNoConflict(service, created.libraryId, sourcePath);
    const asset = service.listAssets({ libraryId: created.libraryId, recursive: true })[0]!;

    const db = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    const posterPath = path.join(created.libraryPath, '.serpent', 'artifacts', 'drag-poster.jpg');
    createTestImage(posterPath);
    db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, generated_at)
       VALUES (?, ?, 'video_poster', 'image/jpeg', ?, ?, 'test', 'ready', ?)`,
    ).run(
      'poster-for-drag-batch',
      asset.currentRevisionId,
      readFileSync(posterPath).byteLength,
      'drag-poster.jpg',
      new Date().toISOString(),
    );
    db.close();

    const entries = service.resolveAssetDragInfos(created.libraryId, [asset.assetId]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.thumbnailAbsolutePath).toBe(posterPath);
  });

  it('resolves linked assets to their external absolute paths', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'DragLinked', selectedParentPath: root });

    // importFolderAsLinked expects a directory source.
    const sourceDir = path.join(root, 'link-source');
    createTestImage(path.join(sourceDir, 'linked-asset.png'));
    const linked = service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: sourceDir,
    });

    const assets = service.listAssets({
      libraryId: created.libraryId,
      folderId: linked.folderId,
      recursive: true,
    });
    expect(assets).toHaveLength(1);

    const entries = service.resolveAssetDragInfos(created.libraryId, [assets[0]!.assetId]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.absolutePath).toBe(service.resolveAssetPath(created.libraryId, assets[0]!.assetId));
    expect(entries[0]!.absolutePath).toContain('link-source');
  });
});
