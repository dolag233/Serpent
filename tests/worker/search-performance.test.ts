import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LibraryService, type AssetRefreshResult } from '../../src/worker/library-service';
import { normalizeSearchText } from '../../src/worker/search-query';

const ASSET_COUNT = 100_000;
const FIRST_PAGE_SIZE = 50;
const MAX_QUERY_MS = 1_000;
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  exec(source: string): void;
  prepare(source: string): {
    run(...parameters: unknown[]): { changes: number };
  };
  pragma(source: string): unknown;
}

const TestDatabase = require('better-sqlite3') as new (
  filename: string,
) => TestDatabaseConnection;

interface PerformanceFixture {
  folderId: string;
  libraryId: string;
  libraryPath: string;
  root: string;
  service: LibraryService;
}

let fixture: PerformanceFixture;

class SearchPerfLibraryService extends LibraryService {
  override refreshManagedAssets(libraryId: string): AssetRefreshResult {
    // Seeded rows intentionally omit on-disk files; skip refresh so availability
    // and search-index fixtures stay deterministic for the performance gate.
    return {
      changedCount: 0,
      missingCount: 0,
      assets: this.listAssets({ libraryId, recursive: true }),
    };
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function benchmark(operation: () => unknown): number {
  // The product target is interactive latency on an already-open library. One
  // unmeasured run warms SQLite's page cache and the prepared-statement path;
  // the median then removes a single scheduler hiccup from the gate.
  operation();
  const samples = Array.from({ length: 5 }, () => {
    const startedAt = performance.now();
    operation();
    return performance.now() - startedAt;
  });
  return median(samples);
}

function seedAssets(libraryPath: string, folderId: string): void {
  const databasePath = path.join(libraryPath, '.serpent', 'library.db');
  const database = new TestDatabase(databasePath);
  const now = '2026-07-13T00:00:00.000Z';

  const insertAsset = database.prepare(
    `INSERT INTO assets (
       asset_id, location_kind, managed_folder_id, linked_folder_id,
       relative_file_path, current_revision_id, availability, path_identity,
       created_at, updated_at
     ) VALUES (?, 'managed', ?, NULL, ?, ?, ?, ?, ?, ?)`,
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

  database.exec('BEGIN IMMEDIATE');
  try {
    for (let index = 0; index < ASSET_COUNT; index += 1) {
      const suffix = index.toString().padStart(6, '0');
      const assetId = `perf-asset-${suffix}`;
      const revisionId = `perf-revision-${suffix}`;
      const extension = index % 2 === 0 ? 'png' : 'jpg';
      const filename = `perf-spec-${suffix}-x.${extension}`;
      const relativePath = `Performance/${filename}`;
      const description = index % 10 === 0
        ? `Needle concept ${suffix}`
        : `Synthetic performance fixture ${index % 100}`;
      const availability = index % 20 === 0 ? 'missing' : 'available';
      const rating = index % 6;
      const favorite = index % 5 === 0 ? 1 : 0;
      const sourceUrl = index % 3 === 0 ? `https://example.test/assets/${suffix}` : null;
      const byteSize = index + 1;

      insertAsset.run(
        assetId,
        folderId,
        relativePath,
        revisionId,
        availability,
        relativePath.toLocaleLowerCase('en-US'),
        now,
        now,
      );
      insertRevision.run(revisionId, assetId, byteSize, now, filename, now);
      insertMetadata.run(
        assetId,
        description,
        rating,
        favorite,
        sourceUrl,
        now,
      );
      insertSearchIndex.run(
        assetId,
        normalizeSearchText(filename),
        normalizeSearchText(favorite ? 'favorite' : ''),
        normalizeSearchText(description),
        normalizeSearchText(sourceUrl ?? ''),
        normalizeSearchText('Performance'),
        normalizeSearchText(`rating:${rating}`),
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

beforeAll(() => {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-search-performance-'));
  const noObservers = () => ({ close() {} });
  const service = new SearchPerfLibraryService({ observerFactory: noObservers });
  const library = service.createLibrary({
    displayName: 'SearchPerformance',
    selectedParentPath: root,
  });
  const folder = service.createManagedFolder({
    libraryId: library.libraryId,
    name: 'Performance',
  });

  service.closeAll();
  seedAssets(library.libraryPath, folder.folderId);
  const reopened = service.openLibrary(library.libraryPath);
  fixture = {
    folderId: folder.folderId,
    libraryId: reopened.libraryId,
    libraryPath: library.libraryPath,
    root,
    service,
  };
}, 120_000);

afterAll(() => {
  fixture?.service.closeAll();
  if (fixture?.root) rmSync(fixture.root, { force: true, recursive: true });
});

describe('100k asset search performance gate', () => {
  it('bounds the ordinary library first page to 50 summaries', () => {
    let result: ReturnType<LibraryService['searchAssets']> | undefined;
    const elapsedMs = benchmark(() => {
      result = fixture.service.searchAssets({
        libraryId: fixture.libraryId,
        limit: FIRST_PAGE_SIZE,
        offset: 0,
      });
    });

    expect(result?.total).toBe(ASSET_COUNT);
    expect(result?.items).toHaveLength(FIRST_PAGE_SIZE);
    expect(result?.offset).toBe(0);
    console.info(`[search-perf] browse-first-page median=${elapsedMs.toFixed(1)}ms assets=${ASSET_COUNT} transferred=${result?.items.length ?? 0}`);
    // The MVP contract is a usable first screen within three seconds for a
    // 100k-asset library. This Worker page is the dominant data read on that
    // path; renderer startup is covered separately by Electron smoke tests.
    expect(elapsedMs).toBeLessThan(3_000);
  }, 10_000);

  it('keeps keyword search first-page latency below one second', () => {
    let result: ReturnType<LibraryService['searchAssets']> | undefined;
    const elapsedMs = benchmark(() => {
      result = fixture.service.searchAssets({
        libraryId: fixture.libraryId,
        query: {
          clauses: [{ field: null, values: ['needle'], exclude: false }],
        },
        limit: FIRST_PAGE_SIZE,
        offset: 0,
      });
    });

    expect(result?.total).toBe(10_000);
    expect(result?.items).toHaveLength(FIRST_PAGE_SIZE);
    expect(result?.snippets).toHaveLength(FIRST_PAGE_SIZE);
    console.info(`[search-perf] keyword median=${elapsedMs.toFixed(1)}ms assets=${ASSET_COUNT}`);
    expect(elapsedMs).toBeLessThan(MAX_QUERY_MS);
  });

  it('keeps one-character substring search interactive without FTS', () => {
    let result: ReturnType<LibraryService['searchAssets']> | undefined;
    const elapsedMs = benchmark(() => {
      result = fixture.service.searchAssets({
        libraryId: fixture.libraryId,
        query: {
          clauses: [{ field: null, values: ['y'], exclude: false }],
        },
        limit: FIRST_PAGE_SIZE,
        offset: 0,
      });
    });

    // SQLite's trigram tokenizer cannot index one-character terms. The
    // contextual fallback must therefore stay usable even when it scans the
    // current 100k-asset search scope directly.
    expect(result?.total).toBe(90_000);
    expect(result?.items).toHaveLength(FIRST_PAGE_SIZE);
    console.info(`[search-perf] one-character median=${elapsedMs.toFixed(1)}ms assets=${ASSET_COUNT}`);
    expect(elapsedMs).toBeLessThan(MAX_QUERY_MS);
  });

  it('keeps combined filter and sort first-page latency below one second', () => {
    let result: ReturnType<LibraryService['searchAssets']> | undefined;
    const elapsedMs = benchmark(() => {
      result = fixture.service.searchAssets({
        libraryId: fixture.libraryId,
        filters: [
          { field: 'format', values: ['png'], exclude: false },
          { field: 'rating', values: ['4'], exclude: false },
          { field: 'favorite', values: [], exclude: false },
          { field: 'availability', values: ['available'], exclude: false },
        ],
        sort: { field: 'byte_size', order: 'desc' },
        limit: FIRST_PAGE_SIZE,
        offset: 0,
      });
    });

    expect(result?.total).toBe(1_667);
    expect(result?.items).toHaveLength(FIRST_PAGE_SIZE);
    expect(result?.items[0]?.byteSize).toBeGreaterThan(result?.items.at(-1)?.byteSize ?? 0);
    console.info(`[search-perf] filter-sort median=${elapsedMs.toFixed(1)}ms assets=${ASSET_COUNT}`);
    expect(elapsedMs).toBeLessThan(MAX_QUERY_MS);
  });

  it('keeps reads available while a separate WAL writer transaction is active', () => {
    const writer = new TestDatabase(
      path.join(fixture.libraryPath, '.serpent', 'library.db'),
    );
    let transactionActive = false;
    try {
      expect(writer.pragma('journal_mode')).toEqual([{ journal_mode: 'wal' }]);
      writer.exec('BEGIN IMMEDIATE');
      transactionActive = true;
      // Keep this write transaction deliberately open while the service's
      // independent connection performs a read. The reader must see the last
      // committed snapshot immediately instead of raising SQLITE_BUSY.
      writer.prepare(
        `INSERT INTO assets (
           asset_id, location_kind, managed_folder_id, linked_folder_id,
           relative_file_path, current_revision_id, availability, path_identity,
           created_at, updated_at
         ) VALUES (?, 'managed', ?, NULL, ?, ?, 'available', ?, ?, ?)`,
      ).run(
        'perf-asset-concurrent',
        fixture.folderId,
        'Performance/concurrent.png',
        'perf-revision-concurrent',
        'performance/concurrent.png',
        '2026-07-13T00:00:00.000Z',
        '2026-07-13T00:00:00.000Z',
      );
      writer.prepare(
        `INSERT INTO revisions (
           revision_id, asset_id, parent_revision_id, byte_size, modified_at,
           original_filename, origin, accepted_at
         ) VALUES (?, ?, NULL, 1, ?, 'concurrent.png', 'import', ?)`,
      ).run(
        'perf-revision-concurrent',
        'perf-asset-concurrent',
        '2026-07-13T00:00:00.000Z',
        '2026-07-13T00:00:00.000Z',
      );
      writer.prepare(
        `INSERT INTO asset_search_index (
           asset_id, filename, tags, description, source_url,
           folder_path, metadata_text
         ) VALUES (?, ?, '', ?, '', ?, '')`,
      ).run(
        'perf-asset-concurrent',
        normalizeSearchText('concurrent.png'),
        normalizeSearchText('Needle concurrent'),
        normalizeSearchText('Performance'),
      );

      const whileWriting = fixture.service.searchAssets({
        libraryId: fixture.libraryId,
        query: { clauses: [{ field: null, values: ['needle'], exclude: false }] },
        limit: FIRST_PAGE_SIZE,
      });
      expect(whileWriting.total).toBe(10_000);

      writer.exec('COMMIT');
      transactionActive = false;

      const afterCommit = fixture.service.searchAssets({
        libraryId: fixture.libraryId,
        query: { clauses: [{ field: null, values: ['needle'], exclude: false }] },
        limit: FIRST_PAGE_SIZE,
      });
      expect(afterCommit.total).toBe(10_001);
    } finally {
      if (transactionActive) writer.exec('ROLLBACK');
      writer.close();
    }
  });
});
