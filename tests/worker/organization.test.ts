import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService, LibraryServiceError } from '../../src/worker/library-service';

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
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-org-test-'));
  temporaryRoots.push(root);
  return root;
}

function expectServiceCode(operation: () => unknown, code: LibraryServiceError['code']): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(LibraryServiceError);
  expect((thrown as LibraryServiceError).code).toBe(code);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

// ── Helper: create a library with a managed asset via direct DB insertion ──

function createLibraryWithAsset(): {
  service: LibraryService;
  libraryId: string;
  libraryPath: string;
  assetId: string;
} {
  const root = temporaryRoot();
  const service = new LibraryService();
  const library = service.createLibrary({ displayName: 'Org', selectedParentPath: root });

  // Create a managed folder and an asset on disk + in DB so tags/collections can reference it.
  const managedFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Assets' });
  const assetFileName = 'test.png';
  const assetsPath = path.join(library.libraryPath, 'Assets', managedFolder.relativePath);
  mkdirSync(assetsPath, { recursive: true });
  writeFileSync(path.join(assetsPath, assetFileName), 'test content');

  const db = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
  const assetId = randomUUID();
  const revisionId = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
        relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
    ).run(
      assetId,
      managedFolder.folderId,
      `${managedFolder.relativePath}/${assetFileName}`,
      `${managedFolder.relativePath}/${assetFileName}`,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
        modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
    ).run(revisionId, assetId, 12, now, assetFileName, now);
    db.prepare('UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?').run(
      revisionId,
      now,
      assetId,
    );
  } finally {
    db.close();
  }

  return { service, libraryId: library.libraryId, libraryPath: library.libraryPath, assetId };
}

