import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readPixcallLibrary } from '../../src/worker/pixcall-library';
import { LibraryService } from '../../src/worker/library-service';
import { ONE_PX_RED_PNG } from '../fixtures/fbx/ascii-fbx';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-pixcall-import-'));
  temporaryRoots.push(root);
  return root;
}

function writePixcallLibrary(root: string): string {
  const libraryPath = path.join(root, 'Pixcall 素材库');
  mkdirSync(path.join(libraryPath, '.pixcall', 'database'), { recursive: true });
  mkdirSync(path.join(libraryPath, '赛事', '一等奖'), { recursive: true });
  mkdirSync(path.join(libraryPath, '.pixcall', 'trash'), { recursive: true });
  writeFileSync(path.join(libraryPath, '赛事', '一等奖', 'hero.png'), ONE_PX_RED_PNG);
  const plainPng = Buffer.from(ONE_PX_RED_PNG);
  plainPng[20] = (plainPng[20] ?? 0) ^ 1;
  writeFileSync(path.join(libraryPath, '赛事', '一等奖', 'plain.png'), plainPng);

  const Database = BetterSqlite3 as unknown as {
    new (filename: string): {
      exec(sql: string): void;
      close(): void;
    };
  };
  const database = new Database(path.join(libraryPath, '.pixcall', 'database', 'main.db'));
  database.exec(`
    PRAGMA journal_mode = DELETE;
    CREATE TABLE entries (
      id BIGINT PRIMARY KEY,
      parent_id BIGINT NOT NULL,
      name TEXT NOT NULL,
      kind INTEGER NOT NULL,
      description TEXT,
      link VARCHAR(255),
      tags TEXT,
      rating INTEGER,
      metadata TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE tags (
      id BIGINT PRIMARY KEY,
      name VARCHAR(100) NOT NULL
    );
    CREATE TABLE exif (
      entry_id BIGINT NOT NULL,
      metadata TEXT NOT NULL
    );
    INSERT INTO entries
      (id, parent_id, name, kind, description, link, tags, rating, metadata, is_deleted)
    VALUES
      (1, -1, 'Pixcall', 0, NULL, NULL, NULL, NULL, NULL, 0),
      (2, -1, 'Trash', 0, NULL, NULL, NULL, NULL, NULL, 0),
      (583319777801380864, 1, '赛事', 0, NULL, NULL, NULL, NULL, NULL, 0),
      (583319777805575168, 583319777801380864, '一等奖', 0, NULL, NULL, NULL, NULL, NULL, 0),
      (583319777847518208, 583319777805575168, 'hero.png', 1,
       'Pixcall 备赛说明', 'https://example.com/pixcall-hero',
       '["637766146024514560"]', 5,
       '{"image_width":802,"image_height":1134}', 0),
      (583319777847518209, 583319777805575168, 'plain.png', 1,
       NULL, NULL, NULL, NULL, NULL, 0),
      (583319777847518210, 583319777805575168, 'missing.png', 1,
       NULL, NULL, NULL, NULL, NULL, 0),
      (583319777847518211, 2, 'deleted.png', 1,
       '不应导入', 'https://example.com/deleted', NULL, 1, NULL, 0);
    INSERT INTO tags (id, name)
    VALUES (637766146024514560, '海报设计');
    INSERT INTO exif (entry_id, metadata)
    VALUES (583319777847518208, '{"artist":"测试作者","make":"测试相机","model":"M1","iso":400,"f_number":2.8,"lens_model":"镜头","gps_latitude":[10,30,0],"gps_latitude_ref":"S","gps_longitude":[20,15,0],"gps_longitude_ref":"E"}');
  `);
  database.close();
  return libraryPath;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('Pixcall library import', () => {
  it('migrates precise folder-tree ranks, including empty folders and selected subtrees', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const Database = BetterSqlite3 as unknown as { new (filename: string): { exec(sql: string): void; close(): void } };
    const db = new Database(path.join(sourceRootPath, '.pixcall', 'database', 'main.db'));
    try {
      db.exec(`ALTER TABLE entries ADD COLUMN ranking BIGINT;
        UPDATE entries SET ranking = 1;
        INSERT INTO entries(id,parent_id,name,kind,is_deleted) VALUES
          (10,1,'Z空目录',0,0),(11,583319777801380864,'Z子目录',0,0);
        CREATE TABLE folders(entry_id BIGINT, ranking BIGINT);
        INSERT INTO folders VALUES
          (10,8999999999999999998),(583319777801380864,8999999999999999999),
          (11,8999999999999999998),(583319777805575168,8999999999999999999);`);
    } finally { db.close(); }
    const snapshot = readPixcallLibrary(sourceRootPath);
    expect(snapshot.folderOrder).toEqual(expect.arrayContaining([
      { relativePath: 'Z空目录', position: 0 }, { relativePath: '赛事', position: 1 },
      { relativePath: '赛事/Z子目录', position: 0 }, { relativePath: '赛事/一等奖', position: 1 },
    ]));
    expect(readPixcallLibrary(path.join(sourceRootPath, '赛事')).folderOrder)
      .not.toContainEqual(expect.objectContaining({ relativePath: 'Z空目录' }));
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    try {
      const library = service.createLibrary({ displayName: 'Folder Order', selectedParentPath: root });
      const result = await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath });
      const folders = service.listManagedFolders(library.libraryId);
      for (const expected of snapshot.folderOrder) {
        const folder = folders.find((item) => item.relativePath === expected.relativePath)!;
        expect(result.folderOrder).toContainEqual({ folderId: folder.folderId, parentFolderId: folder.parentFolderId, position: expected.position });
      }
      // A repeat import preserves originals and returns the same folder identities.
      const repeated = await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath });
      expect(repeated.importedCount).toBe(0);
      expect(repeated.folderOrder).toEqual(result.folderOrder);
    } finally { service.closeAll(); }
  });

  it('splits large inputs at the byte budget rather than filling the file-count limit', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    for (const name of ['hero.png', 'plain.png']) {
      truncateSync(path.join(sourceRootPath, '赛事', '一等奖', name), 33 * 1024 * 1024);
    }
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    try {
      const library = service.createLibrary({ displayName: 'Byte Budget Target', selectedParentPath: root });
      const prepare = vi.spyOn(service, 'prepareImport');
      const result = await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath });
      expect(result).toMatchObject({ importedCount: 2 });
      expect(prepare.mock.calls.map(([input]) => input.sourceEntries?.length).filter((count) => count! > 0))
        .toEqual([1, 1]);
    } finally { service.closeAll(); }
  });

  it('retains all sources when cancellation arrives after a batch commit', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    let outerImportId = '';
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onProgress: (event) => {
        if (event.type === 'import.progress' && event.phase === 'validate') outerImportId = event.importId;
      },
    });
    try {
      const library = service.createLibrary({ displayName: 'Committed Cancel Target', selectedParentPath: root });
      const resolve = service.resolveImport.bind(service);
      vi.spyOn(service, 'resolveImport').mockImplementation((input, options) => {
        const completion = resolve(input, options);
        if (options?.atomicBatch) service.cancelImport(outerImportId);
        return completion;
      });
      await expect(service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath }))
        .rejects.toMatchObject({ code: 'CANCELLED' });
      const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
      expect(assets).toHaveLength(2);
      const hero = assets.find((asset) => asset.relativeFilePath.endsWith('hero.png'))!;
      expect(service.getExtractedMetadata({ libraryId: library.libraryId, assetId: hero.assetId }))
        .toMatchObject({ metadata: { cameraMake: '测试相机', iso: 400 } });
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'hero.png'))).toBe(true);
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'plain.png'))).toBe(true);
    } finally { service.closeAll(); }
  });

  it('uses two bounded batches for 130 files and preserves identical files at distinct paths', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const Database = BetterSqlite3 as unknown as { new (filename: string): { exec(sql: string): void; close(): void } };
    const db = new Database(path.join(sourceRootPath, '.pixcall', 'database', 'main.db'));
    try {
      for (let index = 0; index < 128; index += 1) {
        writeFileSync(path.join(sourceRootPath, '赛事', '一等奖', `copy-${index}.png`), ONE_PX_RED_PNG);
        db.exec(`INSERT INTO entries (id, parent_id, name, kind, is_deleted)
          VALUES (${1000 + index}, 583319777805575168, 'copy-${index}.png', 1, 0)`);
      }
    } finally { db.close(); }
    const changes: number[] = [];
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onAssetsChanged: (event) => { changes.push(event.changedCount); },
    });
    try {
      const library = service.createLibrary({ displayName: 'Batch Target', selectedParentPath: root });
      const prepare = vi.spyOn(service, 'prepareImport');
      const result = await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath });
      expect(result).toMatchObject({ importedCount: 130 });
      expect(prepare.mock.calls.map(([input]) => input.sourceEntries?.length).filter((count) => count! > 0))
        .toEqual([128, 2]);
      expect(changes).toEqual([128, 2]);
      expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toHaveLength(130);
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'copy-127.png'))).toBe(true);
    } finally { service.closeAll(); }
  });

  it('keeps EXIF and duplicate reports aligned after a duplicate is skipped and another file is renamed', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    try {
      const library = service.createLibrary({ displayName: 'Mapping Target', selectedParentPath: root });
      const folder = path.join(library.libraryPath, 'Assets', '赛事', '一等奖');
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, 'plain.png'), readFileSync(path.join(sourceRootPath, '赛事', '一等奖', 'plain.png')));
      writeFileSync(path.join(folder, 'hero.png'), 'existing hero');
      const result = await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath });
      expect(result).toMatchObject({ importedCount: 1, skippedCount: 2, metadataCount: 1 });
      const hero = service.listAssets({ libraryId: library.libraryId, recursive: true })
        .find((asset) => asset.relativeFilePath.endsWith('hero (2).png'))!;
      expect(service.getExtractedMetadata({ libraryId: library.libraryId, assetId: hero.assetId }))
        .toMatchObject({ metadata: { cameraMake: '测试相机', iso: 400 } });
      expect(readFileSync(path.join(folder, 'hero.png'), 'utf8')).toBe('existing hero');
      expect(readFileSync(path.join(folder, 'hero (2).png'))).toEqual(ONE_PX_RED_PNG);
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'hero.png'))).toBe(true);
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'plain.png'))).toBe(true);
    } finally { service.closeAll(); }
  });

  it('rolls back the whole batch and retains sources when a later asset fails to commit', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    try {
      const library = service.createLibrary({ displayName: 'Rollback Target', selectedParentPath: root });
      let commits = 0;
      vi.spyOn(service as unknown as { failAt(point: string): void }, 'failAt').mockImplementation((point) => {
        if (point === 'before-db-commit' && ++commits === 2) throw new Error('second asset commit failed');
      });
      await expect(service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath }))
        .rejects.toMatchObject({ code: 'IMPORT_APPLY_FAILED' });
      expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
      for (const name of ['hero.png', 'plain.png']) {
        expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', name))).toBe(true);
        expect(existsSync(path.join(library.libraryPath, 'Assets', '赛事', '一等奖', name))).toBe(false);
      }
    } finally { service.closeAll(); }
  });

  it('accepts cancellation between staged files through the event loop', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    let cancellationQueued = false;
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onProgress: (event) => {
        if (!cancellationQueued && event.type === 'import.progress' && event.phase === 'copy' && event.filesProcessed === 1) {
          cancellationQueued = true;
          setImmediate(() => service.cancelImport(event.importId));
        }
      },
    });
    try {
      const library = service.createLibrary({ displayName: 'Cancel Target', selectedParentPath: root });
      await expect(service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath }))
        .rejects.toMatchObject({ code: 'CANCELLED' });
      expect(cancellationQueued).toBe(true);
      expect(service.listAssets({ libraryId: library.libraryId, recursive: true })).toEqual([]);
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'hero.png'))).toBe(true);
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'plain.png'))).toBe(true);
    } finally { service.closeAll(); }
  });


  it('rejects a normal folder without the Pixcall database marker', () => {
    const root = temporaryRoot();
    writeFileSync(path.join(root, 'not-pixcall.png'), ONE_PX_RED_PNG);
    expect(() => readPixcallLibrary(root)).toThrow(/\.pixcall\/database\/main\.db/u);
  });

  it('reports missing root-level assets when no files can be imported', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const Database = BetterSqlite3 as unknown as { new (filename: string): { exec(sql: string): void; close(): void } };
    const db = new Database(path.join(sourceRootPath, '.pixcall', 'database', 'main.db'));
    db.exec("UPDATE entries SET is_deleted = 1 WHERE parent_id = 1 AND id != 1; INSERT INTO entries (id, parent_id, name, kind, is_deleted) VALUES (100, 1, 'missing-only.png', 1, 0)");
    db.close();
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      const result = await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath });
      expect(result.importedCount).toBe(0);
      expect(result.skippedItems).toEqual([{ relativePath: 'missing-only.png', reason: 'unreadable' }]);
    } finally { service.closeAll(); }
  });

  it('reports every missing asset when there are more than ten', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const Database = BetterSqlite3 as unknown as { new (filename: string): { exec(sql: string): void; close(): void } };
    const db = new Database(path.join(sourceRootPath, '.pixcall', 'database', 'main.db'));
    db.exec(`INSERT INTO entries (id, parent_id, name, kind, is_deleted) VALUES ${Array.from({ length: 15 }, (_, i) => `(${1000 + i}, 1, 'missing-${i}.png', 1, 0)`).join(',')}`);
    db.close();
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      const result = await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath });
      expect(result.skippedItems).toHaveLength(16);
      expect(result.skippedCount).toBe(16);
    } finally { service.closeAll(); }
  });

  it('reads the active folder tree and migratable metadata without entering Trash', () => {
    const sourceRootPath = writePixcallLibrary(temporaryRoot());
    const snapshot = readPixcallLibrary(sourceRootPath);

    expect(snapshot.displayName).toBe('Pixcall 素材库');
    expect(snapshot.directories).toEqual(['赛事', '赛事/一等奖']);
    expect(snapshot.items.map((item) => item.relativePath)).toEqual([
      '赛事/一等奖/hero.png',
      '赛事/一等奖/plain.png',
    ]);
    expect(snapshot.skippedCount).toBe(1);
    expect(snapshot.skippedItems).toEqual([{ relativePath: '赛事/一等奖/missing.png', reason: 'unreadable' }]);
    expect(snapshot.items[0]?.metadata).toMatchObject({
      author: '测试作者',
      description: 'Pixcall 备赛说明',
      rating: 5,
      sourcePageUrl: 'https://example.com/pixcall-hero',
      tags: ['海报设计'],
      width: 802,
      height: 1134,
    });
    expect(snapshot.items[1]?.metadata).toBeNull();
  });

  it('reads only the selected active Pixcall folder and preserves its metadata', () => {
    const sourceRootPath = writePixcallLibrary(temporaryRoot());
    const snapshot = readPixcallLibrary(path.join(sourceRootPath, '赛事', '一等奖'));
    expect(snapshot.sourceRootPath).toBe(sourceRootPath);
    expect(snapshot.directories).toEqual(['赛事/一等奖']);
    expect(snapshot.items.map((item) => item.relativePath)).toEqual([
      '赛事/一等奖/hero.png', '赛事/一等奖/plain.png',
    ]);
    expect(snapshot.items[0]?.metadata?.description).toBe('Pixcall 备赛说明');
    expect(() => readPixcallLibrary(path.join(sourceRootPath, '.pixcall'))).toThrow();
    mkdirSync(path.join(sourceRootPath, 'unregistered'));
    expect(() => readPixcallLibrary(path.join(sourceRootPath, 'unregistered'))).toThrow(/active Pixcall folder/u);
  });

  it('keeps progress in the copy phase after copying starts', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const phases: string[] = [];
    const service = new LibraryService({ observerFactory: () => ({ close() {} }), onProgress: (event) => {
      if (event.type === 'import.progress') phases.push(event.phase);
    } });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath });
      const copyIndex = phases.indexOf('copy');
      expect(copyIndex).toBeGreaterThanOrEqual(0);
      expect(phases.slice(copyIndex)).not.toContain('validate');
      expect(phases.at(-1)).toBe('complete');
    } finally { service.closeAll(); }
  });

  it('imports Pixcall folders, notes, source links, authors, ratings, and tags', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({
        displayName: 'Pixcall Target',
        selectedParentPath: root,
      });
      const result = await service.importPixcallLibrary({
        libraryId: library.libraryId,
        sourceRootPath,
      });

      expect(result).toMatchObject({
        importedCount: 2,
        fileCount: 2,
        skippedCount: 1,
        metadataCount: 1,
        skippedItems: [{ relativePath: '赛事/一等奖/missing.png', reason: 'unreadable' }],
        tagCount: 1,
      });
      const assets = service.listAssets({
        libraryId: library.libraryId,
        recursive: true,
      });
      expect(assets.map((asset) => asset.relativeFilePath).sort()).toEqual([
        '赛事/一等奖/hero.png',
        '赛事/一等奖/plain.png',
      ]);
      const hero = assets.find((asset) => asset.relativeFilePath.endsWith('hero.png'));
      expect(hero).toBeDefined();
      const metadata = service.getAssetMetadata({
        libraryId: library.libraryId,
        assetId: hero!.assetId,
      });
      expect(metadata).toMatchObject({
        author: '测试作者',
        description: 'Pixcall 备赛说明',
        rating: 5,
        sourcePageUrl: 'https://example.com/pixcall-hero',
      });
      expect(metadata.tags.map((tag) => tag.name)).toEqual(['海报设计']);
      expect(service.getExtractedMetadata({ libraryId: library.libraryId, assetId: hero!.assetId })).toMatchObject({ metadata: { cameraMake: '测试相机', cameraModel: 'M1', lensModel: '镜头', iso: 400, fNumber: 2.8, gpsLatitude: -10.5, gpsLongitude: 20.25 } });
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'hero.png'))).toBe(true);
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'plain.png'))).toBe(true);
    } finally {
      service.closeAll();
    }
  });

  it('imports only the chosen subtree including empty folders', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    mkdirSync(path.join(sourceRootPath, '赛事', '空文件夹'));
    mkdirSync(path.join(sourceRootPath, '其他'));
    writeFileSync(path.join(sourceRootPath, '其他', 'other.png'), ONE_PX_RED_PNG);
    const Database = BetterSqlite3 as unknown as { new (filename: string): { exec(sql: string): void; close(): void } };
    const db = new Database(path.join(sourceRootPath, '.pixcall', 'database', 'main.db'));
    db.exec(`INSERT INTO entries (id, parent_id, name, kind, is_deleted) VALUES
      (100, 583319777801380864, '空文件夹', 0, 0),
      (101, 1, '其他', 0, 0), (102, 101, 'other.png', 1, 0)`);
    db.close();
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      const result = await service.importPixcallLibrary({
        libraryId: library.libraryId, sourceRootPath: path.join(sourceRootPath, '赛事'),
      });
      expect(result.importedCount).toBe(2);
      expect(service.listManagedFolders(library.libraryId).map((folder) => folder.relativePath))
        .toContain('赛事/空文件夹');
      expect(existsSync(path.join(sourceRootPath, '其他', 'other.png'))).toBe(true);
      expect(service.listAssets({ libraryId: library.libraryId, recursive: true })
        .some((asset) => asset.relativeFilePath.includes('other.png'))).toBe(false);
    } finally { service.closeAll(); }
  });

  it('imports an empty folder into an existing destination directory', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    mkdirSync(path.join(sourceRootPath, '空'));
    const Database = BetterSqlite3 as unknown as { new (filename: string): { exec(sql: string): void; close(): void } };
    const db = new Database(path.join(sourceRootPath, '.pixcall', 'database', 'main.db'));
    db.exec("INSERT INTO entries (id, parent_id, name, kind, is_deleted) VALUES (100, 1, '空', 0, 0)");
    db.close();
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      mkdirSync(path.join(library.libraryPath, 'Assets', '空'), { recursive: true });
      const result = await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath: path.join(sourceRootPath, '空') });
      expect(result.importedCount).toBe(0);
      expect(service.listManagedFolders(library.libraryId).map((folder) => folder.relativePath)).toContain('空');
    } finally { service.closeAll(); }
  });

  it('keeps a conflicting destination and copies under a new name', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      const folder = path.join(library.libraryPath, 'Assets', '赛事', '一等奖');
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, 'hero.png'), 'existing content');
      const result = await service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath });
      expect(result.importedCount).toBe(2);
      expect(readFileSync(path.join(folder, 'hero.png'), 'utf8')).toBe('existing content');
      expect(readFileSync(path.join(folder, 'hero (2).png'))).toEqual(ONE_PX_RED_PNG);
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'hero.png'))).toBe(true);
    } finally {
      service.closeAll();
    }
  });

  it('preserves original files when cancelled during staging', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writePixcallLibrary(root);
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onProgress: (event) => {
        if (event.type === 'import.progress' && event.phase === 'copy' && event.filesProcessed === 1) {
          service.cancelImport(event.importId);
        }
      },
    });
    try {
      const library = service.createLibrary({ displayName: 'Target', selectedParentPath: root });
      await expect(service.importPixcallLibrary({ libraryId: library.libraryId, sourceRootPath }))
        .rejects.toMatchObject({ code: 'CANCELLED' });
      expect(readFileSync(path.join(sourceRootPath, '赛事', '一等奖', 'hero.png'))).toEqual(ONE_PX_RED_PNG);
      expect(existsSync(path.join(sourceRootPath, '赛事', '一等奖', 'plain.png'))).toBe(true);
    } finally {
      service.closeAll();
    }
  });
});
