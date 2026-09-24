import { describe, expect, it } from 'vitest';

import { browseLayoutEntrySchema, type AssetSummary } from '../../src/shared/asset-types';
import { encodeLinkedVirtualFolderId } from '../../src/shared/linked-folder-tree';
import { TEXT_EXTENSIONS, FORMAT_UNKNOWN_TOKEN } from '../../src/shared/text-media';
import { knownProductFormatExtensionsDotless } from '../../src/shared/product-format-extensions';
import {
  buildCatalogAssetVisibilityPredicates,
  buildCatalogCollectionScope,
  buildCatalogContextualSearchRank,
  buildCatalogContextualSearchWhere,
  buildCatalogExplicitIgnoreSql,
  buildCatalogFilterWhere,
  buildCatalogFolderScopeClause,
  buildCatalogFtsQuery,
  buildCatalogSortOrder,
  catalogAssetSummaryFromRow,
  catalogBrowseLayoutEntryFromRow,
  countCatalogNavigationAssets,
  foldCatalogImageSequenceSummaries,
  readCatalogArtifactDescriptor,
  readCatalogThumbnailArtifacts,
  type CatalogReadConnection,
} from '../../src/worker/catalog-read';

interface ReadCall {
  sql: string;
  method: 'all' | 'get';
  parameters: unknown[];
}

function readConnection(input: {
  getResults?: unknown[];
  allResults?: unknown[][];
} = {}): { connection: CatalogReadConnection; calls: ReadCall[]; preparedSqls: string[] } {
  const getResults = [...(input.getResults ?? [])];
  const allResults = [...(input.allResults ?? [])];
  const calls: ReadCall[] = [];
  const preparedSqls: string[] = [];
  const connection: CatalogReadConnection = {
    prepare(sql) {
      preparedSqls.push(sql);
      return {
        all(...parameters) {
          calls.push({ sql, method: 'all', parameters });
          return allResults.shift() ?? [];
        },
        get(...parameters) {
          calls.push({ sql, method: 'get', parameters });
          return getResults.shift();
        },
      };
    },
  };
  return { connection, calls, preparedSqls };
}

function expectOnlyReadCatalogStatements(preparedSqls: readonly string[]): void {
  expect(preparedSqls.length).toBeGreaterThan(0);
  for (const sql of preparedSqls) {
    // This is a deliberately small audit of module-authored statement shapes,
    // not a general SQL parser. SELECT and WITH permit subqueries/CTEs; the
    // explicit keyword guard catches accidental DML/DDL, including RETURNING.
    expect(sql.trimStart()).toMatch(/^(?:SELECT|WITH)\b/iu);
    expect(sql).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|DETACH)\b/iu,
    );
  }
}

function summary(assetId: string, relativeFilePath: string, byteSize = 1): AssetSummary {
  return {
    assetId,
    locationKind: 'managed',
    managedFolderId: null,
    linkedFolderId: null,
    relativeFilePath,
    displayName: relativeFilePath.split('/').at(-1)!,
    currentRevisionId: `revision-${assetId}`,
    byteSize,
    modifiedAt: '2026-09-14T00:00:00.000Z',
    availability: 'available',
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: null,
    thumbnailArtifactId: null,
    mediaType: 'image',
    width: null,
    height: null,
    durationMs: null,
    sequence: null,
  };
}

