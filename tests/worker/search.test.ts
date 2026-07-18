import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService, LibraryServiceError } from '../../src/worker/library-service';
import { buildFts5Query, tokenizeForFts } from '../../src/worker/search-query';

const temporaryRoots: string[] = [];
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

const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-search-test-'));
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

// ── Helper: create a library with a tagged and described asset ──

function createLibraryWithAssetAndTags(initialDescription?: string, description?: string): {
  service: LibraryService;
  libraryId: string;
  libraryPath: string;
  assetId: string;
} {
  const root = temporaryRoot();
  const service = new LibraryService();
  const library = service.createLibrary({ displayName: 'SearchTest', selectedParentPath: root });

  const managedFolder = service.createManagedFolder({ libraryId: library.libraryId, name: 'Assets' });
  const assetFileName = 'hero-concept.png';
  const assetsPath = path.join(library.libraryPath, 'Assets', managedFolder.relativePath);
  mkdirSync(assetsPath, { recursive: true });
  writeFileSync(path.join(assetsPath, assetFileName), 'test content');

  // Use the service API to set metadata (which syncs FTS content).
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
       VALUES (?, ?, NULL, 2048000, ?, ?, 'import', ?)`,
    ).run(revisionId, assetId, now, assetFileName, now);
    db.prepare('UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?').run(
      revisionId, now, assetId,
    );
  } finally {
    db.close();
  }

  // Set metadata through the service (this also syncs FTS content).
  service.setAssetMetadata({
    libraryId: library.libraryId,
    assetId,
    expectedVersion: 0,
    description: description ?? initialDescription ?? 'Main character concept art',
    rating: 5,
    favorite: true,
    sourcePageUrl: 'https://example.com/ref',
  });

  return { service, libraryId: library.libraryId, libraryPath: library.libraryPath, assetId };
}

function createSecondAsset(
  service: LibraryService,
  libraryId: string,
  libraryPath: string,
  description?: string,
): string {
  const managedFolder = service.listManagedFolders(libraryId)[0]!;
  const assetId = randomUUID();
  const assetFileName = `${assetId}.png`;
  const assetsPath = path.join(libraryPath, 'Assets', managedFolder.relativePath);
  writeFileSync(path.join(assetsPath, assetFileName), 'test content 2');

  const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
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
       VALUES (?, ?, NULL, 4096, ?, ?, 'import', ?)`,
    ).run(revisionId, assetId, now, assetFileName, now);
    db.prepare('UPDATE assets SET current_revision_id = ?, updated_at = ? WHERE asset_id = ?').run(
      revisionId, now, assetId,
    );
  } finally {
    db.close();
  }

  if (description) {
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 0, description });
  }

  return assetId;
}

// ── Schema v5→v6 Migration ──────────────────────────────────────────

describe('schema v5->v6 migration', () => {
  it('migrates to v6 and creates FTS tables with triggers', () => {
    const { service, libraryPath } = createLibraryWithAssetAndTags();
    service.closeAll();

    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    try {
      expect(db.pragma('user_version')).toEqual([{ user_version: 14 }]);

      // Verify FTS tables exist.
      const searchIndex = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='asset_search_index'",
      ).get() as { name: string } | undefined;
      expect(searchIndex).toBeTruthy();

      const ftsTable = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='asset_search'",
      ).get() as { name: string } | undefined;
      expect(ftsTable).toBeTruthy();

      // Verify triggers exist.
      const triggers = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'asset_search_index_%' ORDER BY name",
      ).all() as Array<{ name: string }>;
      expect(triggers.map((t) => t.name)).toEqual([
        'asset_search_index_ad',
        'asset_search_index_ai',
        'asset_search_index_au',
      ]);

      // Verify smart_collections has v6 shape (collection_id primary key, unique on library_id+name).
      const scInfo = db.prepare('PRAGMA table_info(smart_collections)').all() as Array<{ name: string }>;
      const colNames = scInfo.map((c) => c.name);
      expect(colNames).toContain('collection_id');
      expect(colNames).toContain('query_definition_json');
      expect(colNames).toContain('position');
      expect(colNames).not.toContain('smart_collection_id');
      expect(colNames).not.toContain('sort_definition');

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='smart_collections_library_name_unique'",
      ).get() as { name: string } | undefined;
      expect(indexes).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('is idempotent when reopening a v6 database', () => {
    const { service, libraryId, libraryPath } = createLibraryWithAssetAndTags();
    service.closeAll();

    // Reopen should not re-migrate.
    const reopened = service.openLibrary(libraryPath);
    expect(reopened.libraryId).toBe(libraryId);
    service.closeAll();
  });

  it('backfills existing assets into FTS index during migration', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags();

    // The asset should be searchable immediately after migration backfill.
    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: null, values: ['hero'], exclude: false }] },
    });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items.some((a) => a.assetId === assetId)).toBe(true);

    service.closeAll();
  });
});

// ── FTS Trigger Consistency ────────────────────────────────────────

