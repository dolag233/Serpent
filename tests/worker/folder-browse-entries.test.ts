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
  };
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

const VALID_1X1_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
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
    expect(entryA.childFolderCount).toBe(1);
    expect(entryA.coverArtifactIds).toEqual([artifactId]);
    expect(entryB.directAssetCount).toBe(0);
    expect(entryB.coverArtifactIds).toEqual([]);

    const withCounts = service.listManagedFolders(library.libraryId);
    expect(withCounts.find((folder) => folder.folderId === childA.folderId)).toMatchObject({
      directAssetCount: 1,
      childFolderCount: 1,
    });
    expect(withCounts.find((folder) => folder.folderId === parent.folderId)).toMatchObject({
      directAssetCount: 0,
      childFolderCount: 2,
    });

    service.closeAll();
  });
});
