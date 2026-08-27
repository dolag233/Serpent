import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readBillfishLibrary } from '../../src/worker/billfish-library';
import { LibraryService } from '../../src/worker/library-service';
import { IMPORTED_THUMBNAIL_NORMALIZATION_JOB } from '../../src/worker/imported-thumbnail-policy';
import { ONE_PX_RED_PNG } from '../fixtures/fbx/ascii-fbx';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-billfish-import-'));
  temporaryRoots.push(root);
  return root;
}

function createDatabase(databasePath: string): void {
  const Database = BetterSqlite3 as unknown as {
    new (filename: string): {
      exec(sql: string): void;
      prepare(sql: string): { run(...parameters: unknown[]): void };
      close(): void;
    };
  };
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE assets (
      path TEXT NOT NULL,
      description TEXT,
      rating INTEGER,
      source_url TEXT,
      tags TEXT,
      thumbnail TEXT
    )
  `);
  database
    .prepare('INSERT INTO assets (path, description, rating, source_url, tags, thumbnail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      'References/hero.png',
      'A Billfish note',
      4,
      'https://example.com/hero',
      '["reference","hero"]',
      '.bf/thumb-hero.png',
    );
  database.close();
}

function createBillfish3Database(databasePath: string): void {
  const Database = BetterSqlite3 as unknown as {
    new (filename: string): {
      exec(sql: string): void;
      prepare(sql: string): { run(...parameters: unknown[]): void };
      close(): void;
    };
  };
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE bf_folder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      born INTEGER,
      pid INTEGER NOT NULL,
      name TEXT,
      desc TEXT,
      cover_tid INTEGER,
      hide INTEGER,
      seq REAL,
      color INTEGER,
      is_recycle INTEGER
    );
    CREATE TABLE bf_file (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      pid INTEGER NOT NULL,
      is_hide INTEGER,
      is_link INTEGER,
      file_size INTEGER,
      ctime INTEGER,
      mtime INTEGER,
      md5 TEXT,
      tid INTEGER,
      born INTEGER,
      ttid INTEGER
    );
    CREATE TABLE bf_material_userdata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      comments_summary TEXT,
      comments_count INTEGER,
      comments_detail TEXT,
      note TEXT,
      origin TEXT,
      score INTEGER,
      rotation INTEGER,
      hflip INTEGER,
      vflip INTEGER,
      cover_tid TEXT,
      unique(file_id) on conflict replace
    );
    CREATE TABLE bf_tag_v2 (
      id integer primary key autoincrement,
      name text,
      pid integer,
      seq real,
      icon integer,
      color integer,
      born integer
    );
    CREATE TABLE bf_tag_join_file (
      id integer primary key autoincrement,
      file_id integer,
      tag_id integer,
      born integer,
      unique(file_id, tag_id) on conflict ignore
    );
  `);
  database.prepare('INSERT INTO bf_folder (id, pid, name) VALUES (874, 0, ?)').run('魔法少女的魔女审判');
  database.prepare('INSERT INTO bf_file (id, name, pid) VALUES (63567, ?, 874)').run('hero.png');
  database.prepare('INSERT INTO bf_file (id, name, pid) VALUES (63568, ?, 874)').run('untagged.png');
  database
    .prepare('INSERT INTO bf_material_userdata (file_id, note, origin, score) VALUES (63567, ?, ?, ?)')
    .run('A Billfish 3.0 note', 'https://example.com/billfish3', 3);
  database.prepare('INSERT INTO bf_tag_v2 (id, name, pid) VALUES (65, ?, 0)').run('魔法少女的魔女审判');
  database.prepare('INSERT INTO bf_tag_v2 (id, name, pid) VALUES (66, ?, 0)').run('reference');
  database
    .prepare('INSERT INTO bf_tag_join_file (file_id, tag_id) VALUES (63567, 65)')
    .run();
  database
    .prepare('INSERT INTO bf_tag_join_file (file_id, tag_id) VALUES (63567, 66)')
    .run();
  database.close();
}

