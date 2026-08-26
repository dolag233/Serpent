import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService, type LibraryServiceOptions, type SharpModule } from '../../src/worker/library-service';
import {
  IMPORTED_THUMBNAIL_GENERATOR_PREFIX,
  IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
} from '../../src/worker/imported-thumbnail-policy';

const require = createRequire(import.meta.url);
const temporaryRoots: string[] = [];

type SharpImage = {
  jpeg(options?: { quality?: number }): { toBuffer(): Promise<Buffer> };
  metadata(): Promise<{ width?: number; height?: number }>;
};

type SharpFactory = (
  input: string | Buffer,
  options?: { animated?: boolean; raw?: { width: number; height: number; channels: number } },
) => SharpImage;

const sharp = require('sharp') as SharpFactory;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-import-thumbnail-'));
  temporaryRoots.push(root);
  return root;
}

async function largeJpeg(): Promise<Buffer> {
  const width = 1_600;
  const height = 900;
  const pixels = randomBytes(width * height * 3);
  return sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 92 }).toBuffer();
}

function writeEagleLibrary(
  root: string,
  thumbnail: Buffer,
  options: {
    includeVideo?: boolean;
    source?: Buffer;
    sourceExtension?: string;
    thumbnail?: Buffer;
    thumbnailExtension?: string;
  } = {},
): string {
  const libraryPath = path.join(root, 'Oversized Eagle.library');
  const infoPath = path.join(libraryPath, 'images', 'hero.info');
  const sourceExtension = options.sourceExtension ?? 'jpg';
  mkdirSync(infoPath, { recursive: true });
  writeFileSync(path.join(libraryPath, 'metadata.json'), JSON.stringify({ folders: [] }));
  writeFileSync(path.join(infoPath, 'metadata.json'), JSON.stringify({
    id: 'hero',
    name: 'hero',
    ext: sourceExtension,
    width: 1_600,
    height: 900,
  }));
  writeFileSync(path.join(infoPath, `hero.${sourceExtension}`), options.source ?? thumbnail);
  writeFileSync(
    path.join(infoPath, `hero_thumbnail.${options.thumbnailExtension ?? 'jpg'}`),
    options.thumbnail ?? thumbnail,
  );
  if (options.includeVideo) {
    const videoInfoPath = path.join(libraryPath, 'images', 'clip.info');
    mkdirSync(videoInfoPath, { recursive: true });
    writeFileSync(path.join(videoInfoPath, 'metadata.json'), JSON.stringify({
      id: 'clip',
      name: 'clip',
      ext: 'mp4',
      width: 1_920,
      height: 1_080,
    }));
    writeFileSync(path.join(videoInfoPath, 'clip.mp4'), Buffer.from('ftypisom'));
    writeFileSync(path.join(videoInfoPath, 'clip_thumbnail.jpg'), thumbnail);
  }
  return libraryPath;
}

function animatedGif(): Buffer {
  return Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAAEAAQAAAgFMACH5BAAKAAAALAAAAAAAAQABAAACAUwAOw==',
    'base64',
  );
}

function animatedWebp(): Buffer {
  return Buffer.from(
    'UklGRsYAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAEAAAEAAGQAAABWUDggMgAAANABAJ0BKgIAAgABQCYloAJ0ugH4AAOwAP7pIh/7z5+58/c+f9Gf/5T98jj+Rx/8oEAAQU5NRkgAAAAAAAAAAAABAAABAABkAAAAVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=',
    'base64',
  );
}

function writeBillfishLibrary(root: string, thumbnail: Buffer): string {
  const libraryPath = path.join(root, 'Oversized Billfish');
  mkdirSync(path.join(libraryPath, '.bf'), { recursive: true });
  mkdirSync(path.join(libraryPath, 'References'), { recursive: true });
  writeFileSync(path.join(libraryPath, 'References', 'hero.jpg'), thumbnail);
  writeFileSync(path.join(libraryPath, '.bf', 'hero-thumb.jpg'), thumbnail);
  const Database = BetterSqlite3 as unknown as {
    new (filename: string): {
      exec(sql: string): void;
      prepare(sql: string): { run(...parameters: unknown[]): void };
      close(): void;
    };
  };
  const database = new Database(path.join(libraryPath, '.bf', 'billfish.db'));
  database.exec(`
    CREATE TABLE assets (
      path TEXT NOT NULL,
      thumbnail TEXT
    )
  `);
  database
    .prepare('INSERT INTO assets (path, thumbnail) VALUES (?, ?)')
    .run('References/hero.jpg', '.bf/hero-thumb.jpg');
  database.close();
  return libraryPath;
}

