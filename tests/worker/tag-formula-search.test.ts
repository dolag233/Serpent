import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseSearchExpression } from '../../src/shared/search-expression';
import { LibraryService } from '../../src/worker/library-service';

const require = createRequire(import.meta.url);
interface TestDatabaseConnection {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): {
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
}
const TestDatabase = require('better-sqlite3') as new (filename: string) => TestDatabaseConnection;
const services: LibraryService[] = [];
const temporaryRoots: string[] = [];

afterEach(() => {
  // Release SQLite and directory watcher handles before removing Windows fixtures.
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.each([
  { name: 'current schema', missingIndex: false, missingAiTags: false },
  { name: 'missing text search index', missingIndex: true, missingAiTags: false },
  { name: 'missing AI tag table', missingIndex: false, missingAiTags: true },
  { name: 'missing both optional tables', missingIndex: true, missingAiTags: true },
])('tag formula search with $name', ({ missingIndex, missingAiTags }) => {
  it('evaluates exact Boolean tag queries through LibraryService after reopening', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-tag-formula-'));
    temporaryRoots.push(root);
    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({ displayName: 'Formula Fixture', selectedParentPath: root });
    const libraryId = library.libraryId;
    const names = ['alpha.txt', 'beta.txt', 'excluded.txt', 'partial.txt', 'untagged.txt', 'ai.txt'];
    const sourcePaths = names.map((name) => {
      const filename = path.join(root, name);
      writeFileSync(filename, `Synthetic tag-query fixture: ${name}`);
      return filename;
    });
    const imported = service.prepareOrExecuteImport({ libraryId, sourceKind: 'files', sourcePaths });
    if ('importId' in imported) throw new Error('Unexpected fixture import conflict');
    const assets = new Map(imported.assets.map((asset) => [asset.displayName, asset]));
    expect(assets.size).toBe(names.length);
    const tags = new Map(['Alpha', 'Beta', 'City', 'Draft', 'Alpha-long'].map((name) => [
      name, service.createTag({ libraryId, name }).tagId,
    ]));
    for (const [name, tagNames] of [
      ['alpha.txt', ['Alpha', 'City']],
      ['beta.txt', ['Beta', 'City']],
      ['excluded.txt', ['Alpha', 'City', 'Draft']],
      ['partial.txt', ['Alpha-long', 'City']],
      ['ai.txt', ['City']],
    ] as const) {
      service.assignTags({
        libraryId,
        assetIds: [assets.get(name)!.assetId],
        tagIds: tagNames.map((tag) => tags.get(tag)!),
      });
    }
    service.closeAll();

    const dbPath = path.join(library.libraryPath, '.serpent', 'library.db');
    const db = new TestDatabase(dbPath);
    try {
      db.prepare(`INSERT INTO ai_asset_tags
        (asset_id, tag_id, revision_id, model_id, model_version)
        VALUES (?, ?, NULL, 'fixture-model', '1')`).run(assets.get('ai.txt')!.assetId, tags.get('Alpha')!);
      if (missingIndex) db.exec('DROP TABLE asset_search_index; DROP TABLE asset_search;');
      if (missingAiTags) db.exec('DROP TABLE ai_asset_tags;');
    } finally {
      db.close();
    }
    service.openLibrary(library.libraryPath);

    // Prove the query really exercises lenient reads, rather than an index
    // silently reconstructed during open making the regression pass.
    const schema = new TestDatabase(dbPath);
    try {
      for (const [table, missing] of [
        ['asset_search_index', missingIndex], ['ai_asset_tags', missingAiTags],
      ] as const) {
        const exists = schema.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
        expect(Boolean(exists)).toBe(!missing);
      }
    } finally {
      schema.close();
    }

    const search = (expression: string) => service.searchAssets({
      libraryId, query: parseSearchExpression(expression), limit: 50, offset: 0,
    });
    const matches = search('tag-formula:(Alpha | Beta) & City - Draft');
    const expected = missingAiTags ? ['alpha.txt', 'beta.txt'] : ['ai.txt', 'alpha.txt', 'beta.txt'];
    expect(matches.items.map((asset) => asset.displayName).sort()).toEqual(expected);
    expect(matches.total).toBe(expected.length);

    const negative = search('tag-formula:!Alpha');
    const expectedNegative = ['beta.txt', 'partial.txt', 'untagged.txt'];
    if (missingAiTags) expectedNegative.unshift('ai.txt');
    expect(negative.items.map((asset) => asset.displayName).sort()).toEqual(expectedNegative);
    expect(negative.total).toBe(expectedNegative.length);
  });
});