describe('shared pure catalog reads', () => {
  it('compiles contextual search, FTS candidates, and relevance with stable field priority', () => {
    const groups = [[
      { field: 'filename', values: ['  Café  '], exclude: false },
      { field: 'tags', values: ['warm'], exclude: true },
    ]];

    expect(buildCatalogFtsQuery(groups)).toBe('(filename : "café" NOT tags : "warm")');
    expect(buildCatalogContextualSearchWhere(groups)).toEqual({
      sql: '((instr(sc.filename, ?) > 0) AND NOT (instr(sc.tags, ?) > 0))',
      params: ['café', 'warm'],
    });
    expect(buildCatalogContextualSearchWhere(groups, true)).toEqual({
      sql: '((instr(a.relative_file_path, ?) > 0) AND NOT (0))',
      params: ['café'],
    });
    const rank = buildCatalogContextualSearchRank(groups);
    expect(rank.sql).toContain('WHEN sc.filename = ? THEN 0');
    expect(rank.sql).not.toContain('sc.tags =');
    expect(rank.params).toEqual(['café', 'café', 'café']);
  });

  it('preserves numeric NULL filters, format expansion, tag layers, and empty-value flags', () => {
    const result = buildCatalogFilterWhere([
      { field: 'width', ranges: [{ min: 1920 }, { max: 640 }], exclude: true },
      { field: 'format', values: ['text'], exclude: false },
      { field: 'tag', values: ['warm', 'soft'], exclude: true },
      { field: 'favorite', values: [], exclude: false },
      { field: 'source_url', values: [], exclude: true },
    ]);

    expect(result.sql).toContain('COALESCE(duration_meta.width, technical_thumbnail.width) IS NULL OR NOT');
    expect(result.sql).toContain('human_asset_tags');
    expect(result.sql).toContain('ai_asset_tags');
    expect(result.sql).toContain('COALESCE(m.favorite, 0) = 1');
    expect(result.sql).toContain('NOT (m.source_page_url IS NOT NULL AND m.source_page_url != \'\')');
    expect(result.params).toEqual([
      1920,
      640,
      ...TEXT_EXTENSIONS.map((extension) => `%.${extension.slice(1)}`),
      'warm', 'warm', 'soft', 'soft',
    ]);
  });

  it('matches unrecognized extensions for the unknown format token', () => {
    const result = buildCatalogFilterWhere([
      { field: 'format', values: [FORMAT_UNKNOWN_TOKEN], exclude: false },
    ]);
    const known = knownProductFormatExtensionsDotless();
    expect(result.sql).toContain('NOT (');
    expect(result.params).toEqual(known.map((extension) => `%.${extension}`));
    expect(result.params).toContain('%.png');
    expect(result.params).toContain('%.pdf');
    expect(result.params).not.toContain('%.hdf');
    expect(result.sql.match(/\?/g)).toHaveLength(result.params.length);
  });

  it('keeps resolution buckets to pixel media (Serpent-b1b0f2)', () => {
    const result = buildCatalogFilterWhere([
      { field: 'long_edge', ranges: [{ min: 2240, max: 4480 }], exclude: false },
    ]);

    // Only image/video extensions reach the long-edge range: a 3D model's
    // bounding box or a document page size must not land in a 1K/2K/4K bucket.
    expect(result.sql).toContain('LOWER(a.relative_file_path) LIKE ?');
    expect(result.sql).toContain('NULLIF(MAX(COALESCE(COALESCE(duration_meta.width');
    expect(result.sql).not.toContain('CASE WHEN (LOWER');
    const extensionParams = result.params.slice(0, result.params.length - 2);
    expect(extensionParams).toContain('%.png');
    expect(extensionParams).toContain('%.gif');
    expect(extensionParams).toContain('%.arw');
    expect(extensionParams).toContain('%.mov');
    expect(extensionParams).not.toContain('%.fbx');
    expect(extensionParams).not.toContain('%.pdf');
    expect(result.params.slice(-2)).toEqual([2240, 4480]);
    // Every placeholder is bound exactly once.
    expect(result.sql.match(/\?/g)).toHaveLength(result.params.length);

    // Other dimension filters keep their plain expression and no media gate.
    const widthFilter = buildCatalogFilterWhere([
      { field: 'width', ranges: [{ min: 100 }], exclude: false },
    ]);
    expect(widthFilter.sql).not.toContain('LOWER(a.relative_file_path)');
    expect(widthFilter.params).toEqual([100]);
  });

  it('keeps folder and collection recursion SQL-only and checks missing scopes', () => {
    const missingCollection = readConnection({ getResults: [undefined] });
    expect(buildCatalogCollectionScope(missingCollection.connection, {
      libraryId: 'library', collectionId: 'missing', recursive: true,
    })).toEqual({ status: 'missing' });

    const recursiveCollection = readConnection({
      getResults: [{ collection_id: 'collection' }, { collection_id: 'child' }],
    });
    const collection = buildCatalogCollectionScope(recursiveCollection.connection, {
      libraryId: 'library', collectionId: 'collection', recursive: true,
    });
    expect(collection.status).toBe('ready');
    if (collection.status === 'ready') {
      expect(collection.scope.queryPrefix).toContain('WITH RECURSIVE collection_descendants');
      expect(collection.scope.queryPrefix).toContain('MIN(ca.position) AS collection_position');
      expect(collection.scope.params).toEqual(['collection', 'library', 'library']);
    }
    const leafCollection = readConnection({
      getResults: [{ collection_id: 'leaf' }, undefined],
    });
    const leaf = buildCatalogCollectionScope(leafCollection.connection, {
      libraryId: 'library', collectionId: 'leaf', recursive: true,
    });
    expect(leaf).toMatchObject({
      status: 'ready',
      scope: { queryPrefix: expect.not.stringContaining('WITH RECURSIVE'), params: ['leaf'] },
    });

    const managed = readConnection({ getResults: [{ folder_id: 'folder' }] });
    const managedScope = buildCatalogFolderScopeClause(managed.connection, {
      libraryId: 'library',
      scope: { kind: 'folder', folderId: 'folder', recursive: true },
    });
    expect(managedScope).toEqual({
      status: 'ready',
      sql: expect.stringContaining('WITH RECURSIVE descendants(folder_id)'),
      params: ['folder'],
    });

    const linkedFolderId = encodeLinkedVirtualFolderId('linked', 'shots/day_1');
    const linked = readConnection({ getResults: [undefined, { folder_id: 'linked' }] });
    const linkedScope = buildCatalogFolderScopeClause(linked.connection, {
      libraryId: 'library',
      scope: { kind: 'folder', folderId: linkedFolderId, recursive: false },
    });
    expect(linkedScope).toEqual({
      status: 'ready',
      sql: expect.stringContaining("LIKE ? ESCAPE '\\'"),
      params: ['linked', 'shots/day\\_1/%', 'shots/day_1'.length + 2],
    });
    expect(linked.calls.map((call) => call.method)).toEqual(['get', 'get']);

    const recursiveLinked = readConnection({ getResults: [undefined, { folder_id: 'linked' }] });
    expect(buildCatalogFolderScopeClause(recursiveLinked.connection, {
      libraryId: 'library',
      scope: { kind: 'folder', folderId: linkedFolderId, recursive: true },
    })).toEqual({
      status: 'ready',
      sql: expect.stringContaining('substr(a.relative_file_path, 1, ?) = ?'),
      params: ['linked', 'shots/day_1', 'shots/day_1/'.length, 'shots/day_1/'],
    });

    const missingFolder = readConnection({ getResults: [undefined, undefined] });
    expect(buildCatalogFolderScopeClause(missingFolder.connection, {
      libraryId: 'library',
      scope: { kind: 'folder', folderId: linkedFolderId, recursive: true },
    })).toEqual({ status: 'missing' });
  });

  it('keeps ignore, sequence-fold, and deterministic NULL/tie-break browse semantics', () => {
    const ignore = buildCatalogExplicitIgnoreSql({
      alias: 'assets',
      hasExplicitIgnorePaths: true,
      hasGitignoreIgnoredPaths: true,
    });
    expect(ignore).toContain('explicit_ignored_paths');
    expect(ignore).toContain('gitignore_ignored_paths');
    const predicates = buildCatalogAssetVisibilityPredicates({
      scopeKind: 'all',
      explicitIgnoreSql: ignore,
      hasLinkedIgnoredAssets: true,
      hasSequenceFrames: true,
    });
    expect(predicates).toHaveLength(4);
    const navigation = readConnection({ getResults: [{ total: 42 }] });
    expect(countCatalogNavigationAssets(navigation.connection, {
      scope: 'root',
      showIgnored: false,
      explicitIgnoreSql: ignore,
      hasLinkedIgnoredAssets: true,
      hasSequenceFrames: true,
    })).toBe(42);
    expect(navigation.calls[0]?.sql).toContain("a.location_kind = 'managed' AND a.managed_folder_id IS NULL");

    const order = buildCatalogSortOrder({
      hasPositiveQuery: false,
      searchGroups: [],
      hasSearchIndex: false,
      sort: { field: 'duration', order: 'desc' },
      revisionColumns: new Set(),
      metadataColumns: new Set(),
      artifactColumns: new Set(['duration_ms']),
      hasAiContent: false,
      sessionMode: false,
      collectionScoped: false,
      trashScope: false,
    });
    expect(order.sql).toBe('duration_meta.duration_ms IS NULL ASC, duration_meta.duration_ms DESC, a.asset_id ASC');

    const assets = [
      summary('primary', 'shot.0001.png'),
      summary('frame-2', 'shot.0002.png', 2),
      summary('frame-3', 'shot.0003.png', 3),
      summary('unrelated', 'still.png', 7),
    ];
    const folded = foldCatalogImageSequenceSummaries({
      assets,
      memberships: [
        { asset_id: 'primary', sequence_id: 'sequence', position: 0 },
        { asset_id: 'frame-2', sequence_id: 'sequence', position: 1 },
        { asset_id: 'frame-3', sequence_id: 'sequence', position: 2 },
      ],
      frameRows: [
        { sequence_id: 'sequence', primary_asset_id: 'primary', fps: 24, asset_id: 'primary', frame_number: 1, position: 0, relative_file_path: 'shot.0001.png', current_revision_id: 'r1', availability: 'available', deleted_at: null, byte_size: 1, source_width: 1, source_height: 1 },
        { sequence_id: 'sequence', primary_asset_id: 'primary', fps: 24, asset_id: 'frame-2', frame_number: 2, position: 1, relative_file_path: 'shot.0002.png', current_revision_id: 'r2', availability: 'available', deleted_at: null, byte_size: 2, source_width: 1, source_height: 1 },
        { sequence_id: 'sequence', primary_asset_id: 'primary', fps: 24, asset_id: 'frame-3', frame_number: 3, position: 2, relative_file_path: 'shot.0003.png', current_revision_id: 'r3', availability: 'available', deleted_at: null, byte_size: 3, source_width: 1, source_height: 1 },
      ],
      artifacts: new Map([['frame-2', { status: 'ready', artifactId: 'thumbnail-2', width: null, height: null, durationMs: null }]]),
    });
    expect(folded.map((asset) => asset.assetId)).toEqual(['primary', 'unrelated']);
    expect(folded[0]).toMatchObject({
      displayName: 'shot.0001~0003',
      byteSize: 6,
      sequence: { sequenceId: 'sequence', fps: 24, frameCount: 3 },
    });
    expect(folded[0]!.sequence?.frames[1]).toMatchObject({
      assetId: 'frame-2',
      thumbnailArtifactId: 'thumbnail-2',
      previewKind: 'source',
    });
  });

  it('audits every prepared statement across the catalog query entry points', () => {
    const { connection, calls, preparedSqls } = readConnection({
      getResults: [
        { total: 42 },
        { collection_id: 'collection' },
        { collection_id: 'child' },
        { folder_id: 'managed' },
        undefined,
        { folder_id: 'linked' },
        undefined,
      ],
      allResults: [[]],
    });

    expect(countCatalogNavigationAssets(connection, {
      scope: 'all',
      showIgnored: false,
      explicitIgnoreSql: '0',
      hasLinkedIgnoredAssets: true,
      hasSequenceFrames: true,
    })).toBe(42);
    const collectionScope = buildCatalogCollectionScope(connection, {
      libraryId: 'library',
      collectionId: 'collection',
      recursive: true,
    });
    expect(collectionScope.status).toBe('ready');
    if (collectionScope.status === 'ready') {
      expect(collectionScope.scope.queryPrefix).toContain('WITH RECURSIVE');
    }
    expect(buildCatalogFolderScopeClause(connection, {
      libraryId: 'library',
      scope: { kind: 'folder', folderId: 'managed', recursive: true },
    }).status).toBe('ready');
    expect(buildCatalogFolderScopeClause(connection, {
      libraryId: 'library',
      scope: {
        kind: 'folder',
        folderId: encodeLinkedVirtualFolderId('linked', 'shots'),
        recursive: true,
      },
    }).status).toBe('ready');
    readCatalogThumbnailArtifacts(connection, ['asset']);
    expect(readCatalogArtifactDescriptor(connection, {
      revisionId: 'revision',
      kind: 'thumbnail',
      selectedColumns: ['artifact_id', 'file_path', 'status'],
      hasInvalidatedAt: true,
    })).toBeNull();

    // Current catalog prepare sites: navigation count (1), collection scope
    // (2), managed/linked folder resolution (3), thumbnail read (1), descriptor
    // read (1). Recording at prepare() ensures all executed SQL is audited,
    // independently of whether the returned statement uses all() or get().
    expect(preparedSqls).toHaveLength(8);
    expect(calls).toHaveLength(preparedSqls.length);
    expectOnlyReadCatalogStatements(preparedSqls);
  });

  it('maps summaries/layout rows without losing NULL values or source preview rules', () => {
    const mapped = catalogAssetSummaryFromRow({
      asset_id: 'asset',
      location_kind: 'managed',
      managed_folder_id: null,
      linked_folder_id: null,
      relative_file_path: 'still.png',
      current_revision_id: 'revision',
      availability: 'available',
      byte_size: 20,
      modified_at: '2026-09-14T00:00:00.000Z',
      rating: 0,
      favorite: 0,
      artifact_width: 0,
      artifact_height: null,
    }, 0);
    expect(mapped).toMatchObject({ displayName: 'still.png', width: null, height: null });
    expect(mapped).not.toHaveProperty('previewKind');
    expect(catalogAssetSummaryFromRow({
      asset_id: 'direct',
      location_kind: 'managed',
      managed_folder_id: null,
      relative_file_path: 'small.png',
      current_revision_id: 'revision-direct',
      availability: 'available',
      byte_size: 20,
      modified_at: '2026-09-14T00:00:00.000Z',
      rating: 0,
      favorite: 0,
      media_type: 'image',
      artifact_width: 20,
      artifact_height: 20,
    }, 0)).toMatchObject({ previewKind: 'source', previewRevisionId: 'revision-direct' });

    expect(catalogBrowseLayoutEntryFromRow({
      asset_id: 'layout',
      relative_file_path: 'still.png',
      layout_width: null,
      layout_height: null,
      layout_availability: 'missing',
      layout_preview_artifact_id: null,
    }, 'image')).toMatchObject({
      assetId: 'layout',
      width: null,
      height: null,
      previewArtifactId: null,
      displayName: 'still.png',
    });

    const zeroSizeLayout = catalogBrowseLayoutEntryFromRow({
      asset_id: 'zero-size',
      relative_file_path: 'blank.png',
      layout_width: 0,
      layout_height: 0,
      layout_availability: 'available',
      layout_byte_size: 12,
      layout_preview_artifact_id: null,
    }, 'image');
    expect(zeroSizeLayout).toMatchObject({ width: null, height: null });
    expect(browseLayoutEntrySchema.parse(zeroSizeLayout).width).toBeNull();
    expect(catalogBrowseLayoutEntryFromRow({
      asset_id: 'fraction',
      relative_file_path: 'odd.png',
      layout_width: 1.5,
      layout_height: -3,
    }, 'image')).toMatchObject({ width: null, height: null });
  });

  it('reads artifact rows in bounded SELECT-only chunks without statement write methods', () => {
    const { connection, calls } = readConnection({
      allResults: [[{
        asset_id: 'asset-0',
        thumbnail_status: 'generating',
        thumbnail_artifact_id: 'pending-id',
        artifact_width: 800,
        artifact_height: 600,
        artifact_duration_ms: null,
      }], []],
    });
    const ids = Array.from({ length: 901 }, (_, index) => `asset-${index}`);
    const artifacts = readCatalogThumbnailArtifacts(connection, ids);

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.method)).toEqual(['all', 'all']);
    expect(calls.map((call) => call.parameters.length)).toEqual([900, 1]);
    expect(calls.every((call) => /^\s*SELECT\b/iu.test(call.sql))).toBe(true);
    expect(calls.every((call) => !/\b(?:CREATE|INSERT|UPDATE|DELETE|DROP|PRAGMA|ATTACH|DETACH)\b/iu.test(call.sql))).toBe(true);
    expect(artifacts.get('asset-0')).toEqual({
      status: 'pending',
      artifactId: null,
      width: 800,
      height: 600,
      durationMs: null,
    });
  });

  it('selects the latest descriptor deterministically and binds generator identity', () => {
    const { connection, calls } = readConnection({
      getResults: [{
        artifact_id: 'artifact',
        file_path: 'artifacts/preview.png',
        mime_type: 'image/png',
        generator_version: 'v2',
        artifact_role: null,
        generator_id: null,
        settings_hash: null,
        artifact_key: null,
        status: 'ready',
        error_code: null,
        width: null,
        height: null,
        generated_at: '2026-09-14T00:00:00.000Z',
      }],
    });
    const descriptor = readCatalogArtifactDescriptor(connection, {
      revisionId: 'revision',
      kind: 'thumbnail',
      selectedColumns: ['artifact_id', 'file_path', 'mime_type', 'generator_version', 'status', 'generated_at'],
      hasInvalidatedAt: true,
      expectedGeneratorVersion: 'v2',
    });
    expect(descriptor).toMatchObject({ artifactId: 'artifact', status: 'ready', width: null, height: null });
    expect(calls[0]).toMatchObject({
      method: 'get',
      parameters: ['revision', 'thumbnail', 'v2'],
    });
    expect(calls[0]?.sql).toContain('invalidated_at IS NULL');
    expect(calls[0]?.sql).toContain('ORDER BY generated_at DESC, artifact_id DESC');
  });
});
