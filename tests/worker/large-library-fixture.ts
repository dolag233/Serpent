import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { LibraryService } from '../../src/worker/library-service';
import { normalizeSearchText } from '../../src/worker/search-query';

const require = createRequire(import.meta.url);

interface DatabaseConnection {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): {
    run(...parameters: unknown[]): { changes: number };
  };
}

const Database = require('better-sqlite3') as new (filename: string) => DatabaseConnection;

export const LARGE_LIBRARY_FIXTURE_VERSION = 1;
export const LARGE_LIBRARY_SEARCH_TOKEN = 'serpent-large-library-needle';
export const LARGE_LIBRARY_ASSET_COUNT = 10_000;

const IMAGE_EXTENSIONS = ['jpg', 'png', 'webp', 'gif', 'tiff', 'bmp', 'psd', 'svg'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'avi'];
const OTHER_EXTENSIONS = ['txt', 'wav', 'mp3', 'fbx', 'blend', 'obj', 'json'];
const ROOT_FOLDER_COUNT = 10;
const CHILD_FOLDERS_PER_ROOT = 15;
const COLLECTION_COUNT = 50;
const TAG_NAMES = ['ABCD-A', 'ABCD-B', 'ABCD-C', 'ABCD-D', 'ABCD-E', 'ABCD-F'];

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const FILE_BYTES: Record<string, Buffer> = {
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  png: ONE_PIXEL_PNG,
  webp: Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'ascii'),
  gif: Buffer.from('GIF89a', 'ascii'),
  tiff: Buffer.from('II*\x00\x08\x00\x00\x00', 'ascii'),
  bmp: Buffer.from('BM', 'ascii'),
  psd: Buffer.from('8BPS\x00\x01', 'ascii'),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8'),
  mp4: Buffer.from('ftypisom', 'ascii'),
  webm: Buffer.from('\x1a\x45\xdf\xa3', 'binary'),
  mov: Buffer.from('ftypqt', 'ascii'),
  mkv: Buffer.from('\x1a\x45\xdf\xa3', 'binary'),
  avi: Buffer.from('RIFF\x00\x00\x00\x00AVI ', 'ascii'),
  txt: Buffer.from('Serpent large-library fixture\n', 'utf8'),
  wav: Buffer.from('RIFF\x00\x00\x00\x00WAVE', 'ascii'),
  mp3: Buffer.from('ID3', 'ascii'),
  fbx: Buffer.from('; FBX 7.4.0 project file\n', 'utf8'),
  blend: Buffer.from('BLENDER', 'ascii'),
  obj: Buffer.from('# Serpent fixture\n', 'utf8'),
  json: Buffer.from('{"fixture":"serpent-large-library"}\n', 'utf8'),
};