function writeBillfish3Library(root: string, flattened: boolean): string {
  const libraryPath = path.join(root, 'Billfish 3 Library');
  mkdirSync(path.join(libraryPath, '.bf'), { recursive: true });
  if (flattened) {
    // .BillfishPack exports store asset files at the archive root even though
    // the database still records the original folder hierarchy.
    writeFileSync(path.join(libraryPath, 'hero.png'), ONE_PX_RED_PNG);
    const untaggedPng = Buffer.from(ONE_PX_RED_PNG);
    untaggedPng[20] = (untaggedPng[20] ?? 0) ^ 1;
    writeFileSync(path.join(libraryPath, 'untagged.png'), untaggedPng);
  } else {
    mkdirSync(path.join(libraryPath, '魔法少女的魔女审判'), { recursive: true });
    writeFileSync(path.join(libraryPath, '魔法少女的魔女审判', 'hero.png'), ONE_PX_RED_PNG);
    const untaggedPng = Buffer.from(ONE_PX_RED_PNG);
    untaggedPng[20] = (untaggedPng[20] ?? 0) ^ 1;
    writeFileSync(
      path.join(libraryPath, '魔法少女的魔女审判', 'untagged.png'),
      untaggedPng,
    );
  }
  createBillfish3Database(path.join(libraryPath, '.bf', 'billfish.db'));
  return libraryPath;
}

