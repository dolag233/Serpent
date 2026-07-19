import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

// ── Configuration ────────────────────────────────────────────────────────
// 100k assets was the 0005 gate, but for a full round-trip export+import
// soak the bottleneck is the filesystem copy of real asset files.  Writing
// 20k small files to disk plus copying them during export takes ~10-15s on
// modern SSD; the same 100k files would exceed the 120s test timeout.
// Chosen size: 20_000 assets — large enough to detect pathological slowdown
// or data loss without timing out CI.
const ASSET_COUNT = 20_000;
const BATCH_SIZE = 1000;
const BATCH_COUNT = Math.floor(ASSET_COUNT / BATCH_SIZE);
const FILE_EXTENSIONS = ['png', 'jpg', 'psd', 'blend', 'tga'];

// Generous performance thresholds for a 20k-asset soak. Windows runs this
// filesystem-heavy workload markedly slower than macOS: NTFS metadata
// overhead plus real-time antivirus scanning of every one of the 20k
// extracted files. Keep the tight POSIX budget to still catch real
// regressions, and allow a documented, higher ceiling on Windows.
const PERF_PLATFORM_FACTOR = process.platform === 'win32' ? 2 : 1;
const EXPORT_PERF_MS = 60_000 * PERF_PLATFORM_FACTOR;
const IMPORT_PERF_MS = 60_000 * PERF_PLATFORM_FACTOR;

const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(source: string): void;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): { changes: number };
  };
  pragma(source: string): unknown;
}

const TestDatabase = require('better-sqlite3') as new (
  filename: string,
) => TestDatabaseConnection;

// ── Helpers ──────────────────────────────────────────────────────────────

function pad(index: number, width: number): string {
  return index.toString().padStart(width, '0');
}

function batchDir(index: number): string {
  return `batch_${pad(index, 2)}`;
}

function assetId(index: number): string {
  return `soak-${pad(index, 5)}`;
}

function revisionId(index: number): string {
  return `soak-rev-${pad(index, 5)}`;
}

function relativePath(folderName: string, batchIdx: number, index: number, ext: string): string {
  return `${folderName}/${batchDir(batchIdx)}/file-${pad(index, 5)}.${ext}`;
}

function displayNameFromPath(relPath: string): string {
  return path.basename(relPath);
}

// ── Fixture ──────────────────────────────────────────────────────────────

interface SoakFixture {
  libraryId: string;
  libraryPath: string;
  folderId: string;
  folderName: string;
  root: string;
  service: LibraryService;
  /** Pre-computed asset IDs in insertion order for spot-checks. */
  assetIds: string[];
  /** Map of assetId → relativeFilePath for integrity comparison. */
  relativePaths: Map<string, string>;
  /** Map of assetId → byteSize. */
  byteSizes: Map<string, number>;
  /** Map of assetId → modifiedAt. */
  modifiedAts: Map<string, string>;
  /** Map of assetId → rating. */
  ratings: Map<string, number>;
  /** Map of assetId → favorite. */
  favorites: Map<string, boolean>;
  /** Map of assetId → description. */
  descriptions: Map<string, string | null>;
  /** Number of tags created. */
  tagCount: number;
  /** Number of collections created. */
  collectionCount: number;
  /** Map of assetId → sourcePageUrl. */
  sourcePageUrls: Map<string, string | null>;
  /** Map of assetId → tag names assigned to that asset. */
  tagAssignments: Map<string, string[]>;
  /** Map of assetId → collection names assigned to that asset. */
  collectionAssignments: Map<string, string[]>;
  /** Set of asset IDs that are trashed (deleted_at IS NOT NULL). */
  trashedAssetIds: Set<string>;
}

let fixture: SoakFixture;

// ── Seed ─────────────────────────────────────────────────────────────────

