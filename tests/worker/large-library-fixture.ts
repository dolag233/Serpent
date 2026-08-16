import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { LibraryService } from '../../src/worker/library-service';
import { normalizeSearchText } from '../../src/worker/search-query';
import {
  createAssetBytes,
  createUniqueVideoFile,
  videoDurationMs,
} from './large-library-media';
import {
  LARGE_LIBRARY_ASSET_COUNT,
  LARGE_LIBRARY_FIXTURE_VERSION,
  LARGE_LIBRARY_SEARCH_TOKEN,
  extensionForKind,
  imageGeometryForIndex,
  imagePoolKey,
  kindForIndex,
  mixCountsFor,
  pad,
  videoGeometry,
  type LargeLibraryAssetKind,
  type LargeLibraryImageGeometry,
  type LargeLibraryMixCounts,
} from './large-library-mix';

const require = createRequire(import.meta.url);

interface DatabaseConnection {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): {
    run(...parameters: unknown[]): { changes: number };
  };
}

const Database = require('better-sqlite3') as new (filename: string) => DatabaseConnection;

export {
  LARGE_LIBRARY_ASSET_COUNT,
  LARGE_LIBRARY_FIXTURE_VERSION,
  LARGE_LIBRARY_SEARCH_TOKEN,
};

const ROOT_FOLDER_COUNT = 10;
const CHILD_FOLDERS_PER_ROOT = 15;
const COLLECTION_COUNT = 50;
const TAG_NAMES = ['ABCD-A', 'ABCD-B', 'ABCD-C', 'ABCD-D', 'ABCD-E', 'ABCD-F'];
/** Unique encoded clips copied across the video bucket so generation stays bounded. */
const VIDEO_POOL_SIZE = 48;
const FILE_WRITE_CONCURRENCY = 8;
const EXTRACTED_METADATA_GENERATOR = 'image-header@large-library-v3';
const VIDEO_METADATA_GENERATOR = 'ffprobe@large-library-v3';

interface PlannedAsset {
  index: number;
  kind: LargeLibraryAssetKind;
  extension: string;
  folderIndex: number;
  filename: string;
  relativePath: string;
  geometry: LargeLibraryImageGeometry | undefined;
}

export interface LargeLibraryFixtureManifest {
  version: number;
  seed: number;
  libraryId: string;
  libraryPath: string;
  assetCount: number;
  imageCount: number;
  videoCount: number;
  modelCount: number;
  textCount: number;
  audioCount: number;
  unsupportedCount: number;
  folderCount: number;
  collectionCount: number;
  tagCount: number;
  searchToken: string;
  searchTokenAssetCount: number;
  sampleAssetId: string;
  sampleFolderId: string;
  generatedAt: string;
}

export interface EnsureLargeLibraryFixtureOptions {
  outputPath: string;
  assetCount?: number;
  seed?: number;
  reset?: boolean;
  writeFiles?: boolean;
}

function manifestPath(libraryPath: string): string {
  return path.join(libraryPath, '.serpent', 'large-library-fixture.json');
}

function assertSafeOutputPath(outputPath: string): string {
  const resolved = path.resolve(outputPath);
  if (resolved === path.parse(resolved).root || path.basename(resolved).length < 3) {
    throw new Error(`Refusing to generate a fixture at an unsafe path: ${resolved}`);
  }
  return resolved;
}

function readExistingManifest(outputPath: string): LargeLibraryFixtureManifest | undefined {
  const file = manifestPath(outputPath);
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as LargeLibraryFixtureManifest;
}

async function mapPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const current = next;
      next += 1;
      await worker(items[current]!);
    }
  });
  await Promise.all(runners);
}

function poolFileName(key: string, extension: string): string {
  return `${key.replaceAll(':', '-')}.${extension}`;
}

async function prepareImagePool(
  libraryPath: string,
  planned: PlannedAsset[],
): Promise<Map<string, string>> {
  const images = planned.filter((item) => item.kind === 'image' && item.geometry);
  if (images.length === 0) return new Map();
  const poolDir = path.join(libraryPath, '.serpent', 'image-pool');
  mkdirSync(poolDir, { recursive: true });
  const unique = new Map<string, PlannedAsset>();
  for (const item of images) {
    const key = imagePoolKey(item.extension, item.geometry!);
    if (!unique.has(key)) unique.set(key, item);
  }
  const pool = new Map<string, string>();
  const uniqueItems = [...unique.values()];
  const writePoolItem = async (item: PlannedAsset): Promise<void> => {
    const key = imagePoolKey(item.extension, item.geometry!);
    const poolPath = path.join(poolDir, poolFileName(key, item.extension));
    const bytes = await createAssetBytes(item.kind, item.index, item.extension, item.geometry);
    writeFileSync(poolPath, bytes);
    pool.set(key, poolPath);
  };
  const highRes = uniqueItems.filter((item) => (
    Math.max(item.geometry!.width, item.geometry!.height) >= 4096
  ));
  const lowRes = uniqueItems.filter((item) => (
    Math.max(item.geometry!.width, item.geometry!.height) < 4096
  ));
  await mapPool(lowRes, FILE_WRITE_CONCURRENCY, writePoolItem);
  await mapPool(highRes, 1, writePoolItem);
  return pool;
}

