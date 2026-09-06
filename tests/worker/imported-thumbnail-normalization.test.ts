import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LibraryService, type LibraryServiceOptions, type SharpModule } from '../../src/worker/library-service';
import { mediaResourceGuard, MediaResourceExhaustedError } from '../../src/worker/media-resource-guard';
import {
  IMPORTED_THUMBNAIL_GENERATOR_PREFIX,
  IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
  IMPORTED_THUMBNAIL_PRESERVED_GENERATOR,
} from '../../src/worker/imported-thumbnail-policy';

const require = createRequire(import.meta.url);
const temporaryRoots: string[] = [];

type SharpImage = {
  jpeg(options?: { quality?: number }): { toBuffer(): Promise<Buffer> };
  metadata(): Promise<{ width?: number; height?: number }>;
  raw?(): { toBuffer(): Promise<Buffer> };
};

type SharpFactory = (
  input: string | Buffer,
  options?: {
    animated?: boolean;
    page?: number;
    pages?: number;
    raw?: { width: number; height: number; channels: number };
  },
) => SharpImage;

const sharp = require('sharp') as SharpFactory;
const productionSharp = sharp as unknown as SharpModule;
type SharpOptions = NonNullable<Parameters<SharpModule>[1]>;

function cancelAfterRawDecodeStarts(onDecode: () => void): SharpModule {
  return ((
    input: string | Buffer,
    options?: {
      animated?: boolean;
      page?: number;
      pages?: number;
      failOn?: 'warning' | 'error' | 'none';
      sequentialRead?: boolean;
      limitInputPixels?: number;
    },
  ) => {
    const instance = productionSharp(input, options);
    const rawMethod = instance.raw;
    if (!rawMethod) return instance;
    instance.raw = () => {
      const rawInstance = rawMethod.call(instance);
      const rawWithBuffer = rawInstance as unknown as {
        toBuffer?: (bufferOptions?: unknown) => Promise<unknown>;
      };
      const originalToBuffer = rawWithBuffer.toBuffer;
      if (!originalToBuffer) return rawInstance;
      rawWithBuffer.toBuffer = async (bufferOptions?: unknown) => {
        const decoding = originalToBuffer.call(rawWithBuffer, bufferOptions);
        // Let the native operation start before the caller cancels it. The
        // production path then observes the abort at the page boundary.
        await new Promise<void>((resolve) => setImmediate(resolve));
        onDecode();
        return decoding;
      };
      return rawInstance;
    };
    return instance;
  }) as unknown as SharpModule;
}

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

async function boundedJpeg(): Promise<Buffer> {
  const width = 320;
  const height = 180;
  const pixels = Buffer.alloc(width * height * 3, 127);
  return sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 82 }).toBuffer();
}

async function oversizedButCompressibleJpeg(): Promise<Buffer> {
  const width = 2_048;
  const height = 1_024;
  const pixels = Buffer.alloc(width * height * 3, 127);
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
    width?: number;
    height?: number;
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
    width: options.width ?? 1_600,
    height: options.height ?? 900,
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
function singleFrameGif(): Buffer {
  return Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
    'base64',
  );
}

function animatedWebp(): Buffer {
  return Buffer.from(
    'UklGRsYAAABXRUJQVlA4WAoAAAACAAAAAQAAAQAAQU5JTQYAAAAAAAAAAABBTk1GSgAAAAAAAAAAAAEAAAEAAGQAAABWUDggMgAAANABAJ0BKgIAAgABQCYloAJ0ugH4AAOwAP7pIh/7z5+58/c+f9Gf/5T98jj+Rx/8oEAAQU5NRkgAAAAAAAAAAAABAAABAABkAAAAVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=',
    'base64',
  );
}

function oversizedAnimatedGif(): Buffer {
  return Buffer.concat([animatedGif(), Buffer.alloc(256 * 1024)]);
}