function writeBillfishLibrary(root: string): string {
  const libraryPath = path.join(root, 'Reference Library');
  mkdirSync(path.join(libraryPath, '.bf'), { recursive: true });
  mkdirSync(path.join(libraryPath, 'References', 'Subfolder'), { recursive: true });
  mkdirSync(path.join(libraryPath, '.recycle'), { recursive: true });
  writeFileSync(path.join(libraryPath, 'References', 'hero.png'), ONE_PX_RED_PNG);
  const otherPng = Buffer.from(ONE_PX_RED_PNG);
  otherPng[20] = (otherPng[20] ?? 0) ^ 1;
  writeFileSync(path.join(libraryPath, 'References', 'Subfolder', 'other.png'), otherPng);
  writeFileSync(path.join(libraryPath, '.recycle', 'deleted.png'), ONE_PX_RED_PNG);
  writeFileSync(path.join(libraryPath, '.bf', 'thumb-hero.png'), ONE_PX_RED_PNG);
  createDatabase(path.join(libraryPath, '.bf', 'billfish.db'));
  return libraryPath;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('Billfish library import', () => {
  it('rejects a normal folder without the Billfish metadata marker', () => {
    const root = temporaryRoot();
    writeFileSync(path.join(root, 'not-billfish.png'), ONE_PX_RED_PNG);
    expect(() => readBillfishLibrary(root)).toThrow(/\.bf metadata directory/u);
  });

  it('scans normal files while excluding Billfish metadata and recycle folders', () => {
    const sourceRootPath = writeBillfishLibrary(temporaryRoot());
    const snapshot = readBillfishLibrary(sourceRootPath);
    expect(snapshot.displayName).toBe('Reference Library');
    expect(snapshot.items.map((item) => item.relativePath)).toEqual([
      'References/hero.png',
      'References/Subfolder/other.png',
    ]);
    expect(snapshot.directories).toEqual(['References', 'References/Subfolder']);
    expect(snapshot.metadataAvailable).toBe(true);
    expect(snapshot.items[0]?.metadata).toMatchObject({
      description: 'A Billfish note',
      rating: 4,
      sourcePageUrl: 'https://example.com/hero',
      tags: ['reference', 'hero'],
    });
  });

  it('imports the folder tree, metadata, tags, thumbnails, and derived media in batches', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writeBillfishLibrary(root);
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({
        displayName: 'Target',
        selectedParentPath: root,
      });
      const result = await service.importBillfishLibrary({
        libraryId: library.libraryId,
        sourceRootPath,
      });
      expect(result.importedCount).toBe(2);
      expect(result.metadataCount).toBe(1);
      expect(result.tagCount).toBe(2);

      const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
      expect(assets.map((asset) => asset.relativeFilePath).sort()).toEqual([
        'References/Subfolder/other.png',
        'References/hero.png',
      ].sort());
      const hero = assets.find((asset) => asset.relativeFilePath === 'References/hero.png');
      expect(hero).toBeDefined();
      const heroMetadata = service.getAssetMetadata({
        libraryId: library.libraryId,
        assetId: hero!.assetId,
      });
      expect(heroMetadata).toMatchObject({
        description: 'A Billfish note',
        rating: 4,
        sourcePageUrl: 'https://example.com/hero',
      });
      expect(heroMetadata.tags.map((tag) => tag.name).sort()).toEqual([
        'hero',
        'reference',
      ]);
      expect(service.getCurrentArtifact(library.libraryId, hero!.assetId, 'thumbnail')).toMatchObject({
        status: 'ready',
        generatorVersion: 'billfish-thumbnail@1',
      });
      expect(service.listMediaJobs(library.libraryId).jobs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          assetId: hero!.assetId,
          errorCode: IMPORTED_THUMBNAIL_NORMALIZATION_JOB,
          status: 'queued',
        }),
      ]));
    } finally {
      service.closeAll();
    }
  });

  it('reads Billfish 3.x normalized tables when the folder layout matches the database', () => {
    const sourceRootPath = writeBillfish3Library(temporaryRoot(), false);
    const snapshot = readBillfishLibrary(sourceRootPath);
    expect(snapshot.metadataAvailable).toBe(true);
    const hero = snapshot.items.find((item) => item.relativePath.endsWith('hero.png'));
    expect(hero?.metadata).toMatchObject({
      description: 'A Billfish 3.0 note',
      rating: 3,
      sourcePageUrl: 'https://example.com/billfish3',
      tags: ['魔法少女的魔女审判', 'reference'],
    });
    const untagged = snapshot.items.find((item) => item.relativePath.endsWith('untagged.png'));
    expect(untagged?.metadata).toBeNull();
  });

  it('reads Billfish 3.x metadata for flattened .BillfishPack exports', () => {
    const sourceRootPath = writeBillfish3Library(temporaryRoot(), true);
    const snapshot = readBillfishLibrary(sourceRootPath);
    expect(snapshot.items.map((item) => item.relativePath).sort()).toEqual([
      'hero.png',
      'untagged.png',
    ]);
    const hero = snapshot.items.find((item) => item.relativePath === 'hero.png');
    expect(hero?.metadata).toMatchObject({
      description: 'A Billfish 3.0 note',
      rating: 3,
      sourcePageUrl: 'https://example.com/billfish3',
      tags: ['魔法少女的魔女审判', 'reference'],
    });
  });

  it('imports Billfish 3.x notes, ratings, URLs, and tags into a library', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writeBillfish3Library(root, false);
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      const library = service.createLibrary({
        displayName: 'Billfish 3 Target',
        selectedParentPath: root,
      });
      const result = await service.importBillfishLibrary({
        libraryId: library.libraryId,
        sourceRootPath,
      });
      expect(result.importedCount).toBe(2);
      expect(result.metadataCount).toBe(1);
      expect(result.tagCount).toBe(2);

      const assets = service.listAssets({ libraryId: library.libraryId, recursive: true });
      const hero = assets.find((asset) => asset.relativeFilePath.endsWith('hero.png'));
      expect(hero).toBeDefined();
      const heroMetadata = service.getAssetMetadata({
        libraryId: library.libraryId,
        assetId: hero!.assetId,
      });
      expect(heroMetadata).toMatchObject({
        description: 'A Billfish 3.0 note',
        rating: 3,
        sourcePageUrl: 'https://example.com/billfish3',
      });
      expect(heroMetadata.tags.map((tag) => tag.name).sort()).toEqual([
    'reference',
    '魔法少女的魔女审判',
      ].sort());
    } finally {
      service.closeAll();
    }
  });

  it('inspects and opens Billfish as a new Serpent library', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writeBillfishLibrary(root);
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
    });
    try {
      expect(service.inspectBillfishLibrary(sourceRootPath)).toEqual({
        displayName: 'Reference Library',
      });
      const opened = await service.openBillfishLibrary({
        sourceRootPath,
        selectedParentPath: root,
        displayName: 'Converted Billfish',
      });
      expect(opened.displayName).toBe('Converted Billfish');
      expect(service.listAssets({ libraryId: opened.libraryId, recursive: true })).toHaveLength(2);
      expect(opened.libraryPath).not.toBe(sourceRootPath);
    } finally {
      service.closeAll();
    }
  });

  it('reports the full library byte total during copy', async () => {
    const root = temporaryRoot();
    const sourceRootPath = writeBillfishLibrary(root);
    const snapshot = readBillfishLibrary(sourceRootPath);
    const expectedTotal = snapshot.items.reduce((total, item) => total + item.byteSize, 0);
    const copyTotals: number[] = [];
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onProgress: (event) => {
        if (event.type === 'import.progress' && event.phase === 'copy') {
          copyTotals.push(event.totalBytes);
        }
      },
    });
    try {
      const library = service.createLibrary({
        displayName: 'ByteTotal',
        selectedParentPath: root,
      });
      await service.importBillfishLibrary({
        libraryId: library.libraryId,
        sourceRootPath,
      });
      expect(copyTotals.length).toBeGreaterThan(0);
      expect(new Set(copyTotals)).toEqual(new Set([expectedTotal]));
    } finally {
      service.closeAll();
    }
  });
});
