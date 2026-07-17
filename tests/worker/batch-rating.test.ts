import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { parseWorkerRequest } from '../../src/shared/protocol/requests';
import { LibraryService, LibraryServiceError } from '../../src/worker/library-service';

// REQ-MENU-007: batch rating (`asset.rating.set`) applies one rating to a
// multi-selection with last-write-wins semantics. Unlike the versioned
// single-asset metadata write it touches only the rating column, creates
// metadata rows lazily for assets that have none, and skips unknown asset
// ids per-item like the batch tag operations.

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): { changes: number };
  };
  pragma(source: string): unknown;
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-batch-rating-test-'));
  temporaryRoots.push(root);
  return root;
}

function expectServiceCode(operation: () => unknown, code: LibraryServiceError['code']): LibraryServiceError {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LibraryServiceError);
  expect((thrown as LibraryServiceError).code).toBe(code);
  return thrown as LibraryServiceError;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function insertAsset(
  libraryPath: string,
  managedFolder: { folderId: string; relativePath: string },
): string {
  const assetsPath = path.join(libraryPath, 'Assets', managedFolder.relativePath);
  mkdirSync(assetsPath, { recursive: true });
  const assetId = randomUUID();
  const revisionId = randomUUID();
  const fileName = `${assetId}.png`;
  writeFileSync(path.join(assetsPath, fileName), 'test content');

  const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
        relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
    ).run(
      assetId,
      managedFolder.folderId,
      `${managedFolder.relativePath}/${fileName}`,
      `${managedFolder.relativePath}/${fileName}`,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
        modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
    ).run(revisionId, assetId, 12, now, fileName, now);
    db.prepare('UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?').run(
      revisionId,
      now,
      assetId,
    );
  } finally {
    db.close();
  }
  return assetId;
}

function createLibraryWithAssets(count: number): {
  service: LibraryService;
  libraryId: string;
  libraryPath: string;
  assetIds: string[];
} {
  const root = temporaryRoot();
  const service = new LibraryService();
  const library = service.createLibrary({ displayName: 'Ratings', selectedParentPath: root });
  const managedFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Assets' });
  const assetIds = Array.from({ length: count }, () =>
    insertAsset(library.libraryPath, managedFolder));
  return { service, libraryId: library.libraryId, libraryPath: library.libraryPath, assetIds };
}

describe('batch asset rating', () => {
  it('rates every requested asset and leaves other metadata fields untouched', () => {
    const { service, libraryId, assetIds } = createLibraryWithAssets(2);
    const [first, second] = assetIds as [string, string];

    // Seed the first asset with a full metadata row through the versioned
    // single-asset path; the second asset keeps no metadata row at all.
    const seeded = service.setAssetMetadata({
      libraryId,
      assetId: first,
      expectedVersion: 0,
      description: 'keep me',
      rating: 2,
      favorite: true,
    });
    expect(seeded.entityVersion).toBe(1);

    const result = service.setAssetsRating({
      libraryId,
      assetIds: [first, second],
      rating: 5,
    });
    expect(result.updatedCount).toBe(2);
    expect(result.skipped).toEqual([]);

    const firstMetadata = service.getAssetMetadata({ libraryId, assetId: first });
    expect(firstMetadata.rating).toBe(5);
    expect(firstMetadata.description).toBe('keep me');
    expect(firstMetadata.favorite).toBe(true);
    // The batch write does not bump the optimistic-lock version.
    expect(firstMetadata.entityVersion).toBe(1);

    // A metadata row is created lazily with schema defaults plus the rating.
    const secondMetadata = service.getAssetMetadata({ libraryId, assetId: second });
    expect(secondMetadata.rating).toBe(5);
    expect(secondMetadata.description).toBeNull();
    expect(secondMetadata.favorite).toBe(false);

    service.closeAll();
  });

  it('clears ratings back to zero in batch', () => {
    const { service, libraryId, assetIds } = createLibraryWithAssets(2);

    service.setAssetsRating({ libraryId, assetIds, rating: 4 });
    const cleared = service.setAssetsRating({ libraryId, assetIds, rating: 0 });
    expect(cleared.updatedCount).toBe(2);
    expect(cleared.skipped).toEqual([]);
    for (const assetId of assetIds) {
      expect(service.getAssetMetadata({ libraryId, assetId }).rating).toBe(0);
    }

    service.closeAll();
  });

  it('skips unknown asset ids and still rates the known ones', () => {
    const { service, libraryId, assetIds } = createLibraryWithAssets(1);
    const [assetId] = assetIds as [string];

    const result = service.setAssetsRating({
      libraryId,
      assetIds: [assetId, 'nonexistent'],
      rating: 3,
    });
    expect(result.updatedCount).toBe(1);
    expect(result.skipped).toEqual([{ assetId: 'nonexistent', reason: 'asset_not_found' }]);
    expect(service.getAssetMetadata({ libraryId, assetId }).rating).toBe(3);

    // A batch targeting only unknown assets is a no-op, not an error.
    const noop = service.setAssetsRating({
      libraryId,
      assetIds: ['nonexistent'],
      rating: 1,
    });
    expect(noop.updatedCount).toBe(0);
    expect(noop.skipped).toEqual([{ assetId: 'nonexistent', reason: 'asset_not_found' }]);

    service.closeAll();
  });

  it('rejects out-of-range ratings before touching any asset', () => {
    const { service, libraryId, assetIds } = createLibraryWithAssets(1);
    const [assetId] = assetIds as [string];

    for (const rating of [-1, 6, 2.5, Number.NaN]) {
      expectServiceCode(
        () => service.setAssetsRating({ libraryId, assetIds: [assetId], rating }),
        'INVALID_ASSET_METADATA',
      );
    }
    // No metadata row was created by the rejected writes.
    expect(service.getAssetMetadata({ libraryId, assetId }).entityVersion).toBe(0);

    service.closeAll();
  });

  it('enforces the same rating bounds at the protocol boundary', () => {
    for (const rating of [0, 5]) {
      expect(parseWorkerRequest({
        requestId: `rating-${rating}`,
        command: {
          type: 'asset.rating.set',
          libraryId: 'library-01',
          assetIds: ['asset-01', 'asset-02'],
          rating,
        },
      }).command).toMatchObject({ type: 'asset.rating.set', rating });
    }

    for (const rating of [-1, 6, 2.5, '4']) {
      expect(() => parseWorkerRequest({
        requestId: 'rating-invalid',
        command: {
          type: 'asset.rating.set',
          libraryId: 'library-01',
          assetIds: ['asset-01'],
          rating,
        },
      })).toThrow();
    }

    // The batch contract requires at least one asset id.
    expect(() => parseWorkerRequest({
      requestId: 'rating-empty',
      command: {
        type: 'asset.rating.set',
        libraryId: 'library-01',
        assetIds: [],
        rating: 3,
      },
    })).toThrow();
  });
});
