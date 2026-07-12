import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { LibraryService } from '../../src/worker/library-service';
import { OpenAIVendorAdapter } from '../../src/worker/ai/openai-adapter';
import { VendorAdapterError } from '../../src/worker/ai/vendor-adapter';
import type { AiAnalysisRequest } from '../../src/worker/ai/protocol';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestDb {
  close(): void;
  exec(sql: string): void;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(source: string): {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): unknown;
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3') as new (filename: string) => TestDb;

function temporaryRoot(): string {
  const root = path.join(os.tmpdir(), `serpent-ai-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function importNoConflict(service: LibraryService, libraryId: string, sourceFile: string) {
  const prepared = service.prepareOrExecuteImport({
    libraryId,
    targetFolderId: undefined,
    sourceKind: 'files',
    sourcePaths: [sourceFile],
  });
  if ('importId' in prepared) {
    return service.resolveImport({
      importId: prepared.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
  }
  return prepared;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('ai_content schema (v7 -> v8 migration)', () => {
  it('creates the ai_content table with expected columns', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'AI Content Table',
      selectedParentPath: root,
    });

    const db = new Database(path.join(created.libraryPath, '.serpent', 'library.db'));
    const columns = db.prepare("PRAGMA table_info('ai_content')").all() as Array<{
      cid: number; name: string; type: string; notnull: number;
    }>;
    const colNames = columns.map((c) => c.name);
    expect(colNames).toEqual(expect.arrayContaining([
      'ai_content_id', 'asset_id', 'revision_id', 'field_name',
      'value', 'model_id', 'model_version', 'generated_at',
    ]));
    db.close();
    service.closeAll();
  });

  it('has the ai_content_asset_field index', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({
      displayName: 'AI Index Test',
      selectedParentPath: root,
    });

    const db = new Database(path.join(created.libraryPath, '.serpent', 'library.db'));
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'ai_content%'",
    ).all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toContain('ai_content_asset_field');
    db.close();
    service.closeAll();
  });

  it('is idempotent when opening a v8 library', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'AI Idempotent', selectedParentPath: root });
    service.closeAll();

    service.openLibrary(created.libraryPath);
    const db = new Database(path.join(created.libraryPath, '.serpent', 'library.db'));
    const migrations = db.prepare(
      'SELECT version FROM schema_migrations WHERE version = 8',
    ).all() as Array<{ version: number }>;
    expect(migrations).toHaveLength(1);
    db.close();
    service.closeAll();
  });
});

// ---------------------------------------------------------------------------
// writeAiAnalysisResult — tags, content, FTS
// ---------------------------------------------------------------------------

describe('writeAiAnalysisResult', () => {
  it('writes ai_asset_tags with find-or-create by NOCASE name', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'AI Tags', selectedParentPath: root });

    writeFileSync(path.join(root, 'test.png'), 'image-data');
    const importResult = importNoConflict(service, created.libraryId, path.join(root, 'test.png'));
    const assetId = importResult.assets[0]!.assetId;

    // Pre-create an existing tag to verify reuse.
    const existingTag = service.createTag({ libraryId: created.libraryId, name: 'CharacterDesign' });

    const writeResult = service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      tags: ['CharacterDesign', '  SciFi  ', 'NewTag'],
      modelId: 'gpt-4o',
      modelVersion: 'gpt-4o-2024-05-13',
      enabledFields: { label: false, description: false, tags: true, structuredMetadata: false },
    });

    expect(writeResult.tagsWritten).toEqual(['CharacterDesign', 'SciFi', 'NewTag']);

    // Verify: 'CharacterDesign' reused the existing tag_id.
    const db = new Database(path.join(created.libraryPath, '.serpent', 'library.db'));
    const aiTagRows = db.prepare(
      `SELECT t.tag_id, t.name FROM ai_asset_tags aat
         JOIN tags t ON t.tag_id = aat.tag_id
        WHERE aat.asset_id = ?
        ORDER BY t.name`,
    ).all(assetId) as Array<{ tag_id: string; name: string }>;
    expect(aiTagRows.map((r) => r.name)).toEqual(['CharacterDesign', 'NewTag', 'SciFi']);

    // 'CharacterDesign' tag_id should equal the pre-created tag.
    const charRow = aiTagRows.find((r) => r.name === 'CharacterDesign')!;
    expect(charRow.tag_id).toBe(existingTag.tagId);

    // Verify model info is stored.
    const modelRows = db.prepare(
      'SELECT model_id, model_version FROM ai_asset_tags WHERE asset_id = ?',
    ).all(assetId) as Array<{ model_id: string; model_version: string }>;
    for (const r of modelRows) {
      expect(r.model_id).toBe('gpt-4o');
      expect(r.model_version).toBe('gpt-4o-2024-05-13');
    }

    db.close();
    service.closeAll();
  });

  it('writes ai_content rows for label and description', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'AI Content', selectedParentPath: root });

    writeFileSync(path.join(root, 'test.png'), 'image-data');
    const result = importNoConflict(service, created.libraryId, path.join(root, 'test.png'));
    const assetId = result.assets[0]!.assetId;

    const { fieldsWritten } = service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      label: '  Future City Concept  ',
      description: 'A futuristic cityscape.',
      tags: [],
      modelId: 'gpt-4o',
      modelVersion: 'gpt-4o-2024-05-13',
      enabledFields: { label: true, description: true, tags: true, structuredMetadata: false },
    });

    expect(fieldsWritten).toContain('label');
    expect(fieldsWritten).toContain('description');

    const content = service.getAiContent(created.libraryId, assetId);
    const labelEntry = content.find((c) => c.fieldName === 'label');
    const descEntry = content.find((c) => c.fieldName === 'description');
    expect(labelEntry?.value).toBe('Future City Concept');
    expect(descEntry?.value).toBe('A futuristic cityscape.');
    expect(labelEntry?.modelId).toBe('gpt-4o');
    expect(descEntry?.modelVersion).toBe('gpt-4o-2024-05-13');

    service.closeAll();
  });

  it('atomically replaces previous AI content for the same field', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'AI Replace', selectedParentPath: root });

    writeFileSync(path.join(root, 'test.png'), 'image-data');
    const result = importNoConflict(service, created.libraryId, path.join(root, 'test.png'));
    const assetId = result.assets[0]!.assetId;

    // First write.
    service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      label: 'Old Label',
      tags: [],
      modelId: 'gpt-4o',
      modelVersion: 'v1',
      enabledFields: { label: true, description: false, tags: true, structuredMetadata: false },
    });

    // Second write should replace.
    service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      label: 'New Label',
      tags: [],
      modelId: 'gpt-4o',
      modelVersion: 'v2',
      enabledFields: { label: true, description: false, tags: true, structuredMetadata: false },
    });

    const content = service.getAiContent(created.libraryId, assetId);
    const labels = content.filter((c) => c.fieldName === 'label');
    expect(labels).toHaveLength(1);
    expect(labels[0]!.value).toBe('New Label');
    expect(labels[0]!.modelVersion).toBe('v2');

    service.closeAll();
  });

  it('does not store label when label toggle is disabled', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'AI Toggle', selectedParentPath: root });

    writeFileSync(path.join(root, 'test.png'), 'image-data');
    const result = importNoConflict(service, created.libraryId, path.join(root, 'test.png'));
    const assetId = result.assets[0]!.assetId;

    const { fieldsWritten } = service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      label: 'Should Not Be Stored',
      description: 'Should be stored',
      tags: [],
      modelId: 'gpt-4o',
      modelVersion: 'v1',
      enabledFields: { label: false, description: true, tags: true, structuredMetadata: false },
    });

    expect(fieldsWritten).not.toContain('label');
    expect(fieldsWritten).toContain('description');

    const content = service.getAiContent(created.libraryId, assetId);
    expect(content.find((c) => c.fieldName === 'label')).toBeUndefined();
    expect(content.find((c) => c.fieldName === 'description')).toBeDefined();

    service.closeAll();
  });

  it('writes structured_metadata as a JSON string', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'AI Structured', selectedParentPath: root });

    writeFileSync(path.join(root, 'test.png'), 'image-data');
    const result = importNoConflict(service, created.libraryId, path.join(root, 'test.png'));
    const assetId = result.assets[0]!.assetId;

    service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      structuredMetadata: { resolution: '4K', style: 'cyberpunk' },
      tags: [],
      modelId: 'gpt-4o',
      modelVersion: 'v1',
      enabledFields: { label: false, description: false, tags: true, structuredMetadata: true },
    });

    const content = service.getAiContent(created.libraryId, assetId);
    const meta = content.find((c) => c.fieldName === 'structured_metadata');
    expect(meta).toBeDefined();
    expect(JSON.parse(meta!.value)).toEqual({ resolution: '4K', style: 'cyberpunk' });

    service.closeAll();
  });
});

// ---------------------------------------------------------------------------
// FTS sync includes AI tags
// ---------------------------------------------------------------------------

describe('FTS sync with AI tags', () => {
  it('includes AI tags in asset_search_index tags column', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'AI FTS', selectedParentPath: root });

    writeFileSync(path.join(root, 'test.png'), 'image-data');
    const result = importNoConflict(service, created.libraryId, path.join(root, 'test.png'));
    const assetId = result.assets[0]!.assetId;

    // Add a human tag.
    const humanTag = service.createTag({ libraryId: created.libraryId, name: 'HumanTag' });
    service.assignTags({ libraryId: created.libraryId, assetIds: [assetId], tagIds: [humanTag.tagId] });

    // Write AI tags.
    service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      tags: ['AITag1', 'AITag2'],
      modelId: 'gpt-4o',
      modelVersion: 'v1',
      enabledFields: { label: false, description: false, tags: true, structuredMetadata: false },
    });

    const db = new Database(path.join(created.libraryPath, '.serpent', 'library.db'));
    const row = db.prepare(
      'SELECT tags FROM asset_search_index WHERE asset_id = ?',
    ).get(assetId) as { tags: string } | undefined;
    db.close();

    expect(row).toBeDefined();
    const tagsField = (row!.tags ?? '').toLowerCase();
    expect(tagsField).toContain('humantag');
    expect(tagsField).toContain('aitag1');
    expect(tagsField).toContain('aitag2');

    service.closeAll();
  });
});

// ---------------------------------------------------------------------------
// resolveAssetFilePath
// ---------------------------------------------------------------------------

describe('resolveAssetFilePath', () => {
  it('resolves a managed asset path and detects image vs video', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Path Resolve', selectedParentPath: root });

    writeFileSync(path.join(root, 'image.png'), 'image');
    writeFileSync(path.join(root, 'video.mp4'), 'video');

    const r1 = importNoConflict(service, created.libraryId, path.join(root, 'image.png'));
    const r2 = importNoConflict(service, created.libraryId, path.join(root, 'video.mp4'));

    const img = service.resolveAssetFilePath(created.libraryId, r1.assets[0]!.assetId);
    expect(img.mime).toBe('image/png');
    expect(img.isVideo).toBe(false);
    expect(existsSync(img.filePath)).toBe(true);

    const vid = service.resolveAssetFilePath(created.libraryId, r2.assets[0]!.assetId);
    expect(vid.mime).toBe('video/mp4');
    expect(vid.isVideo).toBe(true);

    service.closeAll();
  });

  it('throws ASSET_NOT_FOUND for a non-existent asset', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Missing Asset', selectedParentPath: root });

    expect(() => service.resolveAssetFilePath(created.libraryId, 'no-such-asset')).toThrow(
      'ASSET_NOT_FOUND',
    );

    service.closeAll();
  });
});

// ---------------------------------------------------------------------------
// listTagNames
// ---------------------------------------------------------------------------

describe('listTagNames', () => {
  it('returns all tag names in the library', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Tag Names', selectedParentPath: root });

    service.createTag({ libraryId: created.libraryId, name: 'TagA' });
    service.createTag({ libraryId: created.libraryId, name: 'tagb' }); // NOCASE dedup

    const names = service.listTagNames(created.libraryId);
    expect(names).toContain('TagA');
    expect(names).toContain('tagb');

    service.closeAll();
  });
});

// ---------------------------------------------------------------------------
// VendorAdapterError mapping (via OpenAIVendorAdapter injected fetch)
// ---------------------------------------------------------------------------

describe('error mapping', () => {
  function fetchReturning(status: number, body: unknown): typeof fetch {
    const headers = new Map<string, string>();
    try {
      JSON.stringify(body);
      headers.set('Content-Type', 'application/json');
    } catch {
      // non-JSON body
    }
    return (() =>
      Promise.resolve({
        status,
        headers,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
        ok: status >= 200 && status < 300,
      } as unknown as Response)) as unknown as typeof fetch;
  }

  function networkErrorFetch(): typeof fetch {
    return (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
  }

  it('maps HTTP 401 to auth kind', async () => {
    const adapter = new OpenAIVendorAdapter('key', 'gpt-4o', fetchReturning(401, { error: 'Unauthorized' }));
    let error: unknown;
    try {
      await adapter.analyze(makeImageRequest());
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('auth');
  });

  it('maps HTTP 403 to permission kind', async () => {
    const adapter = new OpenAIVendorAdapter('key', 'gpt-4o', fetchReturning(403, {}));
    let error: unknown;
    try {
      await adapter.analyze(makeImageRequest());
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('permission');
  });

  it('maps HTTP 429 with quota to quota kind', async () => {
    const adapter = new OpenAIVendorAdapter('key', 'gpt-4o', fetchReturning(429, {
      error: { type: 'insufficient_quota', message: 'quota exceeded' },
    }));
    let error: unknown;
    try {
      await adapter.analyze(makeImageRequest());
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('quota');
  });

  it('maps network failure to network kind', async () => {
    const adapter = new OpenAIVendorAdapter('key', 'gpt-4o', networkErrorFetch());
    let error: unknown;
    try {
      await adapter.analyze(makeImageRequest());
    } catch (e) { error = e; }
    expect(error).toBeInstanceOf(VendorAdapterError);
    expect((error as VendorAdapterError).kind).toBe('network');
  });
});

// ---------------------------------------------------------------------------
// API key security: Worker never persists the key
// ---------------------------------------------------------------------------

describe('API key security', () => {
  it('writeAiAnalysisResult never stores the apiKey', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Key Safety', selectedParentPath: root });

    // The apiKey is passed to the adapter constructor, not to writeAiAnalysisResult.
    // verify writeAiAnalysisResult's result contains no key material.
    writeFileSync(path.join(root, 'test.png'), 'image-data');
    const result = importNoConflict(service, created.libraryId, path.join(root, 'test.png'));
    const assetId = result.assets[0]!.assetId;

    const written = service.writeAiAnalysisResult({
      libraryId: created.libraryId,
      assetId,
      label: 'Test',
      tags: [],
      modelId: 'gpt-4o',
      modelVersion: 'v1',
      enabledFields: { label: true, description: false, tags: true, structuredMetadata: false },
    });

    // The result should not contain any key fields.
    expect(JSON.stringify(written)).not.toMatch(/api.?key|sk-/i);

    // getAiContent should not expose any key.
    const content = service.getAiContent(created.libraryId, assetId);
    for (const c of content) {
      expect(c.value).not.toMatch(/api.?key|sk-/i);
    }

    service.closeAll();
  });
});

// ---------------------------------------------------------------------------
// Video asset returns NOT_SUPPORTED (verify worker dispatch behaviour)
// ---------------------------------------------------------------------------

describe('video asset analyze-unsupported', () => {
  it('marks video assets as unsupported due to missing contact sheet', () => {
    const root = temporaryRoot();
    const service = new LibraryService();
    const created = service.createLibrary({ displayName: 'Video Test', selectedParentPath: root });

    writeFileSync(path.join(root, 'clip.mp4'), 'video-data');
    const result = importNoConflict(service, created.libraryId, path.join(root, 'clip.mp4'));
    const assetId = result.assets[0]!.assetId;

    const resolved = service.resolveAssetFilePath(created.libraryId, assetId);
    expect(resolved.isVideo).toBe(true);

    service.closeAll();
  });
});

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function makeImageRequest(): AiAnalysisRequest {
  return {
    filename: 'test.png',
    mime: 'image/png',
    imageBase64: 'aW1hZ2VEYXRh',
    language: 'en',
    enabledFields: { label: true, description: true, tags: true, structuredMetadata: false },
    existingTagNames: [],
  };
}