describe('FTS trigger consistency', () => {
  it('syncs tokens to FTS index on asset create via metadata set', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags();

    // Set metadata should also sync FTS content.
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 1, description: 'NewDescription123' });

    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'description', values: ['NewDescription123'], exclude: false }] },
    });
    expect(result.total).toBe(1);
    expect(result.items[0]!.assetId).toBe(assetId);

    service.closeAll();
  });

  it('removes old tokens from FTS index on metadata update', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags();

    // Helper created searchable description metadata.
    // Verify it's indexed.
    const initial = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'description', values: ['character'], exclude: false }] },
    });
    expect(initial.total).toBe(1);

    // Change description to something unique.
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 1, description: 'ZYXQUUX unused description' });

    // Old token should no longer match in description field.
    const afterOld = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'description', values: ['character'], exclude: false }] },
    });
    expect(afterOld.total).toBe(0);

    // New unique token should match.
    const afterNew = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'description', values: ['ZYXQUUX'], exclude: false }] },
    });
    expect(afterNew.total).toBe(1);

    service.closeAll();
  });

  it('uses delete command (not DELETE FROM) for UPDATE trigger', () => {
    const { service, libraryPath, assetId } = createLibraryWithAssetAndTags();
    service.closeAll();

    // Directly test that the trigger uses 'delete' command by checking
    // token counts don't leak on an update done through the sync path.
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    try {
      // Verify the initial asset description is indexed.
      const beforeCount = db.prepare(
        'SELECT count(*) AS cnt FROM asset_search WHERE asset_search MATCH ?',
      ).get('description:character') as { cnt: number };
      expect(beforeCount.cnt).toBe(1);

      // Simulate an update through the content table (like syncAssetSearchContent would do).
      db.prepare(
        `UPDATE asset_search_index SET description = ?, filename = 'renamed.xyz'
         WHERE asset_id = ?`,
      ).run(tokenizeForFts('UpdatedToken'), assetId);

      // Old token should be gone.
      const afterOldCount = db.prepare(
        'SELECT count(*) AS cnt FROM asset_search WHERE asset_search MATCH ?',
      ).get('description:character') as { cnt: number };
      expect(afterOldCount.cnt).toBe(0);

      // New token should exist.
      const afterNewCount = db.prepare(
        'SELECT count(*) AS cnt FROM asset_search WHERE asset_search MATCH ?',
      ).get('description:UpdatedToken') as { cnt: number };
      expect(afterNewCount.cnt).toBe(1);
    } finally {
      db.close();
    }
  });

  it('removes FTS tokens on asset delete via CASCADE', () => {
    const { service, libraryPath, libraryId, assetId } = createLibraryWithAssetAndTags();

    // Verify the asset description is indexed.
    const before = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'description', values: ['character'], exclude: false }] },
    });
    expect(before.total).toBe(1);
    expect(before.items[0]!.assetId).toBe(assetId);

    service.closeAll();

    // Directly delete the asset in the DB (which cascades to asset_search_index).
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    try {
      db.prepare('DELETE FROM assets WHERE asset_id = ?').run(assetId);

      // The DELETE trigger should have cleaned up the FTS index.
      const afterCount = db.prepare(
        'SELECT count(*) AS cnt FROM asset_search WHERE asset_search MATCH ?',
      ).get('description:character') as { cnt: number };
      expect(afterCount.cnt).toBe(0);

      // Content table should also be empty for this asset.
      const contentRow = db.prepare(
        'SELECT asset_id FROM asset_search_index WHERE asset_id = ?',
      ).get(assetId);
      expect(contentRow).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

// ── Chinese Tokenization ────────────────────────────────────────────

describe('CJK tokenization', () => {
  it('tokenizes CJK text into space-separated characters', () => {
    const tokens = tokenizeForFts('角色概念设计');
    expect(tokens).toBe('角 色 概 念 设 计');
  });

  it('preserves ASCII words intact while splitting CJK', () => {
    const tokens = tokenizeForFts('PBR 机甲概念 texture');
    expect(tokens).toContain('PBR');
    expect(tokens).toContain('机');
    expect(tokens).toContain('甲');
    expect(tokens).toContain('概');
    expect(tokens).toContain('念');
    expect(tokens).toContain('texture');
  });

  it('returns empty string for blank input', () => {
    expect(tokenizeForFts('')).toBe('');
    expect(tokenizeForFts('   ')).toBe('');
  });

  it('searches Chinese labels tokenized in asset_search_index', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'CJK', selectedParentPath: root });
    const libraryId = library.libraryId;
    const libraryPath = library.libraryPath;

    // Create a managed folder using the service API (library is still open from createLibrary).
    const managedFolder = service.createManagedFolder({ libraryId, name: 'CJKAssets' });

    // Insert an asset directly with a Chinese description into search index.
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    const assetId = randomUUID();
    const now = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
          relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
         VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
      ).run(assetId, managedFolder.folderId, 'CJKAssets/test.png', 'CJKAssets/test.png', now, now);
      db.prepare(
        `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
          modified_at, original_filename, origin, accepted_at)
         VALUES (?, ?, NULL, 100, ?, 'test.png', 'import', ?)`,
      ).run(randomUUID(), assetId, now, now);
      db.prepare('UPDATE assets SET current_revision_id = (SELECT revision_id FROM revisions WHERE asset_id = ? LIMIT 1), updated_at = ? WHERE asset_id = ?')
        .run(assetId, now, assetId);

      // Manually insert a tokenized Chinese description.
      db.prepare(
        `INSERT INTO asset_search_index (asset_id, filename, tags, description, source_url, folder_path, metadata_text)
         VALUES (?, '', '', ?, '', 'CJKAssets', '')`,
      ).run(assetId, tokenizeForFts('角色概念设计'));
    } finally {
      db.close();
    }

    // Search for a CJK token substring.
    const result = service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: null, values: ['概念'], exclude: false }] },
    });
    expect(result.total).toBe(1);
    expect(result.items[0]!.assetId).toBe(assetId);

    // Search for full CJK term (all tokens present).
    const result2 = service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: null, values: ['角色'], exclude: false }] },
    });
    expect(result2.total).toBe(1);

    service.closeAll();
  });
});

// ── bm25 Weighting ──────────────────────────────────────────────────