function prepareVideoPool(libraryPath: string, planned: PlannedAsset[]): string[] {
  const videos = planned.filter((item) => item.kind === 'video');
  if (videos.length === 0) return [];
  const poolDir = path.join(libraryPath, '.serpent', 'video-pool');
  mkdirSync(poolDir, { recursive: true });
  const poolSize = Math.min(VIDEO_POOL_SIZE, videos.length);
  const poolPaths: string[] = [];
  for (let index = 0; index < poolSize; index += 1) {
    const source = videos[index]!;
    const poolPath = path.join(poolDir, `clip-${pad(index, 2)}.${source.extension}`);
    createUniqueVideoFile(poolPath, source.index, source.extension);
    poolPaths.push(poolPath);
  }
  return poolPaths;
}

function writeExtractedMetadataArtifact(
  artifactsDir: string,
  revisionId: string,
  payload: Record<string, unknown>,
  size: LargeLibraryImageGeometry,
  durationMs: number | null,
  generatorVersion: string,
  insertArtifact: { run(...parameters: unknown[]): { changes: number } },
): void {
  const artifactId = randomUUID();
  const artifactRelPath = `${artifactId}.json`;
  const artifactAbsPath = path.join(artifactsDir, artifactRelPath);
  writeFileSync(artifactAbsPath, JSON.stringify(payload), 'utf8');
  insertArtifact.run(
    artifactId,
    revisionId,
    statSync(artifactAbsPath).size,
    artifactRelPath,
    size.width,
    size.height,
    durationMs,
    generatorVersion,
    '2026-08-16T00:00:00.000Z',
  );
}