function manyPageAnimatedGif(): Buffer {
  const source = animatedGif();
  const header = source.subarray(0, 39);
  const frame = source.subarray(39, 62);
  const trailer = source.subarray(84);
  return Buffer.concat([header, ...Array.from({ length: 129 }, () => frame), trailer]);
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
  expect(after!.width).toBe(outputMetadata.width);
  expect(after!.height).toBe(outputMetadata.height);
  expect(statSync(outputPath).size).toBeLessThanOrEqual(256 * 1024);
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
  mediaResourceGuard.reset();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

beforeEach(() => {
  mediaResourceGuard.reset();
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
      await assertNormalized(service, library.libraryId, asset!.assetId);
    } finally {
      service.closeAll();
    }
  });

  it('validates a bounded preview before preserving it despite a high-resolution source', async () => {
    const root = temporaryRoot();
    const thumbnail = await boundedJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const artifact = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      expect(artifact).toMatchObject({
        generatorVersion: 'eagle-thumbnail@1',
        width: 1_600,
        height: 900,
      });
      const beforePath = service.getArtifactAbsolutePath(
        library.libraryId,
        artifact.artifactId,
        'preview',
      );
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          assetId: asset.assetId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'queued',
        }),
      ]));
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);
      const preserved = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      expect(preserved).toMatchObject({
        artifactId: artifact.artifactId,
        generatorVersion: IMPORTED_THUMBNAIL_PRESERVED_GENERATOR,
        width: 320,
        height: 180,
      });
      expect(service.getCurrentArtifact(
        library.libraryId,
        asset.assetId,
        'extracted_metadata',
      )).toMatchObject({
        width: 1_600,
        height: 900,
      });
      await expect(sharp(service.getArtifactAbsolutePath(
        library.libraryId,
        preserved.artifactId,
        'preview',
      )).metadata()).resolves.toMatchObject({
        width: 320,
        height: 180,
      });
      expect(existsSync(beforePath)).toBe(true);
    } finally {
      service.closeAll();
    }
  });

  it('finds an oversized preview when source dimensions are small', async () => {
    const root = temporaryRoot();
    const thumbnail = await oversizedButCompressibleJpeg();
    expect(thumbnail.byteLength).toBeLessThan(256 * 1024);
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail, {
          width: 320,
          height: 180,
        }),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          assetId: asset.assetId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'queued',
        }),
      ]));
      await assertNormalized(service, library.libraryId, asset.assetId);
    } finally {
      service.closeAll();
    }
  });

  it('probes legacy rows during bounded backfill before replacing a small preview', async () => {
    const root = temporaryRoot();
    const thumbnail = await boundedJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const before = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      const beforePath = service.getArtifactAbsolutePath(
        library.libraryId,
        before.artifactId,
        'preview',
      );
      const database = new (BetterSqlite3 as unknown as {
        new (filename: string): {
          prepare(source: string): { run(...parameters: unknown[]): unknown };
          close(): void;
        };
      })(path.join(library.libraryPath, '.serpent', 'library.db'));
      database.prepare(
        `UPDATE revision_artifacts
            SET generator_version = 'eagle-thumbnail@1'
          WHERE artifact_id = ?`,
      ).run(before.artifactId);
      database.close();

      const importedJob = service.listMediaJobs(library.libraryId).jobs.find((job) =>
        job.assetId === asset.assetId
          && job.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      );
      expect(importedJob).toBeDefined();
      expect(service.cancelMediaJobs(library.libraryId, [importedJob!.jobId])).toEqual({
        cancelledCount: 1,
      });

      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(1);
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);
      const after = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      expect(after).toMatchObject({
        artifactId: before.artifactId,
        generatorVersion: expect.stringContaining(IMPORTED_THUMBNAIL_GENERATOR_PREFIX),
      });
      expect(after.generatorVersion).toContain('preserved-bounded@1');
      expect(existsSync(beforePath)).toBe(true);
    } finally {
      service.closeAll();
    }
  });

  it('fails a truncated bounded preview instead of permanently preserving it', async () => {
    const root = temporaryRoot();
    const validSource = await boundedJpeg();
    const truncatedPreview = validSource.subarray(0, Math.max(32, Math.floor(validSource.length / 2)));
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, validSource, {
          thumbnail: truncatedPreview,
        }),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const before = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      const beforePath = service.getArtifactAbsolutePath(library.libraryId, before.artifactId, 'preview');
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);
      expect(existsSync(beforePath)).toBe(true);
      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')).toMatchObject({
        artifactId: before.artifactId,
        generatorVersion: 'eagle-thumbnail@1',
        status: 'ready',
      });
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          assetId: asset.assetId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'failed',
        }),
      ]));
    } finally {
      service.closeAll();
    }
  });

  it('keeps imported normalization out of an interactive visible wave', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
        interactive: true,
        assetIds: [asset.assetId],
      })).resolves.toBe(0);
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          assetId: asset.assetId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'queued',
        }),
      ]));
      await assertNormalized(service, library.libraryId, asset.assetId);
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
          thumbnail: oversizedAnimatedGif(),
          thumbnailExtension: 'gif',
        }),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const before = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      const beforePath = service.getArtifactAbsolutePath(library.libraryId, before.artifactId, 'preview');
      expect(before.mimeType).toBe('image/gif');
      // The ordinary repair pass runs before the background marker is claimed.
      // It must not invalidate the only ready copy while normalization is still
      // pending.
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
      expect(existsSync(beforePath)).toBe(true);
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

  it('keeps a single-frame imported GIF through the ordinary stale repair pass', async () => {
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
          source: singleFrameGif(),
          sourceExtension: 'gif',
          thumbnail: singleFrameGif(),
          thumbnailExtension: 'gif',
        }),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const before = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      const beforePath = service.getArtifactAbsolutePath(library.libraryId, before.artifactId, 'preview');
      expect(before.mimeType).toBe('image/gif');
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
      expect(existsSync(beforePath)).toBe(true);

      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);

      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')).toMatchObject({
        artifactId: before.artifactId,
        generatorVersion: IMPORTED_THUMBNAIL_PRESERVED_GENERATOR,
        mimeType: 'image/gif',
        width: 1,
        height: 1,
      });
      expect(existsSync(beforePath)).toBe(true);
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
    } finally {
      service.closeAll();
    }
  });

  it('keeps an animated WebP when the decoder reports multiple pages', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const observedPageOptions: Array<Pick<SharpOptions, 'animated' | 'page' | 'pages'>> = [];
    const recordingSharp = ((input: string | Buffer, options?: SharpOptions) => {
      if (options?.page !== undefined) {
        observedPageOptions.push({
          animated: options.animated,
          page: options.page,
          pages: options.pages,
        });
      }
      return productionSharp(input, options);
    }) as SharpModule;
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      sharpFn: recordingSharp,
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
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
      expect(existsSync(beforePath)).toBe(true);
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
      const frame0 = await sharp(beforePath, { animated: true, page: 0 }).raw!().toBuffer();
      const frame1 = await sharp(beforePath, { animated: true, page: 1 }).raw!().toBuffer();
      expect(frame0.equals(frame1)).toBe(false);
      expect(observedPageOptions).toEqual(expect.arrayContaining([
        { animated: true, page: 0, pages: 1 },
        { animated: true, page: 1, pages: 1 },
      ]));
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
    } finally {
      service.closeAll();
    }
  });

  it('preserves an imported animation regardless of its page count', async () => {
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
          thumbnail: manyPageAnimatedGif(),
          thumbnailExtension: 'gif',
        }),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const before = service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')!;
      const beforePath = service.getArtifactAbsolutePath(library.libraryId, before.artifactId, 'preview');

      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);

      expect(existsSync(beforePath)).toBe(true);
      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')).toMatchObject({
        artifactId: before.artifactId,
        generatorVersion: 'import-thumbnail@2;preserved-animated@1',
        status: 'ready',
      });
      expect(service.listMediaJobs(library.libraryId).jobs).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          assetId: asset.assetId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'failed',
        }),
      ]));
    } finally {
      service.closeAll();
    }
  });

  it('stops a normalization job cancelled while a page is being decoded', async () => {
    const root = temporaryRoot();
    const thumbnail = await boundedJpeg();
    let libraryId = '';
    let jobId = '';
    let cancelRequested = false;
    const cancellingSharp = cancelAfterRawDecodeStarts(() => {
      if (cancelRequested || !libraryId || !jobId) return;
      cancelRequested = true;
      service.cancelMediaJobs(libraryId, [jobId]);
    });
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      sharpFn: cancellingSharp,
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      libraryId = library.libraryId;
      await service.importEagleLibrary({
        libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      const asset = service.listAssets({ libraryId, recursive: true })[0]!;
      const before = service.getCurrentArtifact(libraryId, asset.assetId, 'thumbnail')!;
      const beforePath = service.getArtifactAbsolutePath(libraryId, before.artifactId, 'preview');
      const job = service.listMediaJobs(libraryId).jobs.find((candidate) =>
        candidate.assetId === asset.assetId
          && candidate.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      );
      expect(job).toBeDefined();
      jobId = job!.jobId;

      await expect(service.processThumbnailQueue(libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);

      expect(cancelRequested).toBe(true);
      expect(existsSync(beforePath)).toBe(true);
      expect(service.getCurrentArtifact(libraryId, asset.assetId, 'thumbnail')).toMatchObject({
        artifactId: before.artifactId,
        generatorVersion: 'eagle-thumbnail@1',
        status: 'ready',
      });
      expect(service.listMediaJobs(libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          jobId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'cancelled',
        }),
      ]));
    } finally {
      service.closeAll();
    }
  });

  it('does not publish an imported replacement after the source revision changes', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    let databasePath = '';
    let assetId = '';
    let revisionId = '';
    let switched = false;
    const switchingSharp: SharpModule = (input, options) => {
      const instance = productionSharp(input, options);
      if (
        !switched
        && databasePath
        && assetId
        && revisionId
        && typeof input === 'string'
        && options?.page === undefined
      ) {
        const originalMetadata = instance.metadata.bind(instance);
        instance.metadata = async () => {
          const metadata = await originalMetadata();
          if (!switched) {
            switched = true;
            const Database = BetterSqlite3 as unknown as {
              new (filename: string): {
                prepare(source: string): { run(...parameters: unknown[]): unknown };
                close(): void;
              };
            };
            const database = new Database(databasePath);
            const replacementRevisionId = randomUUID();
            const now = new Date().toISOString();
            database.prepare(
              `INSERT INTO revisions
                 (revision_id, asset_id, parent_revision_id, byte_size, modified_at,
                  original_filename, origin, accepted_at)
               VALUES (?, ?, ?, ?, ?, ?, 'external_change', ?)`,
            ).run(
              replacementRevisionId,
              assetId,
              revisionId,
              1,
              now,
              'hero.jpg',
              now,
            );
            database.prepare(
              'UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?',
            ).run(replacementRevisionId, now, assetId);
            database.close();
          }
          return metadata;
        };
      }
      return instance;
    };
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      sharpFn: switchingSharp,
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      databasePath = path.join(library.libraryPath, '.serpent', 'library.db');
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      assetId = asset.assetId;
      revisionId = asset.currentRevisionId;
      const before = service.getCurrentArtifact(library.libraryId, assetId, 'thumbnail')!;
      const beforePath = service.getArtifactAbsolutePath(library.libraryId, before.artifactId, 'preview');
      const job = service.listMediaJobs(library.libraryId).jobs.find((candidate) =>
        candidate.assetId === assetId
          && candidate.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      );
      expect(job).toBeDefined();

      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);

      expect(switched).toBe(true);
      expect(existsSync(beforePath)).toBe(true);
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          jobId: job!.jobId,
          errorCode: 'STALE_REVISION',
          status: 'cancelled',
        }),
      ]));
      const Database = BetterSqlite3 as unknown as {
        new (filename: string): {
          prepare(source: string): { get(...parameters: unknown[]): unknown };
          close(): void;
        };
      };
      const database = new Database(databasePath);
      const oldArtifact = database.prepare(
        `SELECT status, invalidated_at
           FROM revision_artifacts
          WHERE artifact_id = ?`,
      ).get(before.artifactId) as { status: string; invalidated_at: string | null } | undefined;
      const replacementCount = database.prepare(
        `SELECT COUNT(*) AS count
           FROM revision_artifacts
          WHERE revision_id = ?
            AND kind = 'thumbnail'`,
      ).get(revisionId) as { count: number };
      database.close();
      expect(oldArtifact).toEqual({ status: 'ready', invalidated_at: null });
      expect(replacementCount.count).toBe(1);
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
      thumbnail: oversizedAnimatedGif(),
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
    const thumbnail = oversizedAnimatedGif();
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

  it('keeps the normalization marker when native memory pressure requeues a job', async () => {
    const root = temporaryRoot();
    const thumbnail = await largeJpeg();
    const resourceSharp: SharpModule = (() => {
      throw new MediaResourceExhaustedError('synthetic memory pressure', 'test');
    }) as unknown as SharpModule;
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      sharpFn: resourceSharp,
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const job = service.listMediaJobs(library.libraryId).jobs.find((candidate) =>
        candidate.assetId === asset.assetId
          && candidate.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      );
      expect(job).toBeDefined();
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          jobId: job!.jobId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'queued',
        }),
      ]));
      expect(service.enqueueThumbnailJobs(library.libraryId)).toBe(0);
    } finally {
      service.closeAll();
    }
  });

  it('keeps the normalization marker when a running job loses its lease', async () => {
    const root = temporaryRoot();
    const thumbnail = await boundedJpeg();
    let databasePath = '';
    let jobId = '';
    let leaseStolen = false;
    const stealingSharp: SharpModule = (input, options) => {
      if (!leaseStolen) {
        leaseStolen = true;
        const database = new (BetterSqlite3 as unknown as {
          new (filename: string): {
            prepare(source: string): { run(...parameters: unknown[]): unknown };
            close(): void;
          };
        })(databasePath);
        database.prepare(
          `UPDATE library_job_leases
              SET owner_id = ?, acquired_at_ms = 0, expires_at_ms = 1
            WHERE job_id = ?`,
        ).run('foreign-owner', jobId);
        database.close();
      }
      return productionSharp(input, options);
    };
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      sharpFn: stealingSharp,
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      databasePath = path.join(library.libraryPath, '.serpent', 'library.db');
      await service.importEagleLibrary({
        libraryId: library.libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
      const job = service.listMediaJobs(library.libraryId).jobs.find((candidate) =>
        candidate.assetId === asset.assetId
          && candidate.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      );
      expect(job).toBeDefined();
      jobId = job!.jobId;
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          jobId: job!.jobId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'queued',
        }),
      ]));
      expect(service.getCurrentArtifact(library.libraryId, asset.assetId, 'thumbnail')).toMatchObject({
        artifactId: expect.any(String),
        generatorVersion: IMPORTED_THUMBNAIL_PRESERVED_GENERATOR,
      });
      await expect(service.processThumbnailQueue(library.libraryId, {
        maxJobs: 1,
        jobKinds: ['generate_thumbnail'],
      })).resolves.toBe(1);
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          jobId: job!.jobId,
          errorCode: null,
          status: 'succeeded',
        }),
      ]));
    } finally {
      service.closeAll();
    }
  });

  it('recovers a running normalization job with its marker after reopening', async () => {
    const root = temporaryRoot();
    const thumbnail = await boundedJpeg();
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    let libraryPath!: string;
    let libraryId!: string;
    let assetId!: string;
    let jobId!: string;
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      libraryPath = library.libraryPath;
      libraryId = library.libraryId;
      await service.importEagleLibrary({
        libraryId,
        sourceRootPath: writeEagleLibrary(root, thumbnail),
      });
      const asset = service.listAssets({ libraryId, recursive: true })[0]!;
      assetId = asset.assetId;
      const job = service.listMediaJobs(libraryId).jobs.find((candidate) =>
        candidate.assetId === assetId
          && candidate.errorCode === IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
      );
      expect(job).toBeDefined();
      jobId = job!.jobId;
      const database = new (BetterSqlite3 as unknown as {
        new (filename: string): {
          prepare(source: string): { run(...parameters: unknown[]): unknown };
          close(): void;
        };
      })(path.join(libraryPath, '.serpent', 'library.db'));
      database.prepare(
        `UPDATE jobs
            SET status = 'running', error_code = ?
          WHERE job_id = ?`,
      ).run(IMPORTED_THUMBNAIL_NORMALIZATION_JOB, jobId);
      database.close();
      service.closeAll();

      const reopened = new LibraryService({
        observerFactory: () => ({ close() {} }),
      });
      try {
        expect(reopened.openLibrary(libraryPath).libraryId).toBe(libraryId);
        expect(reopened.listMediaJobs(libraryId).jobs).toEqual(expect.arrayContaining([
          expect.objectContaining({
            jobId,
            errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
            status: 'queued',
          }),
        ]));
        await expect(reopened.processThumbnailQueue(libraryId, {
          maxJobs: 1,
          jobKinds: ['generate_thumbnail'],
        })).resolves.toBe(1);
        expect(reopened.listMediaJobs(libraryId).jobs).toEqual(expect.arrayContaining([
          expect.objectContaining({ jobId, errorCode: null, status: 'succeeded' }),
        ]));
        expect(reopened.getCurrentArtifact(libraryId, assetId, 'thumbnail')).toMatchObject({
          generatorVersion: IMPORTED_THUMBNAIL_PRESERVED_GENERATOR,
        });
      } finally {
        reopened.closeAll();
      }
    } finally {
      if (service.listLibraries().length > 0) service.closeAll();
    }
  });
});