describe('bm25 weighting', () => {
  it('ranks filename match above tags match', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'BM25', selectedParentPath: root });
    const libraryId = library.libraryId;
    const libraryPath = library.libraryPath;

    // Create a managed folder first (library is open).
    const managedFolder = service.createManagedFolder({ libraryId, name: 'bm25f' });

    // Insert assets + FTS content directly.
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    const now = new Date().toISOString();

    // Asset 1: "dragon" in filename (weight 10).
    const id1 = randomUUID();
    db.prepare(
      `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
        relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
    ).run(id1, managedFolder.folderId, 'bm25f/file1.png', 'bm25f/file1.png', now, now);
    db.prepare(
      `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
        modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, 100, ?, 'file1.png', 'import', ?)`,
    ).run(randomUUID(), id1, now, now);
    db.prepare('UPDATE assets SET current_revision_id = (SELECT revision_id FROM revisions WHERE asset_id = ? LIMIT 1), updated_at = ? WHERE asset_id = ?')
      .run(id1, now, id1);
    db.prepare(
      `INSERT INTO asset_search_index (asset_id, filename, tags, description, source_url, folder_path, metadata_text)
       VALUES (?, ?, '', '', '', '', '')`,
    ).run(id1, tokenizeForFts('dragon'));

    // Asset 2: "dragon" in tags only (weight 8).
    const id2 = randomUUID();
    db.prepare(
      `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
        relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
    ).run(id2, managedFolder.folderId, 'bm25f/dragon.png', 'bm25f/dragon.png', now, now);
    db.prepare(
      `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
        modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, 100, ?, 'dragon.png', 'import', ?)`,
    ).run(randomUUID(), id2, now, now);
    db.prepare('UPDATE assets SET current_revision_id = (SELECT revision_id FROM revisions WHERE asset_id = ? LIMIT 1), updated_at = ? WHERE asset_id = ?')
      .run(id2, now, id2);
    db.prepare(
      `INSERT INTO asset_search_index (asset_id, filename, tags, description, source_url, folder_path, metadata_text)
       VALUES (?, ?, ?, '', '', '', '')`,
    ).run(id2, tokenizeForFts('other'), tokenizeForFts('dragon'));

    // Asset 3: unrelated (ensures IDF > 0 for "dragon").
    const id3 = randomUUID();
    db.prepare(
      `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
        relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
       VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
    ).run(id3, managedFolder.folderId, 'bm25f/unrelated.png', 'bm25f/unrelated.png', now, now);
    db.prepare(
      `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
        modified_at, original_filename, origin, accepted_at)
       VALUES (?, ?, NULL, 100, ?, 'unrelated.png', 'import', ?)`,
    ).run(randomUUID(), id3, now, now);
    db.prepare('UPDATE assets SET current_revision_id = (SELECT revision_id FROM revisions WHERE asset_id = ? LIMIT 1), updated_at = ? WHERE asset_id = ?')
      .run(id3, now, id3);
    db.prepare(
      `INSERT INTO asset_search_index (asset_id, filename, tags, description, source_url, folder_path, metadata_text)
       VALUES (?, 'unrelated', '', '', '', 'bm25f', '')`,
    ).run(id3);

    db.close();

    const result = service.searchAssets({
      libraryId: library.libraryId,
      query: { clauses: [{ field: null, values: ['dragon'], exclude: false }] },
    });

    // Both should match, but filename match (id1) should rank above tags match (id2).
    expect(result.total).toBe(2);
    expect(result.items[0]!.assetId).toBe(id1);
    expect(result.items[1]!.assetId).toBe(id2);

    service.closeAll();
  });

  it('returns snippets for search results', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags('Hero Concept');

    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: null, values: ['hero'], exclude: false }] },
    });

    expect(result.snippets).toBeDefined();
    expect(result.snippets!.length).toBeGreaterThanOrEqual(1);
    expect(result.snippets!.some((s) => s.assetId === assetId)).toBe(true);

    service.closeAll();
  });

  it('supports a query containing only exclusions without invalid FTS syntax', () => {
    const { service, libraryId, libraryPath, assetId } = createLibraryWithAssetAndTags('Hero Draft');
    const keptAssetId = createSecondAsset(service, libraryId, libraryPath, 'Published Prop');

    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: null, values: ['draft'], exclude: true }] },
      sort: { field: 'name', order: 'asc' },
    });

    expect(result.items.some((asset) => asset.assetId === assetId)).toBe(false);
    expect(result.items.some((asset) => asset.assetId === keptAssetId)).toBe(true);
    service.closeAll();
  });
});

// ── FTS5 Query Builder ──────────────────────────────────────────────

describe('FTS5 query builder', () => {
  it('builds single-token query', () => {
    const query = buildFts5Query([{ field: null, values: ['hero'], exclude: false }]);
    expect(query).toBe('"hero"');
  });

  it('builds field-specific query', () => {
    const query = buildFts5Query([{ field: 'filename', values: ['PBR'], exclude: false }]);
    expect(query).toBe('filename:"PBR"');
  });

  it('builds multi-value OR query', () => {
    const query = buildFts5Query([{ field: 'tags', values: ['character', 'prop'], exclude: false }]);
    expect(query).toBe('(tags:"character" OR tags:"prop")');
  });

  it('builds exclude query', () => {
    const query = buildFts5Query([{ field: null, values: ['draft'], exclude: true }]);
    expect(query).toBe('"__IMPOSSIBLE__"');
  });

  it('builds combined AND + OR + exclude query', () => {
    const query = buildFts5Query([
      { field: 'filename', values: ['PBR'], exclude: false },
      { field: 'tags', values: ['character', 'prop'], exclude: false },
      { field: 'folder_path', values: ['archive'], exclude: true },
    ]);
    expect(query).toBe('filename:"PBR" (tags:"character" OR tags:"prop") NOT folder_path:"archive"');
  });

  it('normalizes an exclusion that arrives before positive clauses', () => {
    const query = buildFts5Query([
      { field: null, values: ['draft'], exclude: true },
      { field: null, values: ['hero'], exclude: false },
    ]);
    expect(query).toBe('"hero" NOT "draft"');
  });

  it('never emits a leading NOT when positive input sanitizes to empty', () => {
    const query = buildFts5Query([
      { field: null, values: ['*'], exclude: false },
      { field: null, values: ['draft'], exclude: true },
    ]);
    expect(query).toBe('"__IMPOSSIBLE__"');
  });

  it('rejects unknown field names', () => {
    const query = buildFts5Query([{ field: 'evil', values: ['injection'], exclude: false }]);
    expect(query).toBe('"__IMPOSSIBLE__"');
  });

  it('sanitizes FTS5 special characters', () => {
    const query = buildFts5Query([{ field: null, values: ['" OR 1=1 --'], exclude: false }]);
    // Quotes are stripped, but the words become safe quoted literals.
    // The query should not contain unquoted special chars that alter FTS semantics.
    // Check that the returned string is a legitimate FTS5 query (all tokens double-quoted).
    const parts = query.split(' ');
    for (const part of parts) {
      // Each token should be a double-quoted literal.
      expect(part.startsWith('"')).toBe(true);
      expect(part.endsWith('"')).toBe(true);
    }
  });

  it('strips asterisk wildcards', () => {
    const query = buildFts5Query([{ field: null, values: ['drive*'], exclude: false }]);
    expect(query).toEqual(expect.not.stringContaining('*'));
  });

  it('returns impossible query for empty values', () => {
    const query = buildFts5Query([{ field: null, values: [], exclude: false }]);
    expect(query).toBe('"__IMPOSSIBLE__"');
  });
});

// ── Search Filters ──────────────────────────────────────────────────

describe('search filters', () => {
  it('scopes ordinary browsing to managed folders with optional descendants', () => {
    const { service, libraryId, libraryPath, assetId } = createLibraryWithAssetAndTags();
    const parent = service.listManagedFolders(libraryId)[0]!;
    const child = service.createManagedFolder({
      libraryId,
      parentFolderId: parent.folderId,
      name: 'Child',
    });
    const childAssetId = randomUUID();
    const childRevisionId = randomUUID();
    const childName = 'nested.png';
    const childRelativePath = `${child.relativePath}/${childName}`;
    const now = new Date().toISOString();
    writeFileSync(path.join(libraryPath, 'Assets', childRelativePath), 'nested asset');
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    try {
      db.prepare(
        `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
          relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
         VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
      ).run(childAssetId, child.folderId, childRelativePath, childRelativePath, now, now);
      db.prepare(
        `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
          modified_at, original_filename, origin, accepted_at)
         VALUES (?, ?, NULL, 12, ?, ?, 'import', ?)`,
      ).run(childRevisionId, childAssetId, now, childName, now);
      db.prepare('UPDATE assets SET current_revision_id = ? WHERE asset_id = ?')
        .run(childRevisionId, childAssetId);
    } finally {
      db.close();
    }

    const direct = service.searchAssets({
      libraryId,
      scope: { kind: 'folder', folderId: parent.folderId, recursive: false },
    });
    const recursive = service.searchAssets({
      libraryId,
      scope: { kind: 'folder', folderId: parent.folderId, recursive: true },
    });

    expect(direct.items.map((asset) => asset.assetId)).toEqual([assetId]);
    expect(recursive.items.map((asset) => asset.assetId).sort()).toEqual(
      [assetId, childAssetId].sort(),
    );
    service.closeAll();
  });

  // REQ-FILTER-012: a folder-scoped search with a real query string recurses
  // into descendant folders (depth ≥2) when recursive is true, and stays
  // limited to the folder itself when recursive is false.
  it('matches grandchild folder assets in folder-scoped search only when recursive', () => {
    const { service, libraryId, libraryPath } = createLibraryWithAssetAndTags();
    const parent = service.listManagedFolders(libraryId)[0]!;
    const child = service.createManagedFolder({
      libraryId,
      parentFolderId: parent.folderId,
      name: 'Child',
    });
    const grandchild = service.createManagedFolder({
      libraryId,
      parentFolderId: child.folderId,
      name: 'Grandchild',
    });

    // Raw-SQL asset fixture in the same style as the folder-scope browse test
    // above; setAssetMetadata then syncs the asset into the FTS index.
    const insertAssetIntoFolder = (
      folder: { folderId: string; relativePath: string },
      fileName: string,
    ): string => {
      const id = randomUUID();
      const revisionId = randomUUID();
      const relativePath = `${folder.relativePath}/${fileName}`;
      const now = new Date().toISOString();
      writeFileSync(path.join(libraryPath, 'Assets', relativePath), 'needle asset');
      const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
      try {
        db.prepare(
          `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
            relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
           VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
        ).run(id, folder.folderId, relativePath, relativePath, now, now);
        db.prepare(
          `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
            modified_at, original_filename, origin, accepted_at)
           VALUES (?, ?, NULL, 12, ?, ?, 'import', ?)`,
        ).run(revisionId, id, now, fileName, now);
        db.prepare('UPDATE assets SET current_revision_id = ? WHERE asset_id = ?')
          .run(revisionId, id);
      } finally {
        db.close();
      }
      service.setAssetMetadata({ libraryId, assetId: id, expectedVersion: 0 });
      return id;
    };

    // Depth 1 (direct child) and depth 2 (grandchild) both carry the query term.
    const childAssetId = insertAssetIntoFolder(child, 'needle-shallow.png');
    const grandchildAssetId = insertAssetIntoFolder(grandchild, 'needle-deep.png');

    const query = { clauses: [{ field: null, values: ['needle'], exclude: false }] };
    const recursive = service.searchAssets({
      libraryId,
      query,
      scope: { kind: 'folder', folderId: parent.folderId, recursive: true },
    });
    const direct = service.searchAssets({
      libraryId,
      query,
      scope: { kind: 'folder', folderId: parent.folderId, recursive: false },
    });

    // Recursive search reaches the grandchild (depth 2), not just direct children.
    expect(recursive.items.map((asset) => asset.assetId).sort()).toEqual(
      [childAssetId, grandchildAssetId].sort(),
    );
    // Non-recursive search stays inside the parent folder: neither the child
    // nor the grandchild asset matches.
    expect(direct.items.some((asset) => asset.assetId === grandchildAssetId)).toBe(false);
    expect(direct.items.some((asset) => asset.assetId === childAssetId)).toBe(false);
    expect(direct.items).toHaveLength(0);
    service.closeAll();
  });

  it('intersects search results with the current collection scope', () => {
    const { service, libraryId, libraryPath, assetId } = createLibraryWithAssetAndTags();
    const otherAssetId = createSecondAsset(service, libraryId, libraryPath, 'Other Hero');
    const collection = service.createCollection({ libraryId, name: 'Scoped' });
    service.addCollectionAssets({ libraryId, collectionId: collection.collectionId, assetIds: [assetId] });

    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: null, values: ['hero'], exclude: false }] },
      scope: { kind: 'collection', collectionId: collection.collectionId, recursive: false },
    });

    expect(result.items.map((asset) => asset.assetId)).toEqual([assetId]);
    expect(result.items.some((asset) => asset.assetId === otherAssetId)).toBe(false);
    service.closeAll();
  });

  it('keeps soft-deleted assets out of normal search results', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags();
    service.trashAssets({ libraryId, assetIds: [assetId] });

    const result = service.searchAssets({ libraryId, filters: [] });

    expect(result.items.some((asset) => asset.assetId === assetId)).toBe(false);
    service.closeAll();
  });

  it('filters by format with OR', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Fmt', selectedParentPath: root });
    const mf = service.createManagedFolder({ libraryId: library.libraryId, name: 'f' });
    service.closeAll();

    const db = new TestDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    const now = new Date().toISOString();
    const makeAsset = (fileName: string): string => {
      const id = randomUUID();
      const rel = `f/${fileName}`;
      db.prepare(
        `INSERT INTO assets (asset_id, location_kind, managed_folder_id, linked_folder_id,
          relative_file_path, current_revision_id, availability, path_identity, created_at, updated_at)
         VALUES (?, 'managed', ?, NULL, ?, NULL, 'available', ?, ?, ?)`,
      ).run(id, mf.folderId, rel, rel, now, now);
      db.prepare(
        `INSERT INTO revisions (revision_id, asset_id, parent_revision_id, byte_size,
          modified_at, original_filename, origin, accepted_at)
         VALUES (?, ?, NULL, 100, ?, ?, 'import', ?)`,
      ).run(randomUUID(), id, now, fileName, now);
      db.prepare('UPDATE assets SET current_revision_id = (SELECT revision_id FROM revisions WHERE asset_id = ? LIMIT 1), updated_at = ? WHERE asset_id = ?')
        .run(id, now, id);
      return id;
    };
    const pngId = makeAsset('test.png');
    const jpgId = makeAsset('photo.jpg');
    db.close();

    service.openLibrary(library.libraryPath);

    // Filter PNG only.
    const pngResult = service.searchAssets({
      libraryId: library.libraryId,
      filters: [{ field: 'format', values: ['png'], exclude: false }],
    });
    expect(pngResult.total).toBe(1);
    expect(pngResult.items[0]!.assetId).toBe(pngId);

    // Filter PNG OR JPG.
    const bothResult = service.searchAssets({
      libraryId: library.libraryId,
      filters: [{ field: 'format', values: ['png', 'jpg'], exclude: false }],
    });
    expect(bothResult.total).toBe(2);

    // Exclude PNG.
    const excludePng = service.searchAssets({
      libraryId: library.libraryId,
      filters: [{ field: 'format', values: ['png'], exclude: true }],
    });
    expect(excludePng.total).toBe(1);
    expect(excludePng.items[0]!.assetId).toBe(jpgId);

    service.closeAll();
  });

  it('filters by rating', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    const _assetId2 = createSecondAsset(service, libraryId, libraryPath);

    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 1, rating: 5 });
    service.setAssetMetadata({ libraryId, assetId: _assetId2, expectedVersion: 0, rating: 2 });

    const highRated = service.searchAssets({
      libraryId,
      filters: [{ field: 'rating', values: ['4', '5'], exclude: false }],
    });
    expect(highRated.total).toBe(1);
    expect(highRated.items[0]!.assetId).toBe(assetId);

    service.closeAll();
  });

  it('filters by tag', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags();
    const tag = service.createTag({ libraryId, name: 'Character' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    const withTag = service.searchAssets({
      libraryId,
      filters: [{ field: 'tag', values: ['character'], exclude: false }],
    });
    expect(withTag.total).toBe(1);
    expect(withTag.items[0]!.assetId).toBe(assetId);

    // Exclude the tag.
    const withoutTag = service.searchAssets({
      libraryId,
      filters: [{ field: 'tag', values: ['Character'], exclude: true }],
    });
    expect(withoutTag.total).toBe(0);

    service.closeAll();
  });

  it('excludes multiple tags with every placeholder bound (regression)', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags();
    const tag = service.createTag({ libraryId, name: 'Character' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    // Multi-value exclude previously left placeholders unbound and better-sqlite3
    // threw "too few parameter values", failing the search closed.
    const excluded = service.searchAssets({
      libraryId,
      filters: [{ field: 'tag', values: ['Character', 'Environment'], exclude: true }],
    });
    expect(excluded.total).toBe(0);

    // Assets carrying none of the excluded tags survive the filter.
    const kept = service.searchAssets({
      libraryId,
      filters: [{ field: 'tag', values: ['Environment', 'Props'], exclude: true }],
    });
    expect(kept.total).toBe(1);

    service.closeAll();
  });

  it('combines format AND rating filters', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags();
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 1, rating: 5 });

    // Match: png AND rating 5.
    const result = service.searchAssets({
      libraryId,
      filters: [
        { field: 'format', values: ['png'], exclude: false },
        { field: 'rating', values: ['5'], exclude: false },
      ],
    });
    expect(result.total).toBe(1);

    // Mismatch: png AND rating 1 (no such asset).
    const empty = service.searchAssets({
      libraryId,
      filters: [
        { field: 'format', values: ['png'], exclude: false },
        { field: 'rating', values: ['1'], exclude: false },
      ],
    });
    expect(empty.total).toBe(0);

    service.closeAll();
  });

  it('filters by favorite', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    // The helper already creates metadata with favorite=true (via setAssetMetadata).
    // Create a second asset without favorite to verify the filter distinguishes them.
    void createSecondAsset(service, libraryId, libraryPath);

    const fav = service.searchAssets({
      libraryId,
      filters: [{ field: 'favorite', values: [], exclude: false }],
    });
    // Asset 1 has favorite=true from the helper. Asset 2 has no metadata row.
    expect(fav.items.some((a) => a.assetId === assetId)).toBe(true);

    const notFav = service.searchAssets({
      libraryId,
      filters: [{ field: 'favorite', values: [], exclude: true }],
    });
    // Excluding favorite should NOT include the favorited asset.
    expect(notFav.items.some((a) => a.assetId === assetId)).toBe(false);

    service.closeAll();
  });

  it('filters by availability', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const available = service.searchAssets({
      libraryId,
      filters: [{ field: 'availability', values: ['available'], exclude: false }],
    });
    expect(available.total).toBeGreaterThanOrEqual(1);

    const missing = service.searchAssets({
      libraryId,
      filters: [{ field: 'availability', values: ['missing'], exclude: false }],
    });
    expect(missing.total).toBe(0);

    service.closeAll();
  });

  it('filters by source_url', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags('Hero Concept');
    // The helper creates asset with sourcePageUrl set. Create a second without.
    void createSecondAsset(service, libraryId, libraryPath);

    // Asset 1 has sourcePageUrl from helper; asset 2 does not.
    const withUrl = service.searchAssets({
      libraryId,
      filters: [{ field: 'source_url', values: [], exclude: false }],
    });
    expect(withUrl.items.some((a) => a.assetId === assetId)).toBe(true);

    const withoutUrl = service.searchAssets({
      libraryId,
      filters: [{ field: 'source_url', values: [], exclude: true }],
    });
    // Excluding assets with source_url should NOT include assetId.
    expect(withoutUrl.items.some((a) => a.assetId === assetId)).toBe(false);

    service.closeAll();
  });

  it('filters technical metadata with typed ranges, OR semantics, and explicit NULL behavior', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    const portraitId = createSecondAsset(service, libraryId, libraryPath, 'Portrait');
    const unknownId = createSecondAsset(service, libraryId, libraryPath, 'Unknown');
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    const revisions = db.prepare(
      'SELECT asset_id, current_revision_id FROM assets WHERE asset_id IN (?, ?)',
    ).all(assetId, portraitId) as Array<{ asset_id: string; current_revision_id: string }>;
    const insert = db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          width, height, duration_ms, generator_version, status, generated_at)
       VALUES (?, ?, 'extracted_metadata', 'application/json', 1, ?, ?, ?, ?, 'test', 'ready', ?)`,
    );
    const now = new Date().toISOString();
    for (const row of revisions) {
      const isLandscape = row.asset_id === assetId;
      insert.run(
        randomUUID(),
        row.current_revision_id,
        `${row.asset_id}.json`,
        isLandscape ? 1920 : 1080,
        isLandscape ? 1080 : 1920,
        isLandscape ? 20_000 : 5_000,
        now,
      );
    }
    db.close();

    const landscape = service.searchAssets({
      libraryId,
      filters: [
        { field: 'width', ranges: [{ min: 1900 }], exclude: false },
        { field: 'height', ranges: [{ max: 1100 }], exclude: false },
        { field: 'aspect_ratio', ranges: [{ min: 1.7, max: 1.8 }], exclude: false },
        { field: 'duration_ms', ranges: [{ min: 10_000, max: 30_000 }], exclude: false },
      ],
    });
    expect(landscape.items.map((asset) => asset.assetId)).toEqual([assetId]);

    const eitherDuration = service.searchAssets({
      libraryId,
      filters: [{
        field: 'duration_ms',
        ranges: [{ max: 5_000 }, { min: 20_000 }],
        exclude: false,
      }],
      sort: { field: 'duration', order: 'asc' },
      limit: 1,
      offset: 1,
    });
    expect(eitherDuration.total).toBe(2);
    expect(eitherDuration.items).toHaveLength(1);
    expect(eitherDuration.items[0]!.assetId).toBe(assetId);

    const excludeLandscape = service.searchAssets({
      libraryId,
      filters: [{ field: 'aspect_ratio', ranges: [{ min: 1.7 }], exclude: true }],
    });
    expect(excludeLandscape.items.map((asset) => asset.assetId).sort())
      .toEqual([portraitId, unknownId].sort());
    service.closeAll();
  });

  it('filters long_edge buckets for resolution presets, with NULL semantics intact (REQ-FILTER-010)', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    const portraitId = createSecondAsset(service, libraryId, libraryPath, 'Portrait');
    const unknownId = createSecondAsset(service, libraryId, libraryPath, 'Unknown');
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    const revisions = db.prepare(
      'SELECT asset_id, current_revision_id FROM assets WHERE asset_id IN (?, ?)',
    ).all(assetId, portraitId) as Array<{ asset_id: string; current_revision_id: string }>;
    const insert = db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          width, height, duration_ms, generator_version, status, generated_at)
       VALUES (?, ?, 'extracted_metadata', 'application/json', 1, ?, ?, ?, ?, 'test', 'ready', ?)`,
    );
    const now = new Date().toISOString();
    for (const row of revisions) {
      const isLandscape = row.asset_id === assetId;
      insert.run(
        randomUUID(),
        row.current_revision_id,
        `${row.asset_id}.json`,
        isLandscape ? 1920 : 1080,
        isLandscape ? 1080 : 1920,
        0,
        now,
      );
    }
    db.close();

    // Both assets have long edge 1920 regardless of orientation; the
    // metadata-less asset is omitted from positive matches.
    const atLeast1K = service.searchAssets({
      libraryId,
      filters: [{ field: 'long_edge', ranges: [{ min: 1900 }], exclude: false }],
    });
    expect(atLeast1K.items.map((asset) => asset.assetId).sort())
      .toEqual([assetId, portraitId].sort());

    const below1K = service.searchAssets({
      libraryId,
      filters: [{ field: 'long_edge', ranges: [{ max: 1900 }], exclude: false }],
    });
    expect(below1K.items).toHaveLength(0);

    const bucket2K = service.searchAssets({
      libraryId,
      filters: [{ field: 'long_edge', ranges: [{ min: 2240, max: 3199 }], exclude: false }],
    });
    expect(bucket2K.items).toHaveLength(0);

    // Exclusion retains metadata-less assets, matching the other numeric fields.
    const excludeBig = service.searchAssets({
      libraryId,
      filters: [{ field: 'long_edge', ranges: [{ min: 1900 }], exclude: true }],
    });
    expect(excludeBig.items.map((asset) => asset.assetId)).toEqual([unknownId]);
    service.closeAll();
  });
});

// ── Sort ────────────────────────────────────────────────────────────

describe('sort', () => {
  it('preserves a linked asset location kind in search results', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const library = service.createLibrary({ displayName: 'Linked Search', selectedParentPath: root });
    const linkedRoot = path.join(root, 'linked-search-source');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'linked.png'), 'linked');
    service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: linkedRoot });

    const result = service.searchAssets({ libraryId: library.libraryId });
    expect(result.items).toEqual([
      expect.objectContaining({ locationKind: 'linked', displayName: 'linked.png' }),
    ]);
    service.closeAll();
  });

  it('sorts by rating descending', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    const assetId2 = createSecondAsset(service, libraryId, libraryPath, 'Other');

    // Asset 1 already has rating 5 from helper (entityVersion=1), update is fine.
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 1, rating: 5 });
    // Asset 2 was created via createSecondAsset with label='Other' which called setAssetMetadata,
    // so it has entityVersion=1. We update it here.
    service.setAssetMetadata({ libraryId, assetId: assetId2, expectedVersion: 1, rating: 2 });

    const result = service.searchAssets({
      libraryId,
      sort: { field: 'rating', order: 'desc' },
    });
    expect(result.items[0]!.assetId).toBe(assetId);
    expect(result.items[1]!.assetId).toBe(assetId2);

    service.closeAll();
  });

  it('sorts by byte_size ascending', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    const assetId2 = createSecondAsset(service, libraryId, libraryPath, 'Tiny');

    // First asset: 2048000 bytes, second: 4096 bytes.
    const result = service.searchAssets({
      libraryId,
      sort: { field: 'byte_size', order: 'asc' },
    });
    expect(result.items[0]!.assetId).toBe(assetId2);
    expect(result.items[1]!.assetId).toBe(assetId);

    service.closeAll();
  });

  it('sorts by long_edge ascending with nulls last', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    const assetId2 = createSecondAsset(service, libraryId, libraryPath, 'Small');
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    const revisions = db.prepare(
      'SELECT asset_id, current_revision_id FROM assets WHERE asset_id IN (?, ?)',
    ).all(assetId, assetId2) as Array<{ asset_id: string; current_revision_id: string }>;
    const insert = db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          width, height, generator_version, status, generated_at)
       VALUES (?, ?, 'extracted_metadata', 'application/json', 1, ?, ?, ?, 'test', 'ready', ?)`,
    );
    const now = new Date().toISOString();
    for (const row of revisions) {
      const width = row.asset_id === assetId ? 3840 : 800;
      const height = row.asset_id === assetId ? 2160 : 600;
      insert.run(
        randomUUID(),
        row.current_revision_id,
        `${row.asset_id}.json`,
        width,
        height,
        now,
      );
    }
    db.close();

    const result = service.searchAssets({
      libraryId,
      sort: { field: 'long_edge', order: 'asc' },
    });
    expect(result.items.map((asset) => asset.assetId)).toEqual([assetId2, assetId]);

    service.closeAll();
  });

  it('sorts by extracted video duration with nulls last and projects durationMs', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    const assetId2 = createSecondAsset(service, libraryId, libraryPath, 'Short');
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    const revisions = db.prepare(
      'SELECT asset_id, current_revision_id FROM assets WHERE asset_id IN (?, ?)',
    ).all(assetId, assetId2) as Array<{ asset_id: string; current_revision_id: string }>;
    const insert = db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          width, height, duration_ms, generator_version, status, generated_at)
       VALUES (?, ?, 'extracted_metadata', 'application/json', 1, ?, 1920, 1080, ?, 'test', 'ready', ?)`,
    );
    const now = new Date().toISOString();
    for (const row of revisions) {
      const durationMs = row.asset_id === assetId ? 20_000 : 5_000;
      insert.run(randomUUID(), row.current_revision_id, `${row.asset_id}.json`, durationMs, now);
    }
    db.close();

    const ascending = service.searchAssets({
      libraryId,
      sort: { field: 'duration', order: 'asc' },
    });
    expect(ascending.items.map((asset) => asset.assetId)).toEqual([assetId2, assetId]);
    expect(ascending.items.map((asset) => asset.durationMs)).toEqual([5_000, 20_000]);
    const descending = service.searchAssets({
      libraryId,
      sort: { field: 'duration', order: 'desc' },
    });
    expect(descending.items.map((asset) => asset.assetId)).toEqual([assetId, assetId2]);
    service.closeAll();
  });

  it('sorts by indexed dominant colour with nulls last and an asset-id tie break', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    const sameHueAssetId = createSecondAsset(service, libraryId, libraryPath, 'Same red');
    const unknownAssetId = createSecondAsset(service, libraryId, libraryPath, 'No palette');
    const db = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    const revisions = db.prepare(
      'SELECT asset_id, current_revision_id FROM assets WHERE asset_id IN (?, ?)',
    ).all(assetId, sameHueAssetId) as Array<{ asset_id: string; current_revision_id: string }>;
    const insert = db.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          generator_version, status, generated_at, dominant_hue, dominant_lightness)
       VALUES (?, ?, 'extracted_palette', 'application/json', 1, ?, 'test', 'ready', ?, 0, 0.5)`,
    );
    const now = new Date().toISOString();
    for (const row of revisions) {
      insert.run(randomUUID(), row.current_revision_id, `${row.asset_id}-palette.json`, now);
    }
    db.close();

    const result = service.searchAssets({
      libraryId,
      sort: { field: 'color', order: 'asc' },
    });
    expect(result.items.map((asset) => asset.assetId)).toEqual([
      ...[assetId, sameHueAssetId].sort(),
      unknownAssetId,
    ]);
    service.closeAll();
  });

  it('sorts by name', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const result = service.searchAssets({
      libraryId,
      sort: { field: 'name', order: 'asc' },
    });
    expect(result.items.length).toBeGreaterThanOrEqual(1);

    service.closeAll();
  });
});