async function seedDatabase(
  libraryPath: string,
  folderIds: string[],
  tagIds: string[],
  collectionIds: string[],
  counts: LargeLibraryMixCounts,
  writeFiles: boolean,
): Promise<{ searchTokenAssetCount: number; sampleAssetId: string }> {
  const database = new Database(path.join(libraryPath, '.serpent', 'library.db'));
  const now = '2026-08-16T00:00:00.000Z';
  const insertAsset = database.prepare(
    `INSERT INTO assets (
       asset_id, location_kind, managed_folder_id, linked_folder_id,
       relative_file_path, current_revision_id, availability, path_identity,
       created_at, updated_at
     ) VALUES (?, 'managed', ?, NULL, ?, ?, 'available', ?, ?, ?)`,
  );
  const insertRevision = database.prepare(
    `INSERT INTO revisions (
       revision_id, asset_id, parent_revision_id, byte_size, modified_at,
       original_filename, origin, accepted_at
     ) VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
  );
  const insertMetadata = database.prepare(
    `INSERT INTO asset_metadata (
       asset_id, description, rating, favorite, palette,
       source_page_url, entity_version, updated_at
     ) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)`,
  );
  const insertSearchIndex = database.prepare(
    `INSERT INTO asset_search_index (
       asset_id, filename, tags, description, source_url,
       folder_path, metadata_text
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAssetTag = database.prepare(
    'INSERT INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
  );
  const insertCollectionAsset = database.prepare(
    'INSERT INTO collection_assets (collection_id, asset_id, position) VALUES (?, ?, ?)',
  );
  const insertArtifact = database.prepare(
    `INSERT INTO revision_artifacts
       (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
        width, height, duration_ms, generator_version, status, generated_at)
     VALUES (?, ?, 'extracted_metadata', 'application/json', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
  );

  const planned: PlannedAsset[] = Array.from({ length: counts.assetCount }, (_, index) => {
    const kind = kindForIndex(index, counts);
    const extension = extensionForKind(kind, index);
    const folderIndex = index % folderIds.length;
    const rootIndex = Math.floor(folderIndex / CHILD_FOLDERS_PER_ROOT);
    const childIndex = folderIndex % CHILD_FOLDERS_PER_ROOT;
    const filename = `asset-${pad(index)}.${extension}`;
    const relativePath = `Root-${pad(rootIndex, 2)}/Child-${pad(childIndex, 2)}/${filename}`;
    const geometry = kind === 'image'
      ? imageGeometryForIndex(index)
      : kind === 'video'
        ? videoGeometry()
        : undefined;
    return { index, kind, extension, folderIndex, filename, relativePath, geometry };
  });

  const imagePool = writeFiles ? await prepareImagePool(libraryPath, planned) : new Map<string, string>();
  const videoPool = writeFiles ? prepareVideoPool(libraryPath, planned) : [];
  const artifactsDir = path.join(libraryPath, '.serpent', 'artifacts');
  if (writeFiles) mkdirSync(artifactsDir, { recursive: true });
  const byteSizes = new Map<string, number>();

  if (writeFiles) {
    await mapPool(planned, FILE_WRITE_CONCURRENCY, async (item) => {
      const absolutePath = path.join(libraryPath, 'Assets', item.relativePath);
      if (item.kind === 'video') {
        const matching = videoPool.filter((poolPath) => poolPath.endsWith(`.${item.extension}`));
        const source = matching.length > 0
          ? matching[item.index % matching.length]
          : videoPool[item.index % videoPool.length];
        if (!source) throw new Error('Video pool was empty.');
        copyFileSync(source, absolutePath);
        byteSizes.set(item.relativePath, statSync(absolutePath).size);
        return;
      }
      if (item.kind === 'image' && item.geometry) {
        const source = imagePool.get(imagePoolKey(item.extension, item.geometry));
        if (!source) throw new Error(`Image pool missed ${item.extension} ${item.geometry.width}x${item.geometry.height}.`);
        copyFileSync(source, absolutePath);
        byteSizes.set(item.relativePath, statSync(absolutePath).size);
        return;
      }
      const bytes = await createAssetBytes(item.kind, item.index, item.extension);
      writeFileSync(absolutePath, bytes);
      byteSizes.set(item.relativePath, bytes.byteLength);
    });
  }

  let searchTokenAssetCount = 0;
  const assetIds: string[] = [];
  database.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
  try {
    for (const item of planned) {
      const assetId = `large-asset-${pad(item.index)}`;
      const revisionId = `large-revision-${pad(item.index)}`;
      const pathIdentity = item.relativePath.toLocaleLowerCase('en-US');
      const description = item.index % 29 === 0
        ? `Large library fixture ${item.index}; ${LARGE_LIBRARY_SEARCH_TOKEN} description`
        : `Large library fixture asset ${item.index} (${item.kind}).`;
      const hasSearchToken = item.index % 17 === 0 || item.index % 29 === 0;
      if (hasSearchToken) searchTokenAssetCount += 1;
      const tags = [
        TAG_NAMES[item.index % TAG_NAMES.length]!,
        TAG_NAMES[(item.index + 2) % TAG_NAMES.length]!,
        ...(item.index % 17 === 0 ? [LARGE_LIBRARY_SEARCH_TOKEN] : []),
      ];
      const tagText = tags.join(' ');
      const rating = item.index % 6;
      const favorite = item.index % 13 === 0 ? 1 : 0;
      const byteSize = byteSizes.get(item.relativePath) ?? (1024 + (item.index % 97));

      insertAsset.run(
        assetId,
        folderIds[item.folderIndex],
        item.relativePath,
        revisionId,
        pathIdentity,
        now,
        now,
      );
      insertRevision.run(revisionId, assetId, byteSize, now, item.filename, now);
      if (writeFiles && item.geometry && (item.kind === 'image' || item.kind === 'video')) {
        const durationMs = item.kind === 'video' ? videoDurationMs() : null;
        writeExtractedMetadataArtifact(
          artifactsDir,
          revisionId,
          item.kind === 'video'
            ? {
              width: item.geometry.width,
              height: item.geometry.height,
              durationMs,
              videoCodec: item.extension === 'webm' ? 'vp9' : 'mpeg4',
            }
            : { width: item.geometry.width, height: item.geometry.height },
          item.geometry,
          durationMs,
          item.kind === 'video' ? VIDEO_METADATA_GENERATOR : EXTRACTED_METADATA_GENERATOR,
          insertArtifact,
        );
      }
      insertMetadata.run(
        assetId,
        description,
        rating,
        favorite,
        `https://example.test/serpent/large/${pad(item.index)}`,
        now,
      );
      insertSearchIndex.run(
        assetId,
        normalizeSearchText(item.filename),
        normalizeSearchText(tagText),
        normalizeSearchText(description),
        normalizeSearchText(`https://example.test/serpent/large/${pad(item.index)}`),
        normalizeSearchText(item.relativePath),
        normalizeSearchText(`rating:${rating} kind:${item.kind} type:${item.extension}`),
      );
      for (const tagIndex of [item.index % TAG_NAMES.length, (item.index + 2) % TAG_NAMES.length]) {
        insertAssetTag.run(assetId, tagIds[tagIndex]);
      }
      if (item.index % 17 === 0) {
        insertAssetTag.run(assetId, tagIds[tagIds.length - 1]);
      }
      const memberships = new Set([
        item.index % collectionIds.length,
        (item.index * 7 + 3) % collectionIds.length,
        (item.index * 13 + 11) % collectionIds.length,
      ]);
      let position = 0;
      for (const collectionIndex of memberships) {
        insertCollectionAsset.run(collectionIds[collectionIndex], assetId, position);
        position += 1;
      }
      assetIds.push(assetId);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
  return {
    searchTokenAssetCount,
    sampleAssetId: assetIds[0]!,
  };
}

export async function ensureLargeLibraryFixture(
  options: EnsureLargeLibraryFixtureOptions,
): Promise<LargeLibraryFixtureManifest> {
  const outputPath = assertSafeOutputPath(options.outputPath);
  const assetCount = options.assetCount ?? LARGE_LIBRARY_ASSET_COUNT;
  const seed = options.seed ?? 20260816;
  const writeFiles = options.writeFiles ?? true;
  const counts = mixCountsFor(assetCount);

  const existing = readExistingManifest(outputPath);
  if (existing && !options.reset) {
    if (
      existing.version !== LARGE_LIBRARY_FIXTURE_VERSION
      || existing.assetCount !== assetCount
      || existing.seed !== seed
    ) {
      throw new Error(
        `Fixture already exists with version=${existing.version}, assets=${existing.assetCount}, seed=${existing.seed}; pass --reset to rebuild.`,
      );
    }
    return existing;
  }
  if (existsSync(outputPath)) {
    if (!options.reset) throw new Error(`Output path exists without a compatible manifest: ${outputPath}`);
    rmSync(outputPath, { force: true, recursive: true });
  }
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
  try {
    const library = service.createLibrary({
      displayName: path.basename(outputPath),
      selectedParentPath: path.dirname(outputPath),
    });
    const folders = [] as Array<{ folderId: string; relativePath: string }>;
    for (let rootIndex = 0; rootIndex < ROOT_FOLDER_COUNT; rootIndex += 1) {
      const root = service.createManagedFolder({
        libraryId: library.libraryId,
        name: `Root-${pad(rootIndex, 2)}`,
      });
      for (let childIndex = 0; childIndex < CHILD_FOLDERS_PER_ROOT; childIndex += 1) {
        const child = service.createManagedFolder({
          libraryId: library.libraryId,
          name: `Child-${pad(childIndex, 2)}`,
          parentFolderId: root.folderId,
        });
        folders.push({ folderId: child.folderId, relativePath: child.relativePath });
      }
    }
    const tags = TAG_NAMES.map((name) => service.createTag({ libraryId: library.libraryId, name }));
    const searchTag = service.createTag({ libraryId: library.libraryId, name: LARGE_LIBRARY_SEARCH_TOKEN });
    const collections = [] as Array<{ collectionId: string }>;
    const parentCollections = [] as Array<{ collectionId: string }>;
    for (let index = 0; index < 10; index += 1) {
      const collection = service.createCollection({
        libraryId: library.libraryId,
        name: `Collection-${pad(index, 2)}`,
      });
      parentCollections.push(collection);
      collections.push(collection);
    }
    for (let index = 10; index < COLLECTION_COUNT; index += 1) {
      const collection = service.createCollection({
        libraryId: library.libraryId,
        parentId: parentCollections[index % parentCollections.length]!.collectionId,
        name: `Collection-${pad(index, 2)}`,
      });
      collections.push(collection);
    }

    service.closeAll();
    for (const folder of folders) mkdirSync(path.join(library.libraryPath, 'Assets', folder.relativePath), { recursive: true });
    const seeded = await seedDatabase(
      library.libraryPath,
      folders.map((folder) => folder.folderId),
      [...tags, searchTag].map((tag) => tag.tagId),
      collections.map((collection) => collection.collectionId),
      counts,
      writeFiles,
    );
    const manifest: LargeLibraryFixtureManifest = {
      version: LARGE_LIBRARY_FIXTURE_VERSION,
      seed,
      libraryId: library.libraryId,
      libraryPath: library.libraryPath,
      assetCount,
      imageCount: counts.imageCount,
      videoCount: counts.videoCount,
      modelCount: counts.modelCount,
      textCount: counts.textCount,
      audioCount: counts.audioCount,
      unsupportedCount: counts.unsupportedCount,
      folderCount: folders.length + ROOT_FOLDER_COUNT,
      collectionCount: collections.length,
      tagCount: tags.length + 1,
      searchToken: LARGE_LIBRARY_SEARCH_TOKEN,
      searchTokenAssetCount: seeded.searchTokenAssetCount,
      sampleAssetId: seeded.sampleAssetId,
      sampleFolderId: folders[0]!.folderId,
      generatedAt: new Date().toISOString(),
    };
    writeFileSync(manifestPath(library.libraryPath), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    service.closeAll();
  }
}