function seedAssetsAndFiles(libraryPath: string, folderName: string, folderId: string): void {
  const assetsPath = path.join(libraryPath, 'Assets', folderName);
  mkdirSync(assetsPath, { recursive: true });

  // Create batch directories.
  for (let b = 0; b < BATCH_COUNT; b += 1) {
    mkdirSync(path.join(assetsPath, batchDir(b)), { recursive: true });
  }

  const dbPath = path.join(libraryPath, '.serpent', 'library.db');
  const db = new TestDatabase(dbPath);

  // Disable foreign-key enforcement during bulk inserts for performance
  // (the seeded data is self-consistent; re-enabling before close validates
  // integrity via the library's own open path).
  db.pragma('foreign_keys = OFF');

  const insertAsset = db.prepare(
    `INSERT INTO assets (
       asset_id, location_kind, managed_folder_id, linked_folder_id,
       relative_file_path, current_revision_id, availability, path_identity,
       created_at, updated_at
     ) VALUES (?, 'managed', ?, NULL, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRevision = db.prepare(
    `INSERT INTO revisions (
       revision_id, asset_id, parent_revision_id, byte_size, modified_at,
       original_filename, origin, accepted_at
     ) VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
  );
  const insertMetadata = db.prepare(
    `INSERT INTO asset_metadata (
       asset_id, description, rating, favorite, palette,
       source_page_url, entity_version, updated_at
     ) VALUES (?, ?, ?, ?, NULL, ?, 1, ?)`,
  );
  const insertSearchIndex = db.prepare(
    `INSERT INTO asset_search_index (
       asset_id, filename, tags, description, source_url,
       folder_path, metadata_text
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const baseDate = new Date('2025-06-01T00:00:00.000Z');

  db.exec('BEGIN IMMEDIATE');
  try {
    let idx = 0;
    for (let b = 0; b < BATCH_COUNT; b += 1) {
      for (let i = 0; i < BATCH_SIZE; i += 1, idx += 1) {
        const ext = FILE_EXTENSIONS[idx % FILE_EXTENSIONS.length]!;
        const aid = assetId(idx);
        const rid = revisionId(idx);
        const relPath = relativePath(folderName, b, i, ext);
        const filename = displayNameFromPath(relPath);

        // Vary byte size: 100–1024 bytes, cycling every 4 assets.
        const byteSize = 100 + (idx % 4) * 231;
        // Vary modified_at: spread across 2025-06-01 to 2026-06-01.
        const modifiedDate = new Date(baseDate.getTime() + (idx % 365) * 86_400_000);
        const modifiedAt = modifiedDate.toISOString();
        const now = modifiedAt; // Use same timestamp for created_at/updated_at for simplicity.

        // Varied metadata.
        const description = idx % 25 === 0
          ? `Soak test asset #${idx} with varied metadata for round-trip integrity check.`
          : null;
        const rating = idx % 6;
        const favorite = idx % 13 === 0 ? 1 : 0;
        const sourceUrl = idx % 7 === 0
          ? `https://example.test/soak/${pad(idx, 5)}`
          : null;

        const availability = 'available';

        // Write actual file on disk.
        const content = Buffer.alloc(byteSize, (idx % 256));
        writeFileSync(path.join(assetsPath, batchDir(b), `file-${pad(i, 5)}.${ext}`), content);

        insertAsset.run(
          aid,
          folderId,
          relPath,
          rid,
          availability,
          relPath.toLocaleLowerCase('en-US'),
          now,
          now,
        );
        insertRevision.run(rid, aid, byteSize, now, filename, now);
        insertMetadata.run(
          aid,
          description,
          rating,
          favorite,
          sourceUrl,
          now,
        );
        insertSearchIndex.run(
          aid,
          filename,
          '', // tags will be populated if applicable; default empty
          description ?? '',
          sourceUrl ?? '',
          folderName,
          `rating:${rating}`,
        );
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  // Seed tags (10 tags).
  const tagNames = ['concept', 'reference', 'final', 'wip', 'texture', 'model', 'animation', 'ui', 'icon', 'logo'];
  const tagIds: string[] = [];
  const now = new Date().toISOString();
  for (const tagName of tagNames) {
    const tagId = `soak-tag-${tagName}`;
    db.prepare(
      'INSERT OR IGNORE INTO tags (tag_id, library_id, name, created_at) VALUES (?, (SELECT library_id FROM library LIMIT 1), ?, ?)',
    ).run(tagId, tagName, now);
    tagIds.push(tagId);
  }

  // Assign tags to ~10% of assets (every 10th asset gets 1 random tag).
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let idx = 0; idx < ASSET_COUNT; idx += 1) {
      if (idx % 10 !== 0) continue;
      const tagIdx = idx % tagIds.length;
      const tagId = tagIds[tagIdx]!;
      db.prepare(
        'INSERT OR IGNORE INTO human_asset_tags (asset_id, tag_id) VALUES (?, ?)',
      ).run(assetId(idx), tagId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  // Seed collections (5 collections).
  const collectionNames = ['Favorites', 'Concepts', 'Textures', 'UI Assets', 'Completed'];
  const collectionIds: string[] = [];
  for (const colName of collectionNames) {
    const colId = `soak-col-${colName.toLowerCase().replace(/\s+/g, '-')}`;
    db.prepare(
      'INSERT OR IGNORE INTO collections (collection_id, library_id, name, parent_id, position, created_at, updated_at) VALUES (?, (SELECT library_id FROM library LIMIT 1), ?, NULL, 0, ?, ?)',
    ).run(colId, colName, now, now);
    collectionIds.push(colId);
  }

  // Assign collections to ~5% of assets (every 20th asset gets added to 1 collection).
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let idx = 0; idx < ASSET_COUNT; idx += 1) {
      if (idx % 20 !== 0) continue;
      const colIdx = idx % collectionIds.length;
      const colId = collectionIds[colIdx]!;
      db.prepare(
        'INSERT OR IGNORE INTO collection_assets (collection_id, asset_id, position) VALUES (?, ?, ?)',
      ).run(colId, assetId(idx), idx);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  // Trash the first 10 assets using the real library-service API after
  // the library is reopened.  Direct SQL SET deleted_at is avoided; this
  // exercises the API path including file move to .serpent/trash, the
  // operation manifest, and the trashed_from_relative_path column.
  // NOTE: This step runs in beforeAll after seedAssetsAndFiles and
  // service.openLibrary, so it is not inside the DB seed function.

  db.pragma('foreign_keys = ON');
  db.close();
}

// ── Setup / Teardown ─────────────────────────────────────────────────────

beforeAll(() => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-soak-export-import-'));
  const noObservers = () => ({ close() {} });
  const service = new LibraryService({ observerFactory: noObservers });

  const library = service.createLibrary({
    displayName: 'SoakExportImport',
    selectedParentPath: root,
  });
  const folder = service.createManagedFolder({
    libraryId: library.libraryId,
    name: 'Soak',
  });

  const folderName = folder.name;
  const assetIds: string[] = [];
  const relativePaths = new Map<string, string>();
  const byteSizes = new Map<string, number>();
  const modifiedAts = new Map<string, string>();
  const ratings = new Map<string, number>();
  const favorites = new Map<string, boolean>();
  const descriptions = new Map<string, string | null>();
  const sourcePageUrls = new Map<string, string | null>();

  // Pre-compute expected values for verification.
  const baseDate = new Date('2025-06-01T00:00:00.000Z');
  let idx = 0;
  for (let b = 0; b < BATCH_COUNT; b += 1) {
    for (let i = 0; i < BATCH_SIZE; i += 1, idx += 1) {
      const ext = FILE_EXTENSIONS[idx % FILE_EXTENSIONS.length]!;
      const aid = assetId(idx);
      const relPath = relativePath(folderName, b, i, ext);
      const byteSize = 100 + (idx % 4) * 231;
      const modifiedDate = new Date(baseDate.getTime() + (idx % 365) * 86_400_000);
      const rating = idx % 6;
      const favorite = idx % 13 === 0;

      assetIds.push(aid);
      relativePaths.set(aid, relPath);
      byteSizes.set(aid, byteSize);
      modifiedAts.set(aid, modifiedDate.toISOString());
      ratings.set(aid, rating);
      favorites.set(aid, favorite);
      descriptions.set(
        aid,
        idx % 25 === 0
          ? `Soak test asset #${idx} with varied metadata for round-trip integrity check.`
          : null,
      );
      sourcePageUrls.set(
        aid,
        idx % 7 === 0
          ? `https://example.test/soak/${pad(idx, 5)}`
          : null,
      );
    }
  }

  service.closeAll();
  seedAssetsAndFiles(library.libraryPath, folderName, folder.folderId);
  const reopened = service.openLibrary(library.libraryPath);

  // Pre-compute tag assignments (mirrors seed logic: every 10th asset gets tag "concept").
  const tagAssignments = new Map<string, string[]>();
  for (let idx = 0; idx < ASSET_COUNT; idx += 1) {
    if (idx % 10 !== 0) continue;
    tagAssignments.set(assetId(idx), ['concept']);
  }

  // Pre-compute collection assignments (mirrors seed logic: every 20th asset goes to "Favorites").
  const collectionAssignments = new Map<string, string[]>();
  for (let idx = 0; idx < ASSET_COUNT; idx += 1) {
    if (idx % 20 !== 0) continue;
    collectionAssignments.set(assetId(idx), ['Favorites']);
  }

  // Trash the first 10 assets using the real LibraryService API (not direct
  // SQL).  This exercises the full trash path: file move to .serpent/trash,
  // trashed_from_relative_path recording, operation manifest.  The API also
  // changes relative_file_path to __trash__/{assetId}/{filename} — update
  // the fixture's relativePaths map accordingly.
  const trashedAssetIds = new Set<string>();
  const trashIds: string[] = [];
  for (let idx = 0; idx < 10; idx += 1) {
    const aid = assetId(idx);
    trashedAssetIds.add(aid);
    trashIds.push(aid);
    // Update expected path to match what trashAssets writes.
    const orig = relativePaths.get(aid)!;
    const filename = path.posix.basename(orig);
    relativePaths.set(aid, `__trash__/${aid}/${filename}`);
  }
  service.trashAssets({
    libraryId: reopened.libraryId,
    assetIds: trashIds,
  });

  // Verify .serpent/trash directory exists after trash API call.
  const trashDir = path.join(library.libraryPath, '.serpent', 'trash');
  expect(existsSync(trashDir), '.serpent/trash must exist after API trash').toBe(true);
  const trashContents = readdirSync(trashDir);
  expect(
    trashContents.length,
    '.serpent/trash must contain at least 1 trashed file',
  ).toBeGreaterThan(0);

  fixture = {
    libraryId: reopened.libraryId,
    libraryPath: library.libraryPath,
    folderId: folder.folderId,
    folderName,
    root,
    service,
    assetIds,
    relativePaths,
    byteSizes,
    modifiedAts,
    ratings,
    favorites,
    descriptions,
    sourcePageUrls,
    tagAssignments,
    collectionAssignments,
    trashedAssetIds,
    tagCount: 10,
    collectionCount: 5,
  };
}, 180_000);

afterAll(() => {
  fixture?.service.closeAll();
  if (fixture?.root) rmSync(fixture.root, { force: true, recursive: true });
}, 30_000);

// ── Verify helper ────────────────────────────────────────────────────────

function verifyRoundTripIntegrity(
  importedService: LibraryService,
  importedLibraryId: string,
  label: string,
): void {
  // 1. Asset count matches.
  const sourceAssets = fixture.service.listAssets({
    libraryId: fixture.libraryId,
    recursive: true,
  });
  const importedAssets = importedService.listAssets({
    libraryId: importedLibraryId,
    recursive: true,
  });
  expect(importedAssets.length).toBe(sourceAssets.length);
  expect(importedAssets.length).toBe(ASSET_COUNT);

  // 2. Build lookup maps for the imported assets.
  const importedByAssetId = new Map(
    importedAssets.map((a) => [a.assetId, a]),
  );

  // 3. Spot-check 200 random-ish assets for field-level integrity.
  const spotCheckCount = 200;
  const step = Math.max(1, Math.floor(ASSET_COUNT / spotCheckCount));
  let checkedCount = 0;
  for (let s = 0; s < ASSET_COUNT; s += step) {
    if (checkedCount >= spotCheckCount) break;
    const aid = fixture.assetIds[s]!;
    const imported = importedByAssetId.get(aid);
    expect(imported, `[${label}] missing asset ${aid}`).toBeDefined();
    if (!imported) continue;

    // relativeFilePath
    expect(
      imported.relativeFilePath,
      `[${label}] asset ${aid} relativeFilePath mismatch`,
    ).toBe(fixture.relativePaths.get(aid));
    // byteSize
    expect(
      imported.byteSize,
      `[${label}] asset ${aid} byteSize mismatch`,
    ).toBe(fixture.byteSizes.get(aid));
    // locationKind
    expect(imported.locationKind).toBe('managed');

    checkedCount += 1;
  }

  // 4. Check metadata for a smaller sample.
  const metadataCheckCount = 50;
  const metaStep = Math.max(1, Math.floor(ASSET_COUNT / metadataCheckCount));
  let metaChecked = 0;
  for (let s = 0; s < ASSET_COUNT; s += metaStep) {
    if (metaChecked >= metadataCheckCount) break;
    const aid = fixture.assetIds[s]!;
    const sourceMeta = fixture.service.getAssetMetadata({
      libraryId: fixture.libraryId,
      assetId: aid,
    });
    const importedMeta = importedService.getAssetMetadata({
      libraryId: importedLibraryId,
      assetId: aid,
    });

    expect(importedMeta.rating, `[${label}] asset ${aid} rating mismatch`).toBe(sourceMeta.rating);
    expect(importedMeta.favorite, `[${label}] asset ${aid} favorite mismatch`).toBe(sourceMeta.favorite);
    expect(
      importedMeta.description,
      `[${label}] asset ${aid} description mismatch`,
    ).toBe(sourceMeta.description);
    expect(
      importedMeta.sourcePageUrl,
      `[${label}] asset ${aid} sourcePageUrl mismatch`,
    ).toBe(sourceMeta.sourcePageUrl);
    expect(
      importedMeta.palette,
      `[${label}] asset ${aid} palette mismatch`,
    ).toBe(sourceMeta.palette);
    expect(
      importedMeta.entityVersion,
      `[${label}] asset ${aid} entityVersion mismatch`,
    ).toBe(sourceMeta.entityVersion);

    metaChecked += 1;
  }

  // 5. Tags: count and tag names preserved.
  const sourceTags = fixture.service.listTags(fixture.libraryId);
  const importedTags = importedService.listTags(importedLibraryId);
  expect(importedTags.length).toBe(fixture.tagCount);
  expect(importedTags.length).toBe(sourceTags.length);
  for (const sourceTag of sourceTags) {
    const importedTag = importedTags.find((t) => t.name === sourceTag.name);
    expect(importedTag, `[${label}] missing tag "${sourceTag.name}"`).toBeDefined();
  }

  // 6. Collections: count and names preserved.
  const sourceCollections = fixture.service.listCollections(fixture.libraryId);
  const importedCollections = importedService.listCollections(importedLibraryId);
  expect(importedCollections.length).toBe(fixture.collectionCount);
  expect(importedCollections.length).toBe(sourceCollections.length);
  for (const sourceCol of sourceCollections) {
    const importedCol = importedCollections.find((c) => c.name === sourceCol.name);
    expect(importedCol, `[${label}] missing collection "${sourceCol.name}"`).toBeDefined();
  }

  // 5b. Tags: per-tag asset count preserved across round-trip.
  for (const sourceTag of sourceTags) {
    const importedTag = importedTags.find((t) => t.name === sourceTag.name);
    expect(importedTag, `[${label}] missing tag "${sourceTag.name}" for count check`).toBeDefined();
    expect(
      importedTag!.assetCount,
      `[${label}] tag "${sourceTag.name}" assetCount: src=${sourceTag.assetCount} imp=${importedTag!.assetCount}`,
    ).toBe(sourceTag.assetCount);
  }

  // 6b. Collections: per-collection asset count preserved across round-trip.
  for (const sourceCol of sourceCollections) {
    const importedCol = importedCollections.find((c) => c.name === sourceCol.name);
    expect(importedCol, `[${label}] missing collection "${sourceCol.name}" for count check`).toBeDefined();
    expect(
      importedCol!.assetCount,
      `[${label}] collection "${sourceCol.name}" assetCount: src=${sourceCol.assetCount} imp=${importedCol!.assetCount}`,
    ).toBe(sourceCol.assetCount);
  }

  // 7. Revisions, trash, physical trash directory, and per-asset
  //    tag/collection links via direct SQLite on the imported library.
  {
    const libs = importedService.listLibraries();
    const importedPath = libs[0]!.libraryPath;

    // 7a0. Physical .serpent/trash directory verification.
    const trashDir = path.join(importedPath, '.serpent', 'trash');
    expect(
      existsSync(trashDir),
      `[${label}] .serpent/trash must exist after round-trip`,
    ).toBe(true);
    const trashFiles = readdirSync(trashDir);
    expect(
      trashFiles.length,
      `[${label}] .serpent/trash must contain trashed files`,
    ).toBeGreaterThan(0);
    const dbPath = path.join(importedPath, '.serpent', 'library.db');
    const db = new TestDatabase(dbPath);

    // 7a. Revision count: seed creates exactly 1 revision per asset.
    const revRow = db
      .prepare('SELECT COUNT(*) AS cnt FROM revisions')
      .get() as { cnt: number };
    expect(
      revRow.cnt,
      `[${label}] revision count mismatch: expected ${ASSET_COUNT}, got ${revRow.cnt}`,
    ).toBe(ASSET_COUNT);

    // 7b. Trash state: verify trashed assets survived the round-trip.
    // Trash is signalled by deleted_at IS NOT NULL (not by availability).
    const trashRow = db
      .prepare(
        'SELECT COUNT(*) AS cnt FROM assets WHERE deleted_at IS NOT NULL',
      )
      .get() as { cnt: number };
    expect(
      trashRow.cnt,
      `[${label}] trash count mismatch: expected ${fixture.trashedAssetIds.size}, got ${trashRow.cnt}`,
    ).toBe(fixture.trashedAssetIds.size);

    // 7c. Per-asset tag links: spot-check tagged assets still have the
    //     same tags after import.
    const getAssetTags = db.prepare(
      `SELECT t.name FROM human_asset_tags hat
         JOIN tags t ON t.tag_id = hat.tag_id
        WHERE hat.asset_id = ?`,
    );
    const taggedAssetList = [...fixture.tagAssignments.keys()];
    const tagSampleSize = 100;
    const tagStep = Math.max(1, Math.floor(taggedAssetList.length / tagSampleSize));
    let tagChecked = 0;
    for (let i = 0; i < taggedAssetList.length && tagChecked < tagSampleSize; i += tagStep) {
      const aid = taggedAssetList[i]!;
      const expectedTags = fixture.tagAssignments.get(aid)!.slice().sort();
      const actualTags = (getAssetTags.all(aid) as Array<{ name: string }>)
        .map((r) => r.name)
        .sort();
      expect(
        actualTags,
        `[${label}] tags mismatch for asset ${aid}: expected ${JSON.stringify(expectedTags)}, got ${JSON.stringify(actualTags)}`,
      ).toEqual(expectedTags);
      tagChecked += 1;
    }

    // 7d. Per-asset collection links: spot-check collectioned assets
    //     still belong to the same collections after import.
    const getAssetCollections = db.prepare(
      `SELECT c.name FROM collection_assets ca
         JOIN collections c ON c.collection_id = ca.collection_id
        WHERE ca.asset_id = ?`,
    );
    const colAssetList = [...fixture.collectionAssignments.keys()];
    const colSampleSize = 100;
    const colStep = Math.max(1, Math.floor(colAssetList.length / colSampleSize));
    let colChecked = 0;
    for (let i = 0; i < colAssetList.length && colChecked < colSampleSize; i += colStep) {
      const aid = colAssetList[i]!;
      const expectedCols = fixture.collectionAssignments.get(aid)!.slice().sort();
      const actualCols = (getAssetCollections.all(aid) as Array<{ name: string }>)
        .map((r) => r.name)
        .sort();
      expect(
        actualCols,
        `[${label}] collections mismatch for asset ${aid}: expected ${JSON.stringify(expectedCols)}, got ${JSON.stringify(actualCols)}`,
      ).toEqual(expectedCols);
      colChecked += 1;
    }

    db.close();
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Library import/export soak (20k assets)', () => {
  it(
    'folder export/import round-trip preserves counts and sampled asset data, tags, and collections',
    async () => {
      // Export.
      const exportDest = path.join(fixture.root, 'export-folder');
      const exportStartedAt = performance.now();
      const exported = await fixture.service.exportLibraryToFolder({
        libraryId: fixture.libraryId,
        destinationPath: exportDest,
        includeLinkedContent: false,
      });
      const exportElapsedMs = performance.now() - exportStartedAt;

      expect(exported.fileCount).toBeGreaterThan(0);
      expect(exported.totalBytes).toBeGreaterThan(0);
      expect(exported.includedLinkedContent).toBe(false);
      expect(exported.durationMs).toBeGreaterThan(0);

      console.info(
        `[soak] folder-export ${exportElapsedMs.toFixed(0)}ms ` +
        `files=${exported.fileCount} bytes=${exported.totalBytes}`,
      );

      expect(exportElapsedMs).toBeLessThan(EXPORT_PERF_MS);

      // Import the exported folder using a fresh service to avoid library-id
      // conflict (the exported DB snapshot has the same library_id as source).
      const importService = new LibraryService();
      const importParent = path.join(fixture.root, 'import-folder');
      mkdirSync(importParent, { recursive: true });

      try {
        const importStartedAt = performance.now();
        const imported = await importService.importLibraryFromFolder({
          sourceFolderPath: exportDest,
          copyToParentPath: importParent,
        });
        const importElapsedMs = performance.now() - importStartedAt;

        console.info(`[soak] folder-import ${importElapsedMs.toFixed(0)}ms libraryId=${imported.libraryId}`);

        expect(imported.libraryId).toBeTruthy();
        expect(imported.displayName).toBe('SoakExportImport');
        expect(importElapsedMs).toBeLessThan(IMPORT_PERF_MS);

        // Verify round-trip integrity.
        verifyRoundTripIntegrity(importService, imported.libraryId, 'folder');
      } finally {
        importService.closeAll();
      }
    },
    EXPORT_PERF_MS + IMPORT_PERF_MS + 30_000,
  );

  it(
    'ZIP export/import round-trip preserves counts and sampled asset data, tags, and collections',
    async () => {
      // Export to ZIP.
      const zipDest = path.join(fixture.root, 'export.zip');
      const exportStartedAt = performance.now();
      const exported = await fixture.service.exportLibraryToZip({
        libraryId: fixture.libraryId,
        destinationPath: zipDest,
        includeLinkedContent: false,
      });
      const exportElapsedMs = performance.now() - exportStartedAt;

      expect(exported.fileCount).toBeGreaterThan(0);
      expect(exported.totalBytes).toBeGreaterThan(0);
      expect(exported.includedLinkedContent).toBe(false);
      expect(exported.durationMs).toBeGreaterThan(0);

      console.info(
        `[soak] zip-export ${exportElapsedMs.toFixed(0)}ms ` +
        `files=${exported.fileCount} bytes=${exported.totalBytes}`,
      );

      expect(exportElapsedMs).toBeLessThan(EXPORT_PERF_MS);

      // Import from ZIP using a fresh service to avoid library-id conflict.
      const importService = new LibraryService();
      const importParent = path.join(fixture.root, 'import-zip');
      mkdirSync(importParent, { recursive: true });

      try {
        const importStartedAt = performance.now();
        const imported = await importService.importLibraryFromZip({
          sourceZipPath: zipDest,
          destinationParentPath: importParent,
        });
        const importElapsedMs = performance.now() - importStartedAt;

        console.info(`[soak] zip-import ${importElapsedMs.toFixed(0)}ms libraryId=${imported.libraryId}`);

        expect(imported.libraryId).toBeTruthy();
        expect(imported.displayName).toBe('SoakExportImport');
        expect(importElapsedMs).toBeLessThan(IMPORT_PERF_MS);

        // Verify round-trip integrity.
        verifyRoundTripIntegrity(importService, imported.libraryId, 'zip');
      } finally {
        importService.closeAll();
      }
    },
    EXPORT_PERF_MS + IMPORT_PERF_MS + 30_000,
  );

  it('source library remains usable after export operations', () => {
    // Verify the source library is still fully functional after both exports.
    const assets = fixture.service.listAssets({
      libraryId: fixture.libraryId,
      recursive: true,
    });
    expect(assets.length).toBe(ASSET_COUNT);

    // Basic operations still work.
    const tags = fixture.service.listTags(fixture.libraryId);
    expect(tags.length).toBe(fixture.tagCount);

    const collections = fixture.service.listCollections(fixture.libraryId);
    expect(collections.length).toBe(fixture.collectionCount);
  });
});