// ── Pagination ──────────────────────────────────────────────────────

describe('pagination', () => {
  it('paginates with limit and offset', () => {
    const { service, libraryId, libraryPath } = createLibraryWithAssetAndTags();
    void createSecondAsset(service, libraryId, libraryPath, 'Second');

    // Page 1: limit=1, offset=0.
    const page1 = service.searchAssets({ libraryId, limit: 1, offset: 0 });
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBe(2);

    // Page 2: limit=1, offset=1.
    const page2 = service.searchAssets({ libraryId, limit: 1, offset: 1 });
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(2);

    // Both pages should have different assets.
    expect(page1.items[0]!.assetId).not.toBe(page2.items[0]!.assetId);

    service.closeAll();
  });

  it('preserves manual collection order across pages', () => {
    const { service, libraryId, libraryPath, assetId } = createLibraryWithAssetAndTags();
    const secondAssetId = createSecondAsset(service, libraryId, libraryPath, 'Second');
    const collection = service.createCollection({ libraryId, name: 'Ordered' });
    service.addCollectionAssets({
      libraryId,
      collectionId: collection.collectionId,
      assetIds: [secondAssetId, assetId],
    });

    const first = service.searchAssets({
      libraryId,
      scope: { kind: 'collection', collectionId: collection.collectionId, recursive: false },
      limit: 1,
      offset: 0,
    });
    const second = service.searchAssets({
      libraryId,
      scope: { kind: 'collection', collectionId: collection.collectionId, recursive: false },
      limit: 1,
      offset: 1,
    });

    expect(first.items[0]?.assetId).toBe(secondAssetId);
    expect(second.items[0]?.assetId).toBe(assetId);
    service.closeAll();
  });

  it('returns empty items when offset exceeds total', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const result = service.searchAssets({ libraryId, limit: 10, offset: 999 });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.offset).toBe(999);

    service.closeAll();
  });

  it('paginates the explicit trash scope with a stable asset-id tie breaker', () => {
    const { service, libraryId, libraryPath, assetId } = createLibraryWithAssetAndTags();
    const secondAssetId = createSecondAsset(service, libraryId, libraryPath, 'Second');
    service.trashAssets({ libraryId, assetIds: [assetId, secondAssetId] });

    // Force an identical primary sort value so the test exercises the stable
    // asset_id suffix rather than relying on clock resolution.
    const database = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
    try {
      database.prepare('UPDATE assets SET deleted_at = ? WHERE asset_id IN (?, ?)')
        .run('2026-07-13T00:00:00.000Z', assetId, secondAssetId);
    } finally {
      database.close();
    }

    const first = service.searchAssets({
      libraryId,
      scope: { kind: 'trash' },
      limit: 1,
      offset: 0,
    });
    const second = service.searchAssets({
      libraryId,
      scope: { kind: 'trash' },
      limit: 1,
      offset: 1,
    });

    expect(first.total).toBe(2);
    expect(second.total).toBe(2);
    expect([first.items[0]!.assetId, second.items[0]!.assetId])
      .toEqual([assetId, secondAssetId].sort());
    expect(first.items[0]!.deletedAt).not.toBeNull();
    expect(service.searchAssets({ libraryId }).total).toBe(0);
    service.closeAll();
  });

  it('returns total=0 for empty search results', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: null, values: ['nonexistent_token_12345'], exclude: false }] },
    });
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);

    service.closeAll();
  });
});