function createSecondAsset(
  libraryPath: string,
  managedFolderRelativePath: string,
  managedFolderId: string,
): string {
  const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  const assetId = randomUUID();
  const revisionId = randomUUID();
  const now = new Date().toISOString();
  const fileName = `${assetId}.png`;
  try {
    db.prepare(
      `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
        relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
    ).run(
      assetId,
      managedFolderId,
      `${managedFolderRelativePath}/${fileName}`,
      `${managedFolderRelativePath}/${fileName}`,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
        modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'import', ?)`,
    ).run(revisionId, assetId, 8, now, fileName, now);
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

// ── Tags ──────────────────────────────────────────────────────────────

describe('tags', () => {
  it('creates a tag and lists it with assetCount', () => {
    const { service, libraryId } = createLibraryWithAsset();

    const tag = service.createTag({ libraryId, name: '  Character  ' });
    expect(tag).toMatchObject({ name: 'Character', assetCount: 0 });

    const list = service.listTags(libraryId);
    expect(list).toEqual([tag]);
    service.closeAll();
  });

  it('enforces NOCASE-unique tag name per library', () => {
    const { service, libraryId } = createLibraryWithAsset();

    service.createTag({ libraryId, name: 'Hero' });
    expectServiceCode(
      () => service.createTag({ libraryId, name: 'hero' }),
      'FOLDER_ALREADY_EXISTS',
    );
    expectServiceCode(
      () => service.createTag({ libraryId, name: 'HERO' }),
      'FOLDER_ALREADY_EXISTS',
    );
    service.closeAll();
  });

  it('isolates tag names across libraries', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const root2 = temporaryRoot();
    const lib2 = service.createLibrary({ displayName: 'Lib2', selectedParentPath: root2 });

    service.createTag({ libraryId, name: 'Shared' });
    // Same name in a different library should succeed.
    const tag2 = service.createTag({ libraryId: lib2.libraryId, name: 'Shared' });
    expect(tag2.name).toBe('Shared');

    service.closeAll();
  });

  it('renames a tag with NOCASE-unique check', () => {
    const { service, libraryId } = createLibraryWithAsset();

    service.createTag({ libraryId, name: 'Alpha' });
    const beta = service.createTag({ libraryId, name: 'Beta' });

    const renamed = service.renameTag({ libraryId, tagId: beta.tagId, name: '  Gamma  ' });
    expect(renamed).toMatchObject({ tagId: beta.tagId, name: 'Gamma', assetCount: 0 });

    // Cannot rename to an existing name (case-insensitive).
    expectServiceCode(
      () => service.renameTag({ libraryId, tagId: beta.tagId, name: 'ALPHA' }),
      'FOLDER_ALREADY_EXISTS',
    );

    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND when renaming a missing tag', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.renameTag({ libraryId, tagId: 'nonexistent', name: 'Nope' }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('deletes a tag and cascades to human_asset_tags', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'ToDelete' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    const tagId = service.deleteTag({ libraryId, tagId: tag.tagId });
    expect(tagId).toBe(tag.tagId);

    // The tag should be gone from list.
    const list = service.listTags(libraryId);
    expect(list.find((t) => t.tagId === tag.tagId)).toBeUndefined();

    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND when deleting a missing tag', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.deleteTag({ libraryId, tagId: 'nonexistent' }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });
});

// ── Tag assignment ────────────────────────────────────────────────────

describe('tag assignment', () => {
  it('assigns tags to assets and counts assignments', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const alpha = service.createTag({ libraryId, name: 'Alpha' });
    const beta = service.createTag({ libraryId, name: 'Beta' });

    const result = service.assignTags({
      libraryId,
      assetIds: [assetId],
      tagIds: [alpha.tagId, beta.tagId],
    });
    expect(result.assignedCount).toBe(2);

    // Verify assetCount on listed tags.
    const list = service.listTags(libraryId);
    const alphaSummary = list.find((t) => t.tagId === alpha.tagId);
    const betaSummary = list.find((t) => t.tagId === beta.tagId);
    expect(alphaSummary?.assetCount).toBe(1);
    expect(betaSummary?.assetCount).toBe(1);

    service.closeAll();
  });

  it('is idempotent on tag assignment', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'Idem' });

    const first = service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(first.assignedCount).toBe(1);

    const second = service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(second.assignedCount).toBe(0);

    const list = service.listTags(libraryId);
    expect(list.find((t) => t.tagId === tag.tagId)?.assetCount).toBe(1);

    service.closeAll();
  });

  it('rejects assignment with nonexistent asset', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'Ghost' });
    expectServiceCode(
      () => service.assignTags({ libraryId, assetIds: ['nonexistent'], tagIds: [tag.tagId] }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('rejects assignment with nonexistent tag', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.assignTags({ libraryId, assetIds: [assetId], tagIds: ['nonexistent'] }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('removes tags and counts removals', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const alpha = service.createTag({ libraryId, name: 'Alpha' });
    const beta = service.createTag({ libraryId, name: 'Beta' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [alpha.tagId, beta.tagId] });

    const result = service.removeTags({
      libraryId,
      assetIds: [assetId],
      tagIds: [alpha.tagId],
    });
    expect(result.removedCount).toBe(1);

    const list = service.listTags(libraryId);
    expect(list.find((t) => t.tagId === alpha.tagId)?.assetCount).toBe(0);
    expect(list.find((t) => t.tagId === beta.tagId)?.assetCount).toBe(1);

    service.closeAll();
  });

  it('is idempotent on tag removal', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const tag = service.createTag({ libraryId, name: 'RemoveMe' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    const first = service.removeTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(first.removedCount).toBe(1);

    const second = service.removeTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });
    expect(second.removedCount).toBe(0);

    service.closeAll();
  });

  it('supports bulk cross-product assignment', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAsset();
    const managedFolder = service.listManagedFolders(libraryId)[0]!;
    const assetId2 = createSecondAsset(libraryPath, managedFolder.relativePath, managedFolder.folderId);

    const t1 = service.createTag({ libraryId, name: 'T1' });
    const t2 = service.createTag({ libraryId, name: 'T2' });

    const result = service.assignTags({
      libraryId,
      assetIds: [assetId, assetId2],
      tagIds: [t1.tagId, t2.tagId],
    });
    // 2 assets x 2 tags = 4 assignments
    expect(result.assignedCount).toBe(4);

    const removeResult = service.removeTags({
      libraryId,
      assetIds: [assetId, assetId2],
      tagIds: [t1.tagId, t2.tagId],
    });
    expect(removeResult.removedCount).toBe(4);

    service.closeAll();
  });
});

// ── Collections ───────────────────────────────────────────────────────