async function assertNormalized(
  service: LibraryService,
  libraryId: string,
  assetId: string,
  kind: 'thumbnail' | 'video_poster' = 'thumbnail',
): Promise<void> {
  const before = service.getCurrentArtifact(libraryId, assetId, kind);
  expect(before).toMatchObject({
    status: 'ready',
  });
  expect(before!.generatorVersion).toMatch(/(?:eagle|billfish)-thumbnail@1/u);
  const oldPath = service.getArtifactAbsolutePath(libraryId, before!.artifactId, 'preview');
  expect(service.listMediaJobs(libraryId).jobs).toEqual(expect.arrayContaining([
    expect.objectContaining({
      assetId,
      errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      status: 'queued',
    }),
  ]));

  await expect(service.processThumbnailQueue(libraryId, {
    maxJobs: 1,
    jobKinds: ['generate_thumbnail'],
  })).resolves.toBe(1);

  const after = service.getCurrentArtifact(libraryId, assetId, kind);
  expect(after).toMatchObject({
    status: 'ready',
  });
  expect(after!.generatorVersion).toContain(IMPORTED_THUMBNAIL_GENERATOR_PREFIX);
  expect(after!.mimeType).toMatch(/^image\/(?:jpeg|webp)$/u);
  const outputPath = service.getArtifactAbsolutePath(libraryId, after!.artifactId, 'preview');
  const outputMetadata = await sharp(outputPath).metadata();
  expect(outputMetadata.width).toBeLessThanOrEqual(512);
  expect(outputMetadata.height).toBeLessThanOrEqual(512);
  expect(existsSync(oldPath)).toBe(false);
  expect(service.listMediaJobs(libraryId).jobs).toEqual(expect.arrayContaining([
    expect.objectContaining({
      assetId,
      errorCode: null,
      status: 'succeeded',
    }),
  ]));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('imported thumbnail normalization', () => {
  it('normalizes an oversized Eagle preview without decoding the source asset', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      const result = await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      expect(result.importedCount).toBe(1);
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0];
      expect(asset).toBeDefined();
      const importedJob = service.listMediaJobs(library.libraryId).jobs.find(
        (candidate) => candidate.assetId === asset!.assetId
          && candidate.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      );
      expect(importedJob).toBeDefined();
      expect(service.cancelMediaJobs(library.libraryId, [importedJob!.jobId])).toEqual({
        cancelledCount: 1,
      });
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(1);
      await assertNormalized(service, library.libraryId, asset!.assetId);
    } finally {
      service.closeAll();
    }
  });

  it('normalizes a Billfish preview through the same bounded queue lane', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      const result = await service.importBillfishLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeBillfishLibrary(root, thumbnail),
      });
      expect(result.importedCount).toBe(1);
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0];
      expect(asset).toBeDefined();
      await assertNormalized(service, library.libraryId, asset!.assetId);
    } finally {
      service.closeAll();
    }
  });

  it('normalizes an imported video poster without enqueueing a source transcode', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      const result = await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail, { includeVideo: true }),
      });
      expect(result.importedCount).toBe(2);
      const video = service.listAssets({ libraryId: library.libraryId, recursive: true })
        .find((asset) => asset.mediaType === 'video');
      expect(video).toBeDefined();
      await assertNormalized(service, library.libraryId, video!.assetId, 'video_poster');
      expect(service.listMediaJobs(library.libraryId).jobs.some((job) =>
        job.assetId === video!.assetId && job.kind === 'generate_webm_proxy',
      )).toBe(false);
    } finally {
      service.closeAll();
    }
  });

  it('keeps an imported animated GIF instead of flattening it to a still', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail, {
          thumbnail: animatedGif(),
          thumbnailExtension: 'gif',
        }),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const before = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      const beforePath = service.getArtifactAbsolutePath(library.libraryId, before.artifactId, 'preview');
      expect(before.mimeType).toBe('image/gif');
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);

      const after = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      expect(after).toMatchObject({
        artifactId: before.artifactId,
        generatorVersion: expect.stringContaining(IMPORTED_THUMBNAIL_GENERATOR_PREFIX),
        generatorId: IMPORTED_THUMBNAIL_GENERATOR_PREFIX,
        settingsHash: 'preserved-animated@1',
        mimeType: 'image/gif',
      });
      expect(existsSync(beforePath)).toBe(true);
      await expect(sharp(beforePath).metadata()).resolves.toMatchObject({
        format: 'gif',
        pages: 2,
      });
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          assetId: asset.assetId,
          errorCode: null,
          status: 'succeeded',
        }),
      ]));
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
    } finally {
      service.closeAll();
    }
  });

  it('keeps an animated WebP when the decoder reports multiple pages', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail, {
          thumbnail: animatedWebp(),
          thumbnailExtension: 'webp',
        }),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const before = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      const beforePath = service.getArtifactAbsolutePath(library.libraryId, before.artifactId, 'preview');
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);

      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')).toMatchObject({
        artifactId: before.artifactId,
        generatorVersion: expect.stringContaining(IMPORTED_THUMBNAIL_GENERATOR_PREFIX),
        mimeType: 'image/webp',
      });
      expect(existsSync(beforePath)).toBe(true);
      await expect(sharp(beforePath, { animated: true }).metadata()).resolves.toMatchObject({
        format: 'webp',
        pages: 2,
      });
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
    } finally {
      service.closeAll();
    }
  });

  it('does not requeue a preserved animation after reopening the library', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
    const sourceRootPath = writeEagleLibrary(root, thumbnail, {
      thumbnail: animatedGif(),
      thumbnailExtension: 'gif',
    });
    let assetId: string;
    try {
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath,
      });
      assetId = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!.assetId;
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
    } finally {
      service.closeAll();
    }

    const reopened = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const summary = reopened.openLibrary(library.libraryPath);
      expect(summary.libraryId).toBe(library.libraryId);
      expect(reopened.getCurrentArtifact(summary.libraryId, assetId!, 'thumbnail')).toMatchObject({
        artifactId: expect.any(String),
        generatorVersion: expect.stringContaining(IMPORTED_THUMBNAIL_GENERATOR_PREFIX),
        mimeType: 'image/gif',
      });
      expect(reopened.enqueueThumbnailJobs(summary.libraryId)).toBe(0);
      expect(reopened.listMediaJobs(summary.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          assetId,
          kind: 'generate_thumbnail',
          errorCode: null,
          status: 'succeeded',
        }),
      ]));
      expect(reopened.listMediaJobs(summary.libraryId).jobs.some((job) =>
        job.assetId === assetId
          && job.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB
          && job.status !== 'succeeded',
      )).toBe(false);
    } finally {
      reopened.closeAll();
    }
  });

  it('keeps a preserved animation current during explicit visible and ordinary waves', async () => {
    const root = temporaryRoot();
    const thumbnail = animatedGif();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail, {
          source: thumbnail,
          sourceExtension: 'gif',
          thumbnail,
          thumbnailExtension: 'gif',
        }),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);
      const before = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      expect(before.mimeType).toBe('image/gif');

      const database = new (BetterSqlite3 as unknown as {
        new (filename: string): {
          prepare(source: string): { run(...parameters: unknown[]): unknown };
          close(): void;
        };
      })(path.join(library.libraryPath, '.serpent', 'library.db'));
      database.prepare(
        `UPDATE revision_artifacts
            SET invalidated_at = ?
          WHERE revision_id = (SELECT current_revision_id FROM assets WHERE asset_id = ?)
            AND kind = 'extracted_metadata'
            AND invalidated_at IS NULL`,
      ).run(new Date().toISOString(), asset.assetId);
      database.close();

      expect(service.enqueueThumbnailJobs(library.libraryId, {
        assetIds: [asset.assetId],
        priority: 350,
        skipStaleRepair: true,
      })).toBe(0);
      expect(service.enqueueThumbnailJobs(library.libraryId, {
        assetIds: [asset.assetId],
      })).toBe(0);

      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')).toMatchObject({
        artifactId: before.artifactId,
        generatorVersion: expect.stringContaining(IMPORTED_THUMBNAIL_GENERATOR_PREFIX),
        mimeType: 'image/gif',
      });
      expect(existsSync(service.getArtifactAbsolutePath(
        library.libraryId,
        before.artifactId,
        'preview',
      ))).toBe(true);
    } finally {
      service.closeAll();
    }
  });

  it('keeps the copied preview when normalization fails and preserves the retry marker', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const failingSharp = (() => {
      throw new Error('synthetic normalization failure');
    }) as unknown as SharpModule;
    const options: LibraryServiceOptions = {
      observerFactory: () => ({ close() {} }),
      sharpFn: failingSharp,
    };
    const service = new LibraryService(options);
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const before = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      const oldPath = service.getArtifactAbsolutePath(library.libraryId, before.artifactId, 'preview');
      const job = service.listMediaJobs(library.libraryId).jobs.find(
        (candidate) => candidate.assetId === asset.assetId
          && candidate.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      );
      expect(job).toBeDefined();
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);
      expect(existsSync(oldPath)).toBe(true);
      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')).toMatchObject({
        artifactId: before.artifactId,
        generatorVersion: 'eagle-thumbnail@1',
        status: 'ready',
      });
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          jobId: job!.jobId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'failed',
        }),
      ]));
      expect(service.retryMediaJobs(library.libraryId, [job!.jobId])).toEqual({ retriedCount: 1 });
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          jobId: job!.jobId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'queued',
        }),
      ]));
    } finally {
      service.closeAll();
    }
  });
});
