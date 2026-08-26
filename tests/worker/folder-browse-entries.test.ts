import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

interface TestDatabaseConnection {
  close(): void;
  prepare(source: string): {
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown;
  };
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

// Cover-scene scheduling tests need a real derived-thumbnail candidate rather
// than a source-direct image.
const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAACAEAAAABCAIAAAAqtLKbAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAOklEQVRYhe3YQQ0AAAgDMeRMImInBh+kySno8yZbESBAgAABAgQIECBAgAABAgQIECBAgAABAnk3zA9mXOIiDxU7WQAAAABJRU5ErkJggg==',
  'base64',
);

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-folder-browse-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('folder browse entries', () => {
  it('lists direct child folders with direct asset counts and cover artifact ids', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Browse', selectedParentPath: root });

    const parent = service.createManagedFolder({ libraryId: library.libraryId, name: 'Parent' });
    const childA = service.createManagedFolder({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
      name: 'ChildA',
    });
    const childB = service.createManagedFolder({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
      name: 'ChildB',
    });
    service.createManagedFolder({
      libraryId: library.libraryId,
      parentFolderId: childA.folderId,
      name: 'Grandchild',
    });

    const fixture = path.join(root, 'sample.png');
    writeFileSync(fixture, VALID_1X1_PNG);
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      targetFolderId: childA.folderId,
      sourceKind: 'files',
      sourcePaths: [fixture],
    });
    if ('importId' in imported) {
      throw new Error('unexpected conflict plan');
    }
    const asset = imported.assets[0]!;

    const artifactId = 'art_cover_test';
    const db = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          width, height, generator_version, status, generated_at)
       VALUES (?, ?, 'thumbnail', 'image/png', 68, ?, 1, 1, 'test', 'ready', ?)`,
    ).run(
      artifactId,
      asset.currentRevisionId,
      'artifacts/cover.png',
      new Date().toISOString(),
    );
    db.close();

    const atRoot = service.listFolderBrowseEntries({
      libraryId: library.libraryId,
      parentFolderId: null,
    });
    expect(atRoot.map((entry) => entry.folderId)).toEqual([parent.folderId]);
    expect(atRoot[0]).toMatchObject({
      locationKind: 'managed',
      name: 'Parent',
      directAssetCount: 0,
      // Serpent-toh: parent badge includes assets under ChildA.
      recursiveAssetCount: 1,
      childFolderCount: 2,
      coverArtifactIds: [],
    });

    const underParent = service.listFolderBrowseEntries({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
    });
    expect(underParent.map((entry) => entry.name)).toEqual(['ChildA', 'ChildB']);
    const entryA = underParent.find((entry) => entry.folderId === childA.folderId)!;
    const entryB = underParent.find((entry) => entry.folderId === childB.folderId)!;
    expect(entryA.directAssetCount).toBe(1);
    expect(entryA.recursiveAssetCount).toBe(1);
    expect(entryA.childFolderCount).toBe(1);
    expect(entryA.coverArtifactIds).toEqual([artifactId]);
    // Serpent-d0nv: the cover candidate asset id rides alongside the artifact
    // id so the worker can schedule the cover thumbnail scene for it.
    expect(entryA.coverAssetIds).toEqual([asset.assetId]);
    expect(entryB.directAssetCount).toBe(0);
    expect(entryB.recursiveAssetCount).toBe(0);
    expect(entryB.coverArtifactIds).toEqual([]);
    expect(entryB.coverAssetIds).toEqual([]);

    const withCounts = service.listManagedFolders(library.libraryId);
    // ManagedFolderSummary.directAssetCount is the displayed descendant total.
    expect(withCounts.find((folder) => folder.folderId === childA.folderId)).toMatchObject({
      directAssetCount: 1,
      childFolderCount: 1,
    });
    expect(withCounts.find((folder) => folder.folderId === parent.folderId)).toMatchObject({
      directAssetCount: 1,
      childFolderCount: 2,
    });

    service.closeAll();
  });

  it('caps cover candidates at three per folder and maps them to asset ids (Serpent-d0nv)', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'BrowseCovers', selectedParentPath: root });

    const parent = service.createManagedFolder({ libraryId: library.libraryId, name: 'Parent' });
    const child = service.createManagedFolder({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
      name: 'Child',
    });

    const assets: Array<{ assetId: string; currentRevisionId: string }> = [];
    for (const [index, name] of ['a.png', 'b.png', 'c.png', 'd.png'].entries()) {
      const fixture = path.join(root, name);
      // Distinct bytes per file: identical content would be flagged as a
      // suspected duplicate and return a conflict plan instead of importing.
      writeFileSync(
        fixture,
        Buffer.concat([VALID_1X1_PNG, Buffer.from([index])]),
      );
      const imported = service.prepareOrExecuteImport({
        libraryId: library.libraryId,
        targetFolderId: child.folderId,
        sourceKind: 'files',
        sourcePaths: [fixture],
      });
      if ('importId' in imported) throw new Error('unexpected conflict plan');
      assets.push(imported.assets[0]!);
    }

    const db = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    const insertArtifact = db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          width, height, generator_version, status, generated_at)
       VALUES (?, ?, 'thumbnail', 'image/png', 68, ?, 1, 1, 'test', 'ready', ?)`,
    );
    const now = new Date().toISOString();
    assets.forEach((asset, index) => {
      insertArtifact.run(
        `art_cover_${index}`,
        asset.currentRevisionId,
        `artifacts/c${index}.png`,
        now,
      );
    });
    db.close();

    const underParent = service.listFolderBrowseEntries({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
    });
    const entry = underParent.find((candidate) => candidate.folderId === child.folderId)!;
    // Path order (a/b/c) wins; the 4th asset (d) is beyond the deck cap of 3.
    expect(entry.coverArtifactIds).toEqual(['art_cover_0', 'art_cover_1', 'art_cover_2']);
    expect(entry.coverAssetIds).toEqual(
      assets.slice(0, 3).map((asset) => asset.assetId),
    );

    service.closeAll();
  });

  it('returns cover candidates without ready thumbnails and the cover scene enqueues them (Serpent-d0nv)', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'BrowseCoverCandidates', selectedParentPath: root });

    const parent = service.createManagedFolder({ libraryId: library.libraryId, name: 'Parent' });
    const child = service.createManagedFolder({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
      name: 'Child',
    });

    const assets: Array<{ assetId: string }> = [];
    for (const [index, name] of ['a.png', 'b.png', 'c.png', 'd.png'].entries()) {
      const fixture = path.join(root, name);
      writeFileSync(
        fixture,
        Buffer.concat([VALID_1X1_PNG, Buffer.from([index])]),
      );
      const imported = service.prepareOrExecuteImport({
        libraryId: library.libraryId,
        targetFolderId: child.folderId,
        sourceKind: 'files',
        sourcePaths: [fixture],
      });
      if ('importId' in imported) throw new Error('unexpected conflict plan');
      assets.push(imported.assets[0]!);
    }

    // No revision_artifacts rows at all: display covers are empty, but the
    // scheduling candidates (top-3 direct assets by path) must still be
    // returned so the cover scene can generate them.
    const underParent = service.listFolderBrowseEntries({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
    });
    const entry = underParent.find((candidate) => candidate.folderId === child.folderId)!;
    expect(entry.coverArtifactIds).toEqual([]);
    expect(entry.coverAssetIds).toEqual(
      assets.slice(0, 3).map((asset) => asset.assetId),
    );

    // The cover scene (limit 100, priority 400) enqueues the ungenerated
    // candidates; the 4th asset stays out of the queue.
    const enqueued = service.enqueueThumbnailJobs(library.libraryId, {
      assetIds: entry.coverAssetIds,
      limit: 100,
      priority: 400,
    });
    expect(enqueued).toBe(3);
    const db = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    const queued = db.prepare(
      'SELECT asset_id, priority FROM jobs WHERE kind = ? AND status = ? ORDER BY asset_id',
    ).all('generate_thumbnail', 'queued') as Array<{ asset_id: string; priority: number }>;
    db.close();
    expect(queued).toHaveLength(3);
    for (const row of queued) {
      expect(row.priority).toBe(400);
    }
    expect(queued.map((row) => row.asset_id).sort()).toEqual(
      assets.slice(0, 3).map((asset) => asset.assetId).sort(),
    );

    service.closeAll();
  });

  it('refreshes recursive ancestor counts after moving an asset between child folders', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'BrowseMove', selectedParentPath: root });
    const parent = service.createManagedFolder({ libraryId: library.libraryId, name: 'Parent' });
    const sourceFolder = service.createManagedFolder({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
      name: 'Source',
    });
    const targetFolder = service.createManagedFolder({
      libraryId: library.libraryId,
      parentFolderId: parent.folderId,
      name: 'Target',
    });
    const sourcePath = path.join(root, 'move.png');
    writeFileSync(sourcePath, VALID_1X1_PNG);
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      targetFolderId: sourceFolder.folderId,
      sourceKind: 'files',
      sourcePaths: [sourcePath],
    });
    if ('importId' in imported) throw new Error('unexpected conflict plan');
    const asset = imported.assets[0]!;

    expect(service.listManagedFolders(library.libraryId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ folderId: parent.folderId, directAssetCount: 1 }),
        expect.objectContaining({ folderId: sourceFolder.folderId, directAssetCount: 1 }),
        expect.objectContaining({ folderId: targetFolder.folderId, directAssetCount: 0 }),
      ]),
    );

    service.moveAssets({
      libraryId: library.libraryId,
      assetIds: [asset.assetId],
      targetFolderId: targetFolder.folderId,
      conflictStrategy: 'keep-both',
    });

    expect(service.listManagedFolders(library.libraryId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ folderId: parent.folderId, directAssetCount: 1 }),
        expect.objectContaining({ folderId: sourceFolder.folderId, directAssetCount: 0 }),
        expect.objectContaining({ folderId: targetFolder.folderId, directAssetCount: 1 }),
      ]),
    );
    service.closeAll();
  });
});