// ── Smart Collections (v6) ──────────────────────────────────────────

describe('smart collections v6', () => {
  it('creates and lists with collectionId and position', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const sc = service.createSmartCollection({
      libraryId,
      name: '  Starred  ',
      queryDefinitionJson: JSON.stringify({
        filters: [{ field: 'favorite', values: [], exclude: false }],
      }),
    });
    expect(sc.collectionId).toBeTruthy();
    expect(sc.name).toBe('Starred');
    expect(sc.position).toBe(0);
    expect(sc.queryDefinition).toContain('favorite');

    const list = service.listSmartCollections(libraryId);
    expect(list).toHaveLength(1);
    expect(list[0]!.collectionId).toBe(sc.collectionId);

    service.closeAll();
  });

  it('enforces UNIQUE(library_id, name)', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    service.createSmartCollection({ libraryId, name: 'Unique', queryDefinitionJson: '{}' });
    expectServiceCode(
      () => service.createSmartCollection({ libraryId, name: 'Unique', queryDefinitionJson: '{}' }),
      'FOLDER_ALREADY_EXISTS',
    );

    service.closeAll();
  });

  it('rejects invalid JSON in queryDefinitionJson', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    expectServiceCode(
      () => service.createSmartCollection({ libraryId, name: 'Bad', queryDefinitionJson: 'not-json' }),
      'INVALID_IMPORT_DECISION',
    );

    service.closeAll();
  });

  it('rejects valid JSON that does not match the strict query definition schema', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    expectServiceCode(
      () => service.createSmartCollection({
        libraryId,
        name: 'Bad shape',
        queryDefinitionJson: '{"search":"hero","absolutePath":"/private/tmp/secret"}',
      }),
      'INVALID_IMPORT_DECISION',
    );

    service.closeAll();
  });

  it('executes a smart collection and returns filtered results', () => {
    const { service, libraryId, assetId, libraryPath } = createLibraryWithAssetAndTags();
    const assetId2 = createSecondAsset(service, libraryId, libraryPath, 'Sketch');

    // Asset 1: rating=5 from helper (entityVersion=1). Update label.
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 1, rating: 5 });
    // Asset 2: description set in createSecondAsset, row has entityVersion=1. Update rating.
    service.setAssetMetadata({ libraryId, assetId: assetId2, expectedVersion: 1, rating: 1 });

    const sc = service.createSmartCollection({
      libraryId,
      name: 'Top Rated',
      queryDefinitionJson: JSON.stringify({
        filters: [{ field: 'rating', values: ['4', '5'], exclude: false }],
        sort: { field: 'rating', order: 'desc' },
      }),
    });

    const result = service.executeSmartCollection({ libraryId, collectionId: sc.collectionId });
    expect(result.total).toBe(1);
    expect(result.items[0]!.assetId).toBe(assetId);
    expect(result.offset).toBe(0);

    service.closeAll();
  });

  it('paginates a smart collection without switching query definitions', () => {
    const { service, libraryId, libraryPath } = createLibraryWithAssetAndTags();
    createSecondAsset(service, libraryId, libraryPath, 'Second');
    const smart = service.createSmartCollection({
      libraryId,
      name: 'All paged',
      queryDefinitionJson: JSON.stringify({ sort: { field: 'name', order: 'asc' } }),
    });

    const first = service.executeSmartCollection({ libraryId, collectionId: smart.collectionId, limit: 1, offset: 0 });
    const second = service.executeSmartCollection({ libraryId, collectionId: smart.collectionId, limit: 1, offset: 1 });

    expect(first.total).toBe(2);
    expect(first.items).toHaveLength(1);
    expect(second.offset).toBe(1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.assetId).not.toBe(first.items[0]!.assetId);
    service.closeAll();
  });

  it('executes with search query from queryDefinitionJson', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags('Masterpiece');

    const sc = service.createSmartCollection({
      libraryId,
      name: 'Searchable',
      queryDefinitionJson: JSON.stringify({
        search: { clauses: [{ field: null, values: ['Masterpiece'], exclude: false }] },
      }),
    });

    const result = service.executeSmartCollection({ libraryId, collectionId: sc.collectionId });
    expect(result.total).toBe(1);
    expect(result.items[0]!.assetId).toBe(assetId);

    service.closeAll();
  });

  it('updates smart collection partially', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const sc = service.createSmartCollection({ libraryId, name: 'Orig', queryDefinitionJson: '{}' });

    const updated = service.updateSmartCollection({
      libraryId,
      collectionId: sc.collectionId,
      name: 'Renamed',
      position: 3,
    });
    expect(updated.name).toBe('Renamed');
    expect(updated.position).toBe(3);

    // Partial update: only change position.
    const updated2 = service.updateSmartCollection({
      libraryId,
      collectionId: sc.collectionId,
      position: 7,
    });
    expect(updated2.name).toBe('Renamed');
    expect(updated2.position).toBe(7);

    service.closeAll();
  });

  it('deletes a smart collection', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const sc = service.createSmartCollection({ libraryId, name: 'ToDelete', queryDefinitionJson: '{}' });
    const deletedId = service.deleteSmartCollection({ libraryId, collectionId: sc.collectionId });
    expect(deletedId).toBe(sc.collectionId);

    const list = service.listSmartCollections(libraryId);
    expect(list).toEqual([]);

    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND for nonexistent execute target', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();
    expectServiceCode(
      () => service.executeSmartCollection({ libraryId, collectionId: 'nonexistent' }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });

  it('throws FOLDER_NOT_FOUND for nonexistent update/delete target', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();
    expectServiceCode(
      () => service.updateSmartCollection({ libraryId, collectionId: 'nonexistent', name: 'Nope' }),
      'FOLDER_NOT_FOUND',
    );
    expectServiceCode(
      () => service.deleteSmartCollection({ libraryId, collectionId: 'nonexistent' }),
      'FOLDER_NOT_FOUND',
    );
    service.closeAll();
  });
});