describe('collections', () => {
  it('creates a root collection with sequential positions', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const c1 = service.createCollection({ libraryId, name: '  First  ' });
    const c2 = service.createCollection({ libraryId, name: 'Second' });

    expect(c1).toMatchObject({
      name: 'First', parentId: null, position: 0, assetCount: 0, childCollectionCount: 0,
    });
    expect(c2).toMatchObject({
      name: 'Second', parentId: null, position: 1, assetCount: 0, childCollectionCount: 0,
    });

    const list = service.listCollections(libraryId);
    expect(list).toEqual([c1, c2]);
    service.closeAll();
  });

  it('creates a nested collection tree', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const parent = service.createCollection({ libraryId, name: 'Parent' });
    const child = service.createCollection({ libraryId, parentId: parent.collectionId, name: 'Child' });
    const sibling = service.createCollection({ libraryId, parentId: parent.collectionId, name: 'Sibling' });

    expect(child.parentId).toBe(parent.collectionId);
    expect(child.position).toBe(0);
    expect(sibling.parentId).toBe(parent.collectionId);
    expect(sibling.position).toBe(1);

    const list = service.listCollections(libraryId);
    const parentSummary = list.find((c) => c.collectionId === parent.collectionId);
    expect(parentSummary?.childCollectionCount).toBe(2);

    service.closeAll();
  });

  it('rejects creating a collection under a nonexistent parent', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.createCollection({ libraryId, parentId: 'nonexistent', name: 'Orphan' }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('deletes a collection and cascades to children', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const parent = service.createCollection({ libraryId, name: 'Parent' });
    service.createCollection({ libraryId, parentId: parent.collectionId, name: 'Child' });

    const deletedId = service.deleteCollection({ libraryId, collectionId: parent.collectionId });
    expect(deletedId).toBe(parent.collectionId);

    const list = service.listCollections(libraryId);
    expect(list).toEqual([]);

    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND when deleting a missing collection', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.deleteCollection({ libraryId, collectionId: 'nonexistent' }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('updates collection fields partially', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const col = service.createCollection({ libraryId, name: 'Original' });

    const updated = service.updateCollection({
      libraryId,
      collectionId: col.collectionId,
      name: '  Renamed  ',
      description: 'A description',
    });
    expect(updated).toMatchObject({
      collectionId: col.collectionId,
      name: 'Renamed',
      description: 'A description',
      parentId: null,
      position: col.position,
      coverAssetId: null,
    });

    // Partial: only update position.
    const moved = service.updateCollection({
      libraryId,
      collectionId: col.collectionId,
      position: 99,
    });
    expect(moved.position).toBe(99);
    expect(moved.name).toBe('Renamed');
    expect(moved.description).toBe('A description');

    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND when updating a missing collection', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.updateCollection({ libraryId, collectionId: 'nonexistent', name: 'Nope' }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });
});

// ── Collection assets ─────────────────────────────────────────────────

describe('collection assets', () => {
  it('adds assets to a collection and lists them', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAsset();
    const managedFolder = service.listManagedFolders(libraryId)[0]!;
    const assetId2 = createSecondAsset(libraryPath, managedFolder.relativePath, managedFolder.folderId);

    const col = service.createCollection({ libraryId, name: 'Coll' });

    const addResult = service.addCollectionAssets({
      libraryId,
      collectionId: col.collectionId,
      assetIds: [assetId, assetId2],
    });
    expect(addResult.collectionId).toBe(col.collectionId);

    // Verify assetCount in list.
    const list = service.listCollections(libraryId);
    expect(list.find((c) => c.collectionId === col.collectionId)?.assetCount).toBe(2);

    // List assets non-recursive.
    const assets = service.listCollectionAssets({
      libraryId,
      collectionId: col.collectionId,
      recursive: false,
    });
    expect(assets).toHaveLength(2);
    expect(assets.map((a) => a.assetId).sort()).toEqual([assetId, assetId2].sort());

    service.closeAll();
  });

  it('removes assets from a collection', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    const col = service.createCollection({ libraryId, name: 'Coll' });
    service.addCollectionAssets({ libraryId, collectionId: col.collectionId, assetIds: [assetId] });

    const removeResult = service.removeCollectionAssets({
      libraryId,
      collectionId: col.collectionId,
      assetIds: [assetId],
    });
    expect(removeResult.collectionId).toBe(col.collectionId);

    const assets = service.listCollectionAssets({
      libraryId,
      collectionId: col.collectionId,
      recursive: false,
    });
    expect(assets).toEqual([]);

    // Idempotent: removing again does not error.
    const again = service.removeCollectionAssets({
      libraryId,
      collectionId: col.collectionId,
      assetIds: [assetId],
    });
    expect(again.collectionId).toBe(col.collectionId);

    service.closeAll();
  });

  it('reorders collection assets with full position replacement', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAsset();
    const managedFolder = service.listManagedFolders(libraryId)[0]!;
    const assetId2 = createSecondAsset(libraryPath, managedFolder.relativePath, managedFolder.folderId);
    const assetId3 = createSecondAsset(libraryPath, managedFolder.relativePath, managedFolder.folderId);

    const col = service.createCollection({ libraryId, name: 'Coll' });
    service.addCollectionAssets({
      libraryId,
      collectionId: col.collectionId,
      assetIds: [assetId, assetId2, assetId3],
    });

    // Reverse the order.
    const reorderResult = service.reorderCollectionAssets({
      libraryId,
      collectionId: col.collectionId,
      orderedAssetIds: [assetId3, assetId2, assetId],
    });
    expect(reorderResult.collectionId).toBe(col.collectionId);

    const assets = service.listCollectionAssets({
      libraryId,
      collectionId: col.collectionId,
      recursive: false,
    });
    expect(assets.map((a) => a.assetId)).toEqual([assetId3, assetId2, assetId]);

    service.closeAll();
  });

  it('rejects collection asset operations on nonexistent collection', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () =>
        service.addCollectionAssets({
          libraryId,
          collectionId: 'nonexistent',
          assetIds: ['also-fake'],
        }),
      'FOLDER_NOT_FOUND',
    );
    expectServiceCode(
      () =>
        service.listCollectionAssets({
          libraryId,
          collectionId: 'nonexistent',
          recursive: false,
        }),
      'FOLDER_NOT_FOUND',
    );
    expectServiceCode(
      () =>
        service.reorderCollectionAssets({
          libraryId,
          collectionId: 'nonexistent',
          orderedAssetIds: ['some-id'],
        }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('rejects adding nonexistent assets', () => {
    const { service, libraryId } = createLibraryWithAsset();
    const col = service.createCollection({ libraryId, name: 'Coll' });
    expectServiceCode(
      () =>
        service.addCollectionAssets({
          libraryId,
          collectionId: col.collectionId,
          assetIds: ['nonexistent'],
        }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('lists collection assets recursively with dedup', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAsset();
    const managedFolder = service.listManagedFolders(libraryId)[0]!;
    const assetId2 = createSecondAsset(libraryPath, managedFolder.relativePath, managedFolder.folderId);

    // Tree: Parent -> Child
    //   Parent has assetId
    //   Child has assetId (duplicate) + assetId2
    const parent = service.createCollection({ libraryId, name: 'Parent' });
    const child = service.createCollection({ libraryId, parentId: parent.collectionId, name: 'Child' });

    service.addCollectionAssets({ libraryId, collectionId: parent.collectionId, assetIds: [assetId] });
    service.addCollectionAssets({ libraryId, collectionId: child.collectionId, assetIds: [assetId, assetId2] });

    // Non-recursive on parent: only assetId.
    const nonRecursive = service.listCollectionAssets({
      libraryId,
      collectionId: parent.collectionId,
      recursive: false,
    });
    expect(nonRecursive).toHaveLength(1);
    expect(nonRecursive[0]!.assetId).toBe(assetId);

    // Recursive on parent: assetId (deduped) + assetId2 = 2.
    const recursive = service.listCollectionAssets({
      libraryId,
      collectionId: parent.collectionId,
      recursive: true,
    });
    const ids = recursive.map((a) => a.assetId).sort();
    expect(ids).toEqual([assetId, assetId2].sort());
    expect(recursive).toHaveLength(2);

    service.closeAll();
  });
});

// ── Asset Metadata ─────────────────────────────────────────────────────

describe('asset metadata', () => {
  it('returns defaults when no metadata row exists', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    const metadata = service.getAssetMetadata({ libraryId, assetId });
    expect(metadata).toMatchObject({
      assetId,
      label: null,
      description: null,
      rating: 0,
      favorite: false,
      palette: null,
      sourcePageUrl: null,
      entityVersion: 0,
    });
    service.closeAll();
  });

  it('throws ASSET_NOT_FOUND for nonexistent asset', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () => service.getAssetMetadata({ libraryId, assetId: 'nonexistent' }),
      'ASSET_NOT_FOUND',
    );
    service.closeAll();
  });

  it('creates metadata row on first set (expectedVersion=0) and increments version', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    const result = service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      label: 'Hero',
      rating: 4,
      favorite: true,
    });
    expect(result.entityVersion).toBe(1);
    expect(result.label).toBe('Hero');
    expect(result.rating).toBe(4);
    expect(result.favorite).toBe(true);

    // Second set with expectedVersion=1 should succeed and bump to 2.
    const result2 = service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 1,
      rating: 5,
    });
    expect(result2.entityVersion).toBe(2);
    expect(result2.rating).toBe(5);
    expect(result2.label).toBe('Hero'); // unchanged

    service.closeAll();
  });

  it('throws VERSION_CONFLICT on optimistic lock mismatch', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    // First write: creates row with entityVersion=1.
    service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      label: 'First',
    });

    // Attempt with stale expectedVersion=0.
    expectServiceCode(
      () =>
        service.setAssetMetadata({
          libraryId,
          assetId,
          expectedVersion: 0,
          label: 'Stale',
        }),
      'VERSION_CONFLICT',
    );

    // Attempt with wrong expectedVersion (should be 1).
    expectServiceCode(
      () =>
        service.setAssetMetadata({
          libraryId,
          assetId,
          expectedVersion: 2,
          label: 'Wrong',
        }),
      'VERSION_CONFLICT',
    );

    service.closeAll();
  });

  it('throws VERSION_CONFLICT when inserting with expectedVersion != 0 and no row exists', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();
    expectServiceCode(
      () =>
        service.setAssetMetadata({
          libraryId,
          assetId,
          expectedVersion: 1,
          label: 'Bad',
        }),
      'VERSION_CONFLICT',
    );
    service.closeAll();
  });

  it('enforces rating boundary 0-5', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    // Valid boundaries.
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 0, rating: 0 });
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 1, rating: 5 });

    // Out of bounds rejected at service level.
    expectServiceCode(
      () => service.setAssetMetadata({ libraryId, assetId, expectedVersion: 2, rating: -1 }),
      'INVALID_IMPORT_DECISION',
    );
    expectServiceCode(
      () => service.setAssetMetadata({ libraryId, assetId, expectedVersion: 2, rating: 6 }),
      'INVALID_IMPORT_DECISION',
    );

    service.closeAll();
  });

  it('enforces palette <= 20 entries', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    // 20 entries should be fine.
    const palette20 = Array.from({ length: 20 }, (_, i) => `#${String(i).padStart(6, '0')}`);
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 0, palette: palette20 });

    // 21 entries should be rejected at service level.
    const palette21 = Array.from({ length: 21 }, (_, i) => `#${String(i).padStart(6, '0')}`);
    expectServiceCode(
      () =>
        service.setAssetMetadata({
          libraryId,
          assetId,
          expectedVersion: 1,
          palette: palette21,
        }),
      'INVALID_IMPORT_DECISION',
    );

    service.closeAll();
  });

  it('backfill is idempotent and fills missing rows', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAsset();
    const managedFolder = service.listManagedFolders(libraryId)[0]!;
    const assetId2 = createSecondAsset(libraryPath, managedFolder.relativePath, managedFolder.folderId);

    // Initially no metadata rows exist.
    const meta1 = service.getAssetMetadata({ libraryId, assetId });
    expect(meta1.entityVersion).toBe(0);

    // First backfill.
    const first = service.backfillAssetMetadata(libraryId);
    expect(first.backfilledCount).toBeGreaterThanOrEqual(2);

    // Second backfill is idempotent.
    const second = service.backfillAssetMetadata(libraryId);
    expect(second.backfilledCount).toBe(0);

    // Both assets now have metadata default rows.
    const metaAfter1 = service.getAssetMetadata({ libraryId, assetId });
    expect(metaAfter1.entityVersion).toBe(1);
    expect(metaAfter1.rating).toBe(0);
    expect(metaAfter1.favorite).toBe(false);

    const metaAfter2 = service.getAssetMetadata({ libraryId, assetId: assetId2 });
    expect(metaAfter2.entityVersion).toBe(1);

    service.closeAll();
  });

  it('AssetSummary reflects label/rating/favorite after metadata.set', () => {
    const { service, libraryId, assetId } = createLibraryWithAsset();

    // Before metadata: defaults.
    const assetsBefore = service.listAssets({ libraryId, recursive: true });
    const before = assetsBefore.find((a) => a.assetId === assetId)!;
    expect(before.label).toBeNull();
    expect(before.rating).toBe(0);
    expect(before.favorite).toBe(false);

    // Set metadata.
    service.setAssetMetadata({
      libraryId,
      assetId,
      expectedVersion: 0,
      label: 'Masterpiece',
      rating: 5,
      favorite: true,
    });

    // After metadata: populated.
    const assetsAfter = service.listAssets({ libraryId, recursive: true });
    const after = assetsAfter.find((a) => a.assetId === assetId)!;
    expect(after.label).toBe('Masterpiece');
    expect(after.rating).toBe(5);
    expect(after.favorite).toBe(true);

    service.closeAll();
  });
});