export interface LargeLibraryFixtureManifest {
  version: number;
  seed: number;
  libraryId: string;
  libraryPath: string;
  assetCount: number;
  imageCount: number;
  videoCount: number;
  otherCount: number;
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

function pad(value: number, width = 5): string {
  return value.toString().padStart(width, '0');
}

function extensionFor(index: number, assetCount: number): string {
  if (index < assetCount * 0.85) {
    return IMAGE_EXTENSIONS[index % IMAGE_EXTENSIONS.length]!;
  }
  if (index < assetCount * 0.95) {
    return VIDEO_EXTENSIONS[index % VIDEO_EXTENSIONS.length]!;
  }
  return OTHER_EXTENSIONS[index % OTHER_EXTENSIONS.length]!;
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

function seedDatabase(
  libraryPath: string,
  folderIds: string[],
  tagIds: string[],
  collectionIds: string[],
  assetCount: number,
  writeFiles: boolean,
): { searchTokenAssetCount: number; sampleAssetId: string } {
  const database = new Database(path.join(libraryPath, '.serpent', 'library.db'));
  const now = '2026-08-15T00:00:00.000Z';
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

  let searchTokenAssetCount = 0;
  const assetIds: string[] = [];
  database.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
  try {
    for (let index = 0; index < assetCount; index += 1) {
      const assetId = `large-asset-${pad(index)}`;
      const revisionId = `large-revision-${pad(index)}`;
      const folderIndex = index % folderIds.length;
      const rootIndex = Math.floor(folderIndex / CHILD_FOLDERS_PER_ROOT);
      const childIndex = folderIndex % CHILD_FOLDERS_PER_ROOT;
      const extension = extensionFor(index, assetCount);
      const filename = `asset-${pad(index)}.${extension}`;
      const relativePath = `Root-${pad(rootIndex, 2)}/Child-${pad(childIndex, 2)}/${filename}`;
      const pathIdentity = relativePath.toLocaleLowerCase('en-US');
      const description = index % 29 === 0
        ? `Large library fixture ${index}; ${LARGE_LIBRARY_SEARCH_TOKEN} description`
        : `Large library fixture asset ${index} with deterministic metadata.`;
      const hasSearchToken = index % 17 === 0 || index % 29 === 0;
      if (hasSearchToken) searchTokenAssetCount += 1;
      const tags = [
        TAG_NAMES[index % TAG_NAMES.length]!,
        TAG_NAMES[(index + 2) % TAG_NAMES.length]!,
        ...(index % 17 === 0 ? [LARGE_LIBRARY_SEARCH_TOKEN] : []),
      ];
      const tagText = tags.join(' ');
      const rating = index % 6;
      const favorite = index % 13 === 0 ? 1 : 0;
      const byteSize = FILE_BYTES[extension]!.byteLength + (index % 97);

      if (writeFiles) {
        const absolutePath = path.join(libraryPath, 'Assets', relativePath);
        writeFileSync(absolutePath, FILE_BYTES[extension]!);
      }

      insertAsset.run(
        assetId,
        folderIds[folderIndex],
        relativePath,
        revisionId,
        pathIdentity,
        now,
        now,
      );
      insertRevision.run(revisionId, assetId, byteSize, now, filename, now);
      insertMetadata.run(
        assetId,
        description,
        rating,
        favorite,
        `https://example.test/serpent/large/${pad(index)}`,
        now,
      );
      insertSearchIndex.run(
        assetId,
        normalizeSearchText(filename),
        normalizeSearchText(tagText),
        normalizeSearchText(description),
        normalizeSearchText(`https://example.test/serpent/large/${pad(index)}`),
        normalizeSearchText(relativePath),
        normalizeSearchText(`rating:${rating} type:${extension}`),
      );
      for (const tagIndex of [index % TAG_NAMES.length, (index + 2) % TAG_NAMES.length]) {
        insertAssetTag.run(assetId, tagIds[tagIndex]);
      }
      if (index % 17 === 0) {
        insertAssetTag.run(assetId, tagIds[tagIds.length - 1]);
      }
      const memberships = new Set([
        index % collectionIds.length,
        (index * 7 + 3) % collectionIds.length,
        (index * 13 + 11) % collectionIds.length,
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

export function ensureLargeLibraryFixture(
  options: EnsureLargeLibraryFixtureOptions,
): LargeLibraryFixtureManifest {
  const outputPath = assertSafeOutputPath(options.outputPath);
  const assetCount = options.assetCount ?? LARGE_LIBRARY_ASSET_COUNT;
  const seed = options.seed ?? 20260815;
  const writeFiles = options.writeFiles ?? true;
  if (!Number.isInteger(assetCount) || assetCount < 1_000) {
    throw new Error('Large-library fixture assetCount must be an integer >= 1000.');
  }

  const existing = readExistingManifest(outputPath);
  if (existing && !options.reset) {
    if (existing.version !== LARGE_LIBRARY_FIXTURE_VERSION || existing.assetCount !== assetCount || existing.seed !== seed) {
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
    const seeded = seedDatabase(
      library.libraryPath,
      folders.map((folder) => folder.folderId),
      [...tags, searchTag].map((tag) => tag.tagId),
      collections.map((collection) => collection.collectionId),
      assetCount,
      writeFiles,
    );
    const manifest: LargeLibraryFixtureManifest = {
      version: LARGE_LIBRARY_FIXTURE_VERSION,
      seed,
      libraryId: library.libraryId,
      libraryPath: library.libraryPath,
      assetCount,
      imageCount: Math.floor(assetCount * 0.85),
      videoCount: Math.floor(assetCount * 0.10),
      otherCount: assetCount - Math.floor(assetCount * 0.85) - Math.floor(assetCount * 0.10),
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