// ── metadata_text Content ──────────────────────────────────────────

describe('metadata_text in search index', () => {
  it('includes file extension in metadata_text', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags();

    // The asset is "hero-concept.png". Search for ".png" which is in metadata_text.
    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'metadata_text', values: ['.png'], exclude: false }] },
    });
    expect(result.total).toBe(1);
    expect(result.items[0]!.assetId).toBe(assetId);

    service.closeAll();
  });

  it('includes byte size label in metadata_text', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    // Byte size is 2048000 (~2MB), which maps to "medium".
    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'metadata_text', values: ['medium'], exclude: false }] },
    });
    expect(result.total).toBe(1);

    service.closeAll();
  });

  it('includes availability in metadata_text', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'metadata_text', values: ['available'], exclude: false }] },
    });
    expect(result.total).toBe(1);

    service.closeAll();
  });
});

// ── Query Injection Immunity ────────────────────────────────────────

describe('query injection immunity', () => {
  it('does not crash on SQL-injection-like FTS input', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const result = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: null, values: ["' OR 1=1 --"], exclude: false }] },
    });
    // Should not crash; may return empty results since the token is sanitized.
    expect(result).toBeDefined();
    expect(typeof result.total).toBe('number');

    service.closeAll();
  });

  it('handles empty query clauses gracefully', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const result = service.searchAssets({
      libraryId,
      query: { clauses: [] },
    });
    expect(result.total).toBeGreaterThanOrEqual(1);
    expect(result.items.length).toBeGreaterThanOrEqual(1);

    service.closeAll();
  });

  it('handles null query gracefully', () => {
    const { service, libraryId } = createLibraryWithAssetAndTags();

    const result = service.searchAssets({
      libraryId,
      query: null,
      sort: { field: 'name', order: 'asc' },
    });
    expect(result.total).toBeGreaterThanOrEqual(1);

    service.closeAll();
  });
});

