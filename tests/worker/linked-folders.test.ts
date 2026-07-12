import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
  };
  pragma(source: string): unknown;
}

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-linked-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('Linked folders schema migration', () => {
  it('migrates a v3 library to v4 with a linked_folders table and linked asset columns', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked', selectedParentPath: root });
    service.closeAll();

    service.openLibrary(created.libraryPath);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    try {
      expect(database.pragma('user_version')).toEqual([{ user_version: 4 }]);

      const linkedFoldersTable = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'linked_folders'",
        )
        .all();
      expect(linkedFoldersTable).toEqual([{ name: 'linked_folders' }]);

      const assetColumns = (
        database.prepare('PRAGMA table_info(assets)').all() as Array<{ name: string }>
      ).map((column) => column.name);
      expect(assetColumns).toContain('linked_folder_id');
    } finally {
      database.close();
    }
    service.closeAll();
  });
});

describe('Linked folder import', () => {
  it('imports a linked folder and registers its files as linked assets', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');
    writeFileSync(path.join(sourceRoot, 'b.png'), 'bbbb');
    mkdirSync(path.join(sourceRoot, 'sub'));
    writeFileSync(path.join(sourceRoot, 'sub', 'c.png'), 'ccccc');

    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });

    expect(linked.status).toBe('available');
    expect(linked.assetCount).toBe(3);
    expect(linked.displayName).toBe('source');

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets.map((asset) => asset.relativeFilePath).sort()).toEqual([
      'a.png',
      'b.png',
      'sub/c.png',
    ]);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    try {
      const linkedRows = database
        .prepare(
          "SELECT location_kind, linked_folder_id FROM assets WHERE location_kind = 'linked'",
        )
        .all() as Array<{ location_kind: string; linked_folder_id: string }>;
      expect(linkedRows).toHaveLength(3);
      expect(linkedRows.every((row) => row.linked_folder_id === linked.folderId)).toBe(true);
    } finally {
      database.close();
    }
    service.closeAll();
  });

  it('refresh creates an external-change revision when a linked asset is overwritten externally', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');

    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked', selectedParentPath: root });
    service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });

    const before = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(before).toHaveLength(1);
    const originalAsset = before[0]!;
    const originalRevisionId = originalAsset.currentRevisionId;

    // External overwrite of the linked source file (not via Serpent).
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaaaaa');

    const refresh = service.refreshManagedAssets(created.libraryId);
    expect(refresh.changedCount).toBe(1);
    expect(refresh.missingCount).toBe(0);

    const after = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(after).toHaveLength(1);
    expect(after[0]!.assetId).toBe(originalAsset.assetId);
    expect(after[0]!.currentRevisionId).not.toBe(originalRevisionId);
    expect(after[0]!.availability).toBe('available');
    expect(after[0]!.byteSize).toBe(6);

    service.closeAll();
  });

  it('flips a linked folder to offline and marks its assets missing when the source root is removed', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');
    writeFileSync(path.join(sourceRoot, 'b.png'), 'bbbb');

    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });

    rmSync(sourceRoot, { recursive: true, force: true });

    const refresh = service.refreshManagedAssets(created.libraryId);
    expect(refresh.missingCount).toBe(2);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets.every((asset) => asset.availability === 'missing')).toBe(true);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    try {
      const folder = database
        .prepare('SELECT status FROM linked_folders WHERE folder_id = ?')
        .get(linked.folderId) as { status: string };
      expect(folder.status).toBe('offline');
    } finally {
      database.close();
    }
    service.closeAll();
  });

  it('relinks an offline linked folder to a new root and restores assets that exist there', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');
    writeFileSync(path.join(sourceRoot, 'b.png'), 'bbbb');

    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });
    const originalA = service
      .listAssets({ libraryId: created.libraryId, recursive: true })
      .find((asset) => asset.relativeFilePath === 'a.png')!;

    // Source root is gone; user relocates to a new root that has a.png (different
    // content) but not b.png.
    rmSync(sourceRoot, { recursive: true, force: true });
    service.refreshManagedAssets(created.libraryId);

    const newRoot = path.join(root, 'relocated');
    mkdirSync(newRoot);
    writeFileSync(path.join(newRoot, 'a.png'), 'aaa-restored');

    const result = service.relinkMissingFolder({
      libraryId: created.libraryId,
      folderId: linked.folderId,
      newRootPath: newRoot,
    });

    expect(result.status).toBe('available');

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const aAsset = assets.find((asset) => asset.relativeFilePath === 'a.png')!;
    const bAsset = assets.find((asset) => asset.relativeFilePath === 'b.png')!;
    expect(aAsset.availability).toBe('available');
    expect(aAsset.currentRevisionId).not.toBe(originalA.currentRevisionId);
    expect(aAsset.byteSize).toBe('aaa-restored'.length);
    expect(bAsset.availability).toBe('missing');

    service.closeAll();
  });

  it('applies default ignore rules when importing a linked folder', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');
    mkdirSync(path.join(sourceRoot, '.git'));
    writeFileSync(path.join(sourceRoot, '.git', 'config'), 'x');
    mkdirSync(path.join(sourceRoot, 'node_modules'));
    writeFileSync(path.join(sourceRoot, 'node_modules', 'pkg.json'), '{}');
    writeFileSync(path.join(sourceRoot, '.DS_Store'), 'x');
    writeFileSync(path.join(sourceRoot, 'Thumbs.db'), 'x');

    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });

    expect(linked.assetCount).toBe(1);
    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets.map((asset) => asset.relativeFilePath)).toEqual(['a.png']);
    service.closeAll();
  });

  it('does not follow or register symlinks inside a linked root', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');
    // A symlink inside the linked root that points outside the root must not be
    // followed and must not become an asset.
    writeFileSync(path.join(root, 'secret.png'), 'secret');
    symlinkSync(path.join(root, 'secret.png'), path.join(sourceRoot, 'link.png'));

    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Linked', selectedParentPath: root });
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: sourceRoot });

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets.map((asset) => asset.relativeFilePath)).toEqual(['a.png']);
    service.closeAll();
  });
});
