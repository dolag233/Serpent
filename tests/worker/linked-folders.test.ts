import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

// LibraryService holds SQLite connections and recursive fs watchers; on
// Windows those open handles block rm of the temp tree (POSIX unlinks open
// files, which is why the leak is invisible on macOS). Always close first.
const services: LibraryService[] = [];

function newService(
  ...args: ConstructorParameters<typeof LibraryService>
): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}

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
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('Linked folders schema migration', () => {
  it('migrates a v3 library to v4 with a linked_folders table and linked asset columns', () => {
    const root = temporaryRoot();
    const service = newService();
    const created = service.createLibrary({ displayName: 'Linked', selectedParentPath: root });
    service.closeAll();

    service.openLibrary(created.libraryPath);

    const database = new TestDatabase(path.join(created.libraryPath, '.serpent', 'library.db'));
    try {
      expect(database.pragma('user_version')).toEqual([{ user_version: 26 }]);

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

    const service = newService();
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

    const service = newService();
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

    const service = newService();
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

    const service = newService();
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

    const service = newService();
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

    const service = newService();
    const created = service.createLibrary({ displayName: 'Linked', selectedParentPath: root });
    service.importFolderAsLinked({ libraryId: created.libraryId, sourceRootPath: sourceRoot });

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    expect(assets.map((asset) => asset.relativeFilePath)).toEqual(['a.png']);
    service.closeAll();
  });

  it('persists editable rules, preserves hidden asset identity and metadata, and indexes newly included files', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(path.join(sourceRoot, 'node_modules'), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'keep.png'), 'keep');
    writeFileSync(path.join(sourceRoot, 'node_modules', 'later.png'), 'later');
    const service = newService();
    const library = service.createLibrary({ displayName: 'Rules', selectedParentPath: root });
    const linked = service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: sourceRoot });
    const original = service.listAssets({ libraryId: library.libraryId, folderId: linked.folderId, recursive: true })[0]!;
    service.setAssetMetadata({ libraryId: library.libraryId, assetId: original.assetId, expectedVersion: 0, description: 'Preserved' });

    const defaults = service.getLinkedFolderRules({ libraryId: library.libraryId, folderId: linked.folderId });
    const hidden = service.setLinkedFolderRules({
      libraryId: library.libraryId,
      folderId: linked.folderId,
      rules: [...defaults, { ruleId: 'test-exclude-png', action: 'exclude', target: 'extension', pattern: '.png', enabled: true }],
    });
    expect(hidden.hiddenCount).toBe(1);
    expect(service.listAssets({ libraryId: library.libraryId, folderId: linked.folderId, recursive: true })).toEqual([]);
    expect(service.listLinkedFolders(library.libraryId)[0]!.assetCount).toBe(0);
    expect(service.searchAssets({ libraryId: library.libraryId, query: null }).items).toEqual([]);

    const restored = service.setLinkedFolderRules({ libraryId: library.libraryId, folderId: linked.folderId, rules: [] });
    expect(restored.restoredCount).toBe(1);
    const visible = service.listAssets({ libraryId: library.libraryId, folderId: linked.folderId, recursive: true });
    expect(visible.map((asset) => asset.relativeFilePath).sort()).toEqual(['keep.png', 'node_modules/later.png']);
    expect(visible.find((asset) => asset.relativeFilePath === 'keep.png')!.assetId).toBe(original.assetId);
    expect(service.getAssetMetadata({ libraryId: library.libraryId, assetId: original.assetId }).description).toBe('Preserved');
    service.closeAll();
  });

  it('copies managed assets into the real linked root without moving their managed source', () => {
    const root = temporaryRoot();
    const linkedRoot = path.join(root, 'linked');
    const importRoot = path.join(root, 'incoming');
    mkdirSync(linkedRoot);
    mkdirSync(importRoot);
    const source = path.join(importRoot, 'managed.png');
    writeFileSync(source, 'managed bytes');
    const service = newService();
    const library = service.createLibrary({ displayName: 'Copy', selectedParentPath: root });
    const imported = service.prepareOrExecuteImport({
      libraryId: library.libraryId, sourceKind: 'files', sourcePaths: [source],
    });
    if ('importId' in imported) throw new Error('Unexpected import conflict.');
    const managed = imported.assets[0]!;
    const linked = service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: linkedRoot });
    const result = service.copyAssetsToLinkedFolder({
      libraryId: library.libraryId, folderId: linked.folderId, assetIds: [managed.assetId], conflictStrategy: 'keep-both',
    });
    expect(result.copiedCount).toBe(1);
    expect(readFileSync(path.join(linkedRoot, 'managed.png'), 'utf8')).toBe('managed bytes');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'managed.png'))).toBe(true);
    expect(result.assets[0]!.locationKind).toBe('linked');
    service.closeAll();
  });

  it('converts a linked folder to managed while preserving identity, metadata and the external source', () => {
    const root = temporaryRoot();
    const linkedRoot = path.join(root, 'source');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'art.png'), 'art bytes');
    const service = newService();
    const library = service.createLibrary({ displayName: 'Convert', selectedParentPath: root });
    const linked = service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: linkedRoot });
    const before = service.listAssets({ libraryId: library.libraryId, folderId: linked.folderId, recursive: true })[0]!;
    service.setAssetMetadata({ libraryId: library.libraryId, assetId: before.assetId, expectedVersion: 0, description: 'Stable description', favorite: true });

    const converted = service.convertLinkedFolderToManaged({ libraryId: library.libraryId, folderId: linked.folderId });
    expect(converted.convertedCount).toBe(1);
    expect(converted.assets[0]!.assetId).toBe(before.assetId);
    expect(converted.assets[0]!.locationKind).toBe('managed');
    expect(service.getAssetMetadata({ libraryId: library.libraryId, assetId: before.assetId })).toMatchObject({ description: 'Stable description', favorite: true });
    expect(readFileSync(path.join(linkedRoot, 'art.png'), 'utf8')).toBe('art bytes');
    expect(readFileSync(path.join(library.libraryPath, 'Assets', converted.assets[0]!.relativeFilePath), 'utf8')).toBe('art bytes');
    expect(service.listLinkedFolders(library.libraryId)).toEqual([]);
    service.closeAll();
  });

  it('recovers a conversion interrupted after filesystem placement without removing the link', () => {
    const root = temporaryRoot();
    const linkedRoot = path.join(root, 'crash-source');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'art.png'), 'art bytes');
    const interrupted = newService({ failAt: 'crash-linked-convert-after-filesystem' });
    const library = interrupted.createLibrary({ displayName: 'Crash Convert', selectedParentPath: root });
    const linked = interrupted.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: linkedRoot });
    expect(() => interrupted.convertLinkedFolderToManaged({
      libraryId: library.libraryId, folderId: linked.folderId,
    })).toThrowError('IMPORT_APPLY_FAILED');
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'crash-source', 'art.png'))).toBe(true);
    interrupted.closeAll();

    const recovered = newService();
    recovered.openLibrary(library.libraryPath);
    expect(existsSync(path.join(library.libraryPath, 'Assets', 'crash-source'))).toBe(false);
    expect(recovered.listLinkedFolders(library.libraryId)).toMatchObject([{ folderId: linked.folderId }]);
    expect(recovered.listAssets({ libraryId: library.libraryId, folderId: linked.folderId, recursive: true })[0]!.locationKind).toBe('linked');
    recovered.closeAll();
  });

  it('D1 re-verify: refresh still registers new external files when all rules are disabled (re-review misread)', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');
    mkdirSync(path.join(sourceRoot, 'sub'));
    writeFileSync(path.join(sourceRoot, 'sub', 'b.png'), 'bbb');

    const service = newService();
    const created = service.createLibrary({ displayName: 'D1-Verify', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });
    expect(linked.assetCount).toBe(2);

    // Disable ALL rules (enabled = false for every rule).
    const currentRules = service.getLinkedFolderRules({
      libraryId: created.libraryId,
      folderId: linked.folderId,
    });
    const disabledRules = currentRules.map((rule) => ({ ...rule, enabled: false }));
    service.setLinkedFolderRules({
      libraryId: created.libraryId,
      folderId: linked.folderId,
      rules: disabledRules,
    });

    // Add a new file externally (not through Serpent).
    writeFileSync(path.join(sourceRoot, 'c.png'), 'ccc');

    // Refresh should discover and register the new file.
    const refresh = service.refreshManagedAssets(created.libraryId);
    expect(refresh.changedCount).toBe(1);

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const relativePaths = assets.map((asset) => asset.relativeFilePath).sort();
    expect(relativePaths).toEqual(['a.png', 'c.png', 'sub/b.png']);

    service.closeAll();
  });

  it('TEXT-001: refresh discovers a new .txt under a linked subdirectory (Serpent-4l7)', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    mkdirSync(path.join(sourceRoot, 'notes'));
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');
    writeFileSync(path.join(sourceRoot, 'notes', 'readme.md'), '# hi');

    const service = newService();
    const created = service.createLibrary({ displayName: 'LinkedText', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });

    writeFileSync(path.join(sourceRoot, 'notes', 'new-note.txt'), 'hello text');
    writeFileSync(path.join(sourceRoot, 'notes', 'data.json'), '{"ok":true}');
    writeFileSync(path.join(sourceRoot, 'notes', 'payload.xml'), '<ok/>');

    const refresh = service.refreshManagedAssets(created.libraryId);
    expect(refresh.changedCount).toBeGreaterThanOrEqual(3);

    const listed = service.listAssets({
      libraryId: created.libraryId,
      folderId: linked.folderId,
      recursive: true,
    });
    const byPath = new Map(listed.map((asset) => [asset.relativeFilePath, asset]));
    expect(byPath.get('notes/new-note.txt')?.mediaType).toBe('text');
    expect(byPath.get('notes/data.json')?.mediaType).toBe('text');
    expect(byPath.get('notes/payload.xml')?.mediaType).toBe('text');

    // Linked browse keeps nested files visible even when recursive=false
    // (virtual subdir cards are not yet the nav surface).
    const searched = service.searchAssets({
      libraryId: created.libraryId,
      scope: { kind: 'folder', folderId: linked.folderId, recursive: false },
      filters: [{ field: 'format', values: ['text'], exclude: false }],
      limit: 50,
      offset: 0,
    });
    const searchedPaths = searched.items.map((item) => item.relativeFilePath).sort();
    expect(searchedPaths).toEqual([
      'notes/data.json',
      'notes/new-note.txt',
      'notes/payload.xml',
      'notes/readme.md',
    ]);
    expect(searched.items.every((item) => item.mediaType === 'text')).toBe(true);

    service.closeAll();
  });

  it('D2: relink continues processing remaining assets when one asset lstat fails with a non-missing-path error (e.g. EACCES)', () => {
    const root = temporaryRoot();
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, 'a.png'), 'aaa');
    const lockedDir = path.join(sourceRoot, 'locked');
    mkdirSync(lockedDir);
    writeFileSync(path.join(lockedDir, 'b.png'), 'bbb');

    // The relink stat goes through the assetLstat seam so the EACCES fault is
    // injected deterministically; chmod-based permission removal is a POSIX-
    // only simulation (on Windows chmod only toggles the read-only attribute
    // and directory traversal cannot be revoked this way). The hook receives
    // the canonicalized root (realpath differs from the temp path on macOS),
    // so match on the portable tail instead of an absolute prefix.
    const lockedTail = path.join('relocated', 'locked', 'b.png');
    const service = newService({
      assetLstat: (assetPath) => {
        if (assetPath.endsWith(lockedTail)) {
          throw Object.assign(new Error('Injected EACCES'), { code: 'EACCES' });
        }
        return lstatSync(assetPath);
      },
    });
    const created = service.createLibrary({ displayName: 'D2-Relink', selectedParentPath: root });
    const linked = service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: sourceRoot,
    });
    expect(linked.assetCount).toBe(2);

    // Source root gone; refresh to set all missing.
    rmSync(sourceRoot, { recursive: true, force: true });
    service.refreshManagedAssets(created.libraryId);

    // New root: has a.png and a locked/ subdir whose b.png fails lstat with EACCES.
    const newRoot = path.join(root, 'relocated');
    mkdirSync(newRoot);
    writeFileSync(path.join(newRoot, 'a.png'), 'aaa-restored');
    mkdirSync(path.join(newRoot, 'locked'));
    writeFileSync(path.join(newRoot, 'locked', 'b.png'), 'bbb-restored');

    const result = service.relinkMissingFolder({
      libraryId: created.libraryId,
      folderId: linked.folderId,
      newRootPath: newRoot,
    });

    // The relink must complete (not abort) — a.png restored, b.png stays missing.
    expect(result.status).toBe('available');

    const assets = service.listAssets({ libraryId: created.libraryId, recursive: true });
    const aAsset = assets.find((asset) => asset.relativeFilePath === 'a.png')!;
    const bAsset = assets.find((asset) => asset.relativeFilePath === 'locked/b.png')!;
    expect(aAsset.availability).toBe('available');
    expect(aAsset.byteSize).toBe('aaa-restored'.length);
    expect(bAsset.availability).toBe('missing');

    service.closeAll();
  });

  it('imports external files into an existing linked folder root (Serpent-d3h)', () => {
    const root = temporaryRoot();
    const linkedRoot = path.join(root, 'linked-target');
    const incoming = path.join(root, 'incoming');
    mkdirSync(linkedRoot);
    mkdirSync(incoming);
    writeFileSync(path.join(linkedRoot, 'existing.png'), 'keep');
    writeFileSync(path.join(incoming, 'new-art.png'), 'fresh bytes');

    const service = newService();
    const library = service.createLibrary({
      displayName: 'LinkedImport',
      selectedParentPath: root,
    });
    const linked = service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: linkedRoot,
    });
    expect(linked.assetCount).toBe(1);
    expect(linked.absoluteRootPath.endsWith(`${path.sep}linked-target`)).toBe(
      true,
    );

    const result = service.prepareOrExecuteImport({
      libraryId: library.libraryId,
      targetFolderId: linked.folderId,
      sourceKind: 'files',
      sourcePaths: [path.join(incoming, 'new-art.png')],
    });
    if ('importId' in result) throw new Error('Unexpected import conflict.');
    expect(result.importedCount).toBe(1);
    expect(
      readFileSync(path.join(linked.absoluteRootPath, 'new-art.png'), 'utf8'),
    ).toBe('fresh bytes');
    const assets = service.listAssets({
      libraryId: library.libraryId,
      folderId: linked.folderId,
      recursive: true,
    });
    expect(assets.some((asset) => asset.relativeFilePath === 'new-art.png')).toBe(
      true,
    );
    expect(
      assets.find((asset) => asset.relativeFilePath === 'new-art.png')
        ?.locationKind,
    ).toBe('linked');
    service.closeAll();
  });
});