// ── Smart Collections ───────────────────────────────────────────────────

describe('smart collections', () => {
  it('creates and lists smart collections', () => {
    const { service, libraryId } = createLibraryWithAsset();

    const sc = service.createSmartCollection({
      libraryId,
      name: '  High Rated  ',
      queryDefinitionJson: '{"query":"{\\"rating\\":{\\"$gte\\":4}}","sort":"{\\"rating\\":\\"desc\\"}"}',
    });
    expect(sc).toMatchObject({
      name: 'High Rated',
      queryDefinition: '{"query":"{\\"rating\\":{\\"$gte\\":4}}","sort":"{\\"rating\\":\\"desc\\"}"}',
      position: 0,
    });
    expect(sc.collectionId).toBeTruthy();

    const list = service.listSmartCollections(libraryId);
    expect(list).toEqual([sc]);

    service.closeAll();
  });

  it('updates smart collection fields partially', () => {
    const { service, libraryId } = createLibraryWithAsset();

    const sc = service.createSmartCollection({
      libraryId,
      name: 'Original',
      queryDefinitionJson: '{"query":"{}","sort":"{}"}',
    });

    const updated = service.updateSmartCollection({
      libraryId,
      collectionId: sc.collectionId,
      name: '  Updated  ',
      queryDefinitionJson: '{"query":"{\\"favorite\\":true}","sort":"{}"}',
    });
    expect(updated).toMatchObject({
      collectionId: sc.collectionId,
      name: 'Updated',
      queryDefinition: '{"query":"{\\"favorite\\":true}","sort":"{}"}',
      position: 0,
    });

    // Partial: only update position.
    const updated2 = service.updateSmartCollection({
      libraryId,
      collectionId: sc.collectionId,
      position: 5,
    });
    expect(updated2.name).toBe('Updated');
    expect(updated2.position).toBe(5);

    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND when updating a missing smart collection', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () =>
        service.updateSmartCollection({
          libraryId,
          collectionId: 'nonexistent',
          name: 'Nope',
        }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('deletes a smart collection', () => {
    const { service, libraryId } = createLibraryWithAsset();

    const sc = service.createSmartCollection({
      libraryId,
      name: 'ToDelete',
      queryDefinitionJson: '{"query":"{}","sort":"{}"}',
    });

    const deletedId = service.deleteSmartCollection({
      libraryId,
      collectionId: sc.collectionId,
    });
    expect(deletedId).toBe(sc.collectionId);

    const list = service.listSmartCollections(libraryId);
    expect(list).toEqual([]);

    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND when deleting a missing smart collection', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () =>
        service.deleteSmartCollection({
          libraryId,
          collectionId: 'nonexistent',
        }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('enforces unique name per library', () => {
    const { service, libraryId } = createLibraryWithAsset();
    service.createSmartCollection({
      libraryId,
      name: 'Unique',
      queryDefinitionJson: '{}',
    });
    expectServiceCode(
      () =>
        service.createSmartCollection({
          libraryId,
          name: 'Unique',
          queryDefinitionJson: '{}',
        }),
      'FOLDER_ALREADY_EXISTS',
    );
    service.closeAll();
  });

  it('rejects invalid JSON in queryDefinitionJson', () => {
    const { service, libraryId } = createLibraryWithAsset();
    expectServiceCode(
      () =>
        service.createSmartCollection({ libraryId, name: 'Bad', queryDefinitionJson: 'not json' }),
      'INVALID_IMPORT_DECISION',
    );
    service.closeAll();
  });

  it('executes a smart collection and returns results', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAsset();
    const managedFolder = service.listManagedFolders(libraryId)[0]!;
    const assetId2 = createSecondAsset(libraryPath, managedFolder.relativePath, managedFolder.folderId);

    // Set distinct ratings so we can filter.
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 0, rating: 5, label: 'Masterpiece' });
    service.setAssetMetadata({ libraryId, assetId: assetId2, expectedVersion: 0, rating: 1, label: 'Sketch' });

    // Create smart collection for rating >= 4.
    const sc = service.createSmartCollection({
      libraryId,
      name: 'High Rated',
      queryDefinitionJson: JSON.stringify({
        filters: [{ field: 'rating', values: ['4', '5'], exclude: false }],
        sort: { field: 'rating', order: 'desc' },
      }),
    });

    const result = service.executeSmartCollection({ libraryId, collectionId: sc.collectionId });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.assetId).toBe(assetId);
    expect(result.items[0]!.label).toBe('Masterpiece');

    service.closeAll();
  });
});