// ── Search After Operations ─────────────────────────────────────────

describe('search after asset operations', () => {
  it('updates search index after tag assignment', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags('Hero');
    const tag = service.createTag({ libraryId, name: 'Character' });

    // Before tag: search for 'Character' in tags field should not match.
    const before = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'tags', values: ['Character'], exclude: false }] },
    });
    expect(before.total).toBe(0);

    // Assign tag.
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    // After tag: should match.
    const after = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'tags', values: ['Character'], exclude: false }] },
    });
    expect(after.total).toBe(1);
    expect(after.items[0]!.assetId).toBe(assetId);

    service.closeAll();
  });

  it('updates search index after tag removal', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags('Hero');
    const tag = service.createTag({ libraryId, name: 'TempTag' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    // Verify tag is indexed.
    const before = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'tags', values: ['TempTag'], exclude: false }] },
    });
    expect(before.total).toBe(1);

    // Remove tag.
    service.removeTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    // Should no longer match.
    const after = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'tags', values: ['TempTag'], exclude: false }] },
    });
    expect(after.total).toBe(0);

    service.closeAll();
  });

  it('updates search index after tag rename and tag deletion', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags('Hero');
    const tag = service.createTag({ libraryId, name: 'OldTagName' });
    service.assignTags({ libraryId, assetIds: [assetId], tagIds: [tag.tagId] });

    service.renameTag({ libraryId, tagId: tag.tagId, name: 'NewTagName' });
    expect(service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'tags', values: ['OldTagName'], exclude: false }] },
    }).total).toBe(0);
    expect(service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'tags', values: ['NewTagName'], exclude: false }] },
    }).total).toBe(1);

    service.deleteTag({ libraryId, tagId: tag.tagId });
    expect(service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'tags', values: ['NewTagName'], exclude: false }] },
    }).total).toBe(0);
    service.closeAll();
  });

  it('updates search index after description change', () => {
    const { service, libraryId, assetId } = createLibraryWithAssetAndTags('Hero', 'Old description');

    // Search for old description.
    const before = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'description', values: ['Old'], exclude: false }] },
    });
    expect(before.total).toBe(1);

    // Update description.
    service.setAssetMetadata({ libraryId, assetId, expectedVersion: 1, description: 'New shiny description' });

    // Old token removed, new token added.
    const afterOld = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'description', values: ['Old'], exclude: false }] },
    });
    expect(afterOld.total).toBe(0);

    const afterNew = service.searchAssets({
      libraryId,
      query: { clauses: [{ field: 'description', values: ['shiny'], exclude: false }] },
    });
    expect(afterNew.total).toBe(1);

    service.closeAll();
  });
});
