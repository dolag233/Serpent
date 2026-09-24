import path from 'node:path';

import type { AssetSummary, BrowseLayoutEntry, FilterClause, SearchScope, SortDefinition } from '../shared/asset-types';
import { parseLinkedVirtualFolderId } from '../shared/linked-folder-tree';
import { colorFilterSql, parseColorFilterValues } from '../shared/color-filter-presets';
import { knownProductFormatExtensionsDotless } from '../shared/product-format-extensions';
import {
  expandFormatFilterTokens,
  formatFilterHasUnknownToken,
} from '../shared/text-media';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../shared/media-formats';
import { isSourceDirectPreview } from '../shared/preview-policy';
import {
  formatImageSequenceDisplayName,
  parseImageSequenceFileName,
} from '../shared/image-sequence';
import {
  buildTrigramFts5Query,
  canUseTrigramSearch,
  normalizeSearchText,
  type SearchClause,
} from './search-query';
import { sqliteAllInChunks } from './sqlite-in';

/**
 * Narrow statement-method capability for the catalog query core. It excludes
 * exec/pragma/transaction/backup and statement.run, but is not a read-only
 * SQLite guarantee: `prepare(sql).all/get()` can still execute DML with
 * RETURNING, and the underlying connection may be writable. The query text
 * authored here is separately exercised by the catalog read audit test; a
 * dedicated read-only SQLite handle remains an owner/connection concern.
 */
export interface CatalogReadStatement {
  all(...parameters: unknown[]): unknown[];
  get(...parameters: unknown[]): unknown;
}

export interface CatalogReadConnection {
  prepare(sql: string): CatalogReadStatement;
}

export type CatalogSearchGroup = SearchClause[];

const SEARCH_INDEX_FIELDS = [
  'filename',
  'tags',
  'description',
  'source_url',
  'author',
  'folder_path',
  'metadata_text',
] as const;
type SearchIndexField = (typeof SEARCH_INDEX_FIELDS)[number];

export function normalizedCatalogSearchGroups(query: {
  clauses: SearchClause[];
  groups?: CatalogSearchGroup[];
}): CatalogSearchGroup[] {
  if (query.groups && query.groups.length > 0) return query.groups;
  return query.clauses.length > 0 ? [query.clauses] : [];
}

export function hasPositiveCatalogSearchClause(groups: CatalogSearchGroup[]): boolean {
  return groups.some((group) => group.some((clause) => !clause.exclude));
}

export function catalogFtsCanNarrowSearchGroups(groups: CatalogSearchGroup[]): boolean {
  return (
    groups.length > 0 &&
    groups.every((group) => group.some((clause) => !clause.exclude)) &&
    canUseTrigramSearch(groups)
  );
}

function searchFieldsForClause(field: string | null): readonly SearchIndexField[] {
  if (field === null) return SEARCH_INDEX_FIELDS;
  return SEARCH_INDEX_FIELDS.includes(field as SearchIndexField)
    ? [field as SearchIndexField]
    : [];
}

/** Exact, parameterized substring predicate used after FTS candidate lookup. */
export function buildCatalogContextualSearchWhere(
  groups: CatalogSearchGroup[],
  assetOnly = false,
): { sql: string; params: string[] } {
  const params: string[] = [];
  const groupExpressions: string[] = [];
  for (const group of groups) {
    const clauseExpressions: string[] = [];
    for (const clause of group) {
      const fields = searchFieldsForClause(clause.field);
      const normalizedValues = clause.values
        .map((value) => normalizeSearchText(value).trim())
        .filter(Boolean);
      if (fields.length === 0 || normalizedValues.length === 0) {
        clauseExpressions.push('0');
        continue;
      }
      const valueExpressions = normalizedValues.map((value) => {
        const fieldExpressions = fields
          .map((field) => {
            if (assetOnly) {
              if (field !== 'filename' && field !== 'folder_path') return null;
              params.push(value);
              return 'instr(a.relative_file_path, ?) > 0';
            }
            params.push(value);
            return `instr(sc.${field}, ?) > 0`;
          })
          .filter((expression): expression is string => expression !== null);
        if (fieldExpressions.length === 0) return '0';
        return fieldExpressions.length === 1
          ? fieldExpressions[0]!
          : `(${fieldExpressions.join(' OR ')})`;
      });
      const clauseExpression = valueExpressions.length === 1
        ? valueExpressions[0]!
        : `(${valueExpressions.join(' OR ')})`;
      clauseExpressions.push(
        clause.exclude ? `NOT (${clauseExpression})` : `(${clauseExpression})`,
      );
    }
    if (clauseExpressions.length > 0) {
      groupExpressions.push(`(${clauseExpressions.join(' AND ')})`);
    }
  }
  return {
    sql: groupExpressions.length === 0
      ? '0'
      : groupExpressions.length === 1
        ? groupExpressions[0]!
        : `(${groupExpressions.join(' OR ')})`,
    params,
  };
}

/** Exact/prefix/contains relevance, with filename/tag field priority. */
export function buildCatalogContextualSearchRank(groups: CatalogSearchGroup[]): {
  sql: string;
  params: string[];
} {
  const params: string[] = [];
  const termRanks: string[] = [];
  for (const clause of groups.flat()) {
    if (clause.exclude) continue;
    const fields = searchFieldsForClause(clause.field);
    for (const rawValue of clause.values) {
      const value = normalizeSearchText(rawValue).trim();
      if (!value || fields.length === 0) continue;
      const fieldRanks = fields.map((field) => {
        const fieldPriority = SEARCH_INDEX_FIELDS.indexOf(field);
        params.push(value, value, value);
        return `CASE
          WHEN sc.${field} = ? THEN ${fieldPriority}
          WHEN instr(sc.${field}, ?) = 1 THEN ${10 + fieldPriority}
          WHEN instr(sc.${field}, ?) > 0 THEN ${20 + fieldPriority}
          ELSE 99
        END`;
      });
      termRanks.push(fieldRanks.length === 1
        ? fieldRanks[0]!
        : `MIN(${fieldRanks.join(', ')})`);
    }
  }
  return {
    // An empty rank must not emit a bare numeric ORDER BY ordinal.
    sql: termRanks.length === 0
      ? ''
      : termRanks.length === 1
        ? termRanks[0]!
        : `MIN(${termRanks.join(', ')})`,
    params,
  };
}

export function buildCatalogFtsQuery(groups: CatalogSearchGroup[]): string {
  return buildTrigramFts5Query(groups);
}

export function isDefaultCatalogBrowseIndexRequest(input: {
  query?: { clauses: SearchClause[]; groups?: CatalogSearchGroup[] } | null;
  filters?: FilterClause[] | null;
  scope?: SearchScope | null;
  sort?: SortDefinition | null;
  scopeMode?: boolean | null;
  idsOnly?: boolean | null;
  showIgnored?: boolean;
}): boolean {
  return input.query == null
    && (input.filters?.length ?? 0) === 0
    && input.scope == null
    && input.sort == null
    && input.scopeMode !== true
    && input.idsOnly !== true
    && input.showIgnored !== true;
}

/**
 * Pixel media (image + video, GIF included) whose width/height is a real
 * resolution. Used by the resolution filter; keep in sync with `detectMediaType`
 * and the renderer's `mediaTypeHasPixelResolution` (Serpent-b1b0f2).
 */
const PIXEL_MEDIA_EXTENSIONS: readonly string[] = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
];

const PIXEL_MEDIA_EXTENSION_LIKES = PIXEL_MEDIA_EXTENSIONS
  .map(() => 'LOWER(a.relative_file_path) LIKE ?')
  .join(' OR ');

export function buildCatalogFilterWhere(
  filters: FilterClause[],
  options: { hasAiContent: boolean; hasAiAssetTags: boolean } = {
    hasAiContent: true,
    hasAiAssetTags: true,
  },
): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const filter of filters) {
    if ('ranges' in filter) {
      const width = 'COALESCE(duration_meta.width, technical_thumbnail.width)';
      const height = 'COALESCE(duration_meta.height, technical_thumbnail.height)';
      const column = filter.field === 'width'
        ? width
        : filter.field === 'height'
          ? height
          : filter.field === 'duration_ms'
            ? 'duration_meta.duration_ms'
            : filter.field === 'long_edge'
              // Resolution buckets read the longer edge of pixel media only.
              ? `NULLIF(MAX(COALESCE(${width}, 0), COALESCE(${height}, 0)), 0)`
              : `(CAST(${width} AS REAL) / NULLIF(${height}, 0))`;
      // Resolution buckets are pixel media only (Serpent-b1b0f2): a 3D model's
      // bounding box (or a document page size) must not land in a 1K/2K/4K
      // bucket. Media type is derived from the extension, so the gate mirrors
      // `detectMediaType`. It is a separate condition rather than a CASE around
      // the column: the range expression is emitted once per bound, and a
      // parameterized expression must not be inlined twice.
      const isResolutionFilter = filter.field === 'long_edge';
      const pixelMediaPredicate = `(${PIXEL_MEDIA_EXTENSION_LIKES})`;
      if (isResolutionFilter) {
        for (const extension of PIXEL_MEDIA_EXTENSIONS) {
          params.push(`%.${extension.slice(1)}`);
        }
      }
      const rangeClauses = filter.ranges.map((range) => {
        const bounds: string[] = [];
        if (range.min !== undefined) {
          bounds.push(`${column} >= ?`);
          params.push(range.min);
        }
        if (range.max !== undefined) {
          bounds.push(`${column} <= ?`);
          params.push(range.max);
        }
        return `(${bounds.join(' AND ')})`;
      });
      const matchesAnyRange = `(${rangeClauses.join(' OR ')})`;
      if (!isResolutionFilter) {
        conditions.push(filter.exclude
          ? `(${column} IS NULL OR NOT ${matchesAnyRange})`
          : matchesAnyRange);
        continue;
      }
      // Excluding a bucket keeps non-pixel media (they own no resolution at
      // all) and assets whose size was never measured - the same NULL rule the
      // other dimension filters use.
      conditions.push(filter.exclude
        ? `(NOT ${pixelMediaPredicate} OR ${column} IS NULL OR NOT ${matchesAnyRange})`
        : `(${pixelMediaPredicate} AND ${matchesAnyRange})`);
      continue;
    }
    if (filter.field === 'favorite') {
      conditions.push(filter.exclude
        ? '(COALESCE(m.favorite, 0) != 1)'
        : '(COALESCE(m.favorite, 0) = 1)');
      continue;
    }
    if (filter.field === 'source_url') {
      const hasUrl = '(m.source_page_url IS NOT NULL AND m.source_page_url != \'\')';
      conditions.push(filter.exclude ? `(NOT ${hasUrl})` : `(${hasUrl})`);
      continue;
    }
    if (filter.values.length === 0) continue;

    switch (filter.field) {
      case 'format': {
        const formatValues = expandFormatFilterTokens(filter.values);
        const wantsUnknown = formatFilterHasUnknownToken(filter.values);
        if (formatValues.length === 0 && !wantsUnknown) break;
        const parts: string[] = [];
        if (formatValues.length > 0) {
          const likes = formatValues.map(() => 'LOWER(a.relative_file_path) LIKE ?');
          parts.push(`(${likes.join(' OR ')})`);
          for (const value of formatValues) params.push(`%.${value.toLowerCase()}`);
        }
        if (wantsUnknown) {
          const known = knownProductFormatExtensionsDotless();
          const knownLikes = known.map(() => 'LOWER(a.relative_file_path) LIKE ?');
          parts.push(`NOT (${knownLikes.join(' OR ')})`);
          for (const value of known) params.push(`%.${value}`);
        }
        const combined = parts.join(' OR ');
        conditions.push(filter.exclude ? `NOT (${combined})` : `(${combined})`);
        break;
      }
      case 'tag': {
        const includeAi = filter.includeAi !== false && options.hasAiAssetTags;
        const taggedAssetsSubquery = (nameParamCount: number) => {
          const placeholders = Array.from({ length: nameParamCount }, () => '?').join(',');
          const human = `SELECT hat.asset_id FROM human_asset_tags hat
                      JOIN tags t ON t.tag_id = hat.tag_id
                      WHERE t.name COLLATE NOCASE IN (${placeholders})`;
          if (!includeAi) return human;
          return `${human}
                    UNION
                    SELECT aat.asset_id FROM ai_asset_tags aat
                      JOIN tags t ON t.tag_id = aat.tag_id
                      WHERE t.name COLLATE NOCASE IN (${placeholders})`;
        };
        if (filter.exclude && filter.values.length > 1) {
          conditions.push(`(${filter.values.map(() =>
            `a.asset_id NOT IN (${taggedAssetsSubquery(1)})`).join(' AND ')})`);
          for (const value of filter.values) {
            params.push(value);
            if (includeAi) params.push(value);
          }
        } else if (filter.exclude) {
          conditions.push(`(a.asset_id NOT IN (${taggedAssetsSubquery(1)}))`);
          params.push(filter.values[0]!);
          if (includeAi) params.push(filter.values[0]!);
        } else {
          conditions.push(`(a.asset_id IN (${taggedAssetsSubquery(filter.values.length)}))`);
          params.push(...filter.values);
          if (includeAi) params.push(...filter.values);
        }
        break;
      }
      case 'rating': {
        const placeholders = filter.values.map(() => '?').join(',');
        const aiRating = options.hasAiContent
          ? `(SELECT CAST(ac.value AS INTEGER) FROM ai_content ac
                 WHERE ac.asset_id = a.asset_id AND ac.field_name = 'rating'
                 ORDER BY ac.generated_at DESC, ac.ai_content_id DESC LIMIT 1)`
          : 'NULL';
        const effectiveRating = filter.includeAi === false
          ? 'COALESCE(m.rating, 0)'
          : `COALESCE(NULLIF(m.rating, 0), ${aiRating}, 0)`;
        conditions.push(`(${effectiveRating} ${filter.exclude ? 'NOT IN' : 'IN'} (${placeholders}))`);
        for (const value of filter.values) params.push(Number(value));
        break;
      }
      case 'availability': {
        const placeholders = filter.values.map(() => '?').join(',');
        conditions.push(`(a.availability ${filter.exclude ? 'NOT IN' : 'IN'} (${placeholders}))`);
        params.push(...filter.values);
        break;
      }
      case 'color': {
        const values = parseColorFilterValues(filter.values.join(','));
        const built = colorFilterSql({
          hueColumn: 'palette_meta.dominant_hue',
          saturationColumn: 'palette_meta.dominant_saturation',
          lightnessColumn: 'palette_meta.dominant_lightness',
          values,
          exclude: filter.exclude,
          similarity: filter.similarity,
          swatches: filter.swatches,
        });
        if (!built) {
          conditions.push('1 = 0');
          break;
        }
        conditions.push(built.sql);
        params.push(...built.params);
        break;
      }
      default:
        conditions.push('1 = 0');
    }
  }
  return { sql: conditions.length > 0 ? conditions.join(' AND ') : '', params };
}

export function buildCatalogExplicitIgnoreSql(input: {
  alias?: string;
  showIgnored?: boolean;
  hasExplicitIgnorePaths: boolean;
  hasGitignoreIgnoredPaths: boolean;
}): string {
  const alias = input.alias ?? 'a';
  if (input.showIgnored === true) return '1 = 1';
  if (!input.hasExplicitIgnorePaths || !input.hasGitignoreIgnoredPaths) return '1 = 1';
  return `NOT EXISTS (
      SELECT 1
        FROM explicit_ignored_paths ignored_path
       WHERE ignored_path.location_kind = ${alias}.location_kind
         AND ignored_path.linked_folder_id = COALESCE(${alias}.linked_folder_id, '')
         AND (
           (ignored_path.path_kind = 'asset' AND ignored_path.relative_path = ${alias}.relative_file_path)
           OR (ignored_path.path_kind = 'folder' AND (
             ignored_path.relative_path = ''
             OR ${alias}.relative_file_path = ignored_path.relative_path
             OR ${alias}.relative_file_path LIKE ignored_path.relative_path || '/%'
           ))
           OR (ignored_path.path_kind = 'extension' AND
             LOWER(${alias}.relative_file_path) LIKE '%.' || LOWER(ignored_path.relative_path))
         )
    )
    AND NOT EXISTS (
      SELECT 1
        FROM gitignore_ignored_paths gitignore_path
       WHERE ${alias}.location_kind = 'managed'
         AND (
           (gitignore_path.path_kind = 'asset' AND
             gitignore_path.relative_path = ${alias}.relative_file_path)
           OR (gitignore_path.path_kind = 'folder' AND (
             gitignore_path.relative_path = ''
             OR ${alias}.relative_file_path = gitignore_path.relative_path
             OR ${alias}.relative_file_path LIKE gitignore_path.relative_path || '/%'
           ))
         )
    )`;
}

export function buildCatalogAssetVisibilityPredicates(input: {
  scopeKind?: 'all' | 'root' | 'trash';
  showIgnored?: boolean;
  explicitIgnoreSql: string;
  hasLinkedIgnoredAssets: boolean;
  hasSequenceFrames: boolean;
}): string[] {
  const predicates = [input.scopeKind === 'trash'
    ? 'a.deleted_at IS NOT NULL'
    : 'a.deleted_at IS NULL'];
  if (input.scopeKind === 'root') {
    predicates.push("a.location_kind = 'managed' AND a.managed_folder_id IS NULL");
  }
  if (input.hasLinkedIgnoredAssets) {
    predicates.push('NOT EXISTS (SELECT 1 FROM linked_ignored_assets ignored WHERE ignored.asset_id = a.asset_id)');
  }
  predicates.push(input.showIgnored === true ? '1 = 1' : input.explicitIgnoreSql);
  if (input.hasSequenceFrames) {
    predicates.push(`NOT EXISTS (
        SELECT 1
          FROM asset_sequence_frames hidden_sequence_frame
         WHERE hidden_sequence_frame.asset_id = a.asset_id
           AND hidden_sequence_frame.position > 0
      )`);
  }
  return predicates;
}

export function countCatalogNavigationAssets(
  connection: CatalogReadConnection,
  input: {
    scope: 'all' | 'root' | 'trash';
    showIgnored: boolean;
    explicitIgnoreSql: string;
    hasLinkedIgnoredAssets: boolean;
    hasSequenceFrames: boolean;
  },
): number {
  const predicates = buildCatalogAssetVisibilityPredicates({
    scopeKind: input.scope,
    showIgnored: input.showIgnored,
    explicitIgnoreSql: input.explicitIgnoreSql,
    hasLinkedIgnoredAssets: input.hasLinkedIgnoredAssets,
    hasSequenceFrames: input.hasSequenceFrames,
  });
  const row = connection.prepare(
    `SELECT COUNT(*) AS total FROM assets a WHERE ${predicates.join(' AND ')}`,
  ).get() as { total: number };
  return row.total;
}

export interface CatalogCollectionScope {
  queryPrefix: string;
  join: string;
  params: unknown[];
}

export type CatalogCollectionScopeResult =
  | { status: 'ready'; scope: CatalogCollectionScope }
  | { status: 'missing' };

export function buildCatalogCollectionScope(
  connection: CatalogReadConnection,
  input: { libraryId: string; collectionId: string; recursive: boolean },
): CatalogCollectionScopeResult {
  const collection = connection.prepare(
    'SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?',
  ).get(input.collectionId, input.libraryId);
  if (!collection) return { status: 'missing' };
  if (input.recursive) {
    const hasChildren = connection.prepare(
      'SELECT 1 FROM collections WHERE parent_id = ? AND library_id = ? LIMIT 1',
    ).get(input.collectionId, input.libraryId);
    if (hasChildren) {
      return {
        status: 'ready',
        scope: {
          queryPrefix: `WITH RECURSIVE collection_descendants(collection_id) AS (
                SELECT collection_id FROM collections WHERE collection_id = ? AND library_id = ?
                UNION ALL
                SELECT child.collection_id FROM collections child
                  JOIN collection_descendants parent ON child.parent_id = parent.collection_id
                 WHERE child.library_id = ?
              ),
              collection_scope AS (
                SELECT ca.asset_id, MIN(ca.position) AS collection_position
                  FROM collection_assets ca
                  JOIN collection_descendants d ON d.collection_id = ca.collection_id
                 GROUP BY ca.asset_id
              ) `,
          join: 'JOIN collection_scope ON collection_scope.asset_id = a.asset_id',
          params: [input.collectionId, input.libraryId, input.libraryId],
        },
      };
    }
  }
  return {
    status: 'ready',
    scope: {
      queryPrefix: `WITH collection_scope AS (
                  SELECT asset_id, position AS collection_position
                    FROM collection_assets
                   WHERE collection_id = ?
                ) `,
      join: 'JOIN collection_scope ON collection_scope.asset_id = a.asset_id',
      params: [input.collectionId],
    },
  };
}

export type CatalogFolderScopeClauseResult =
  | { status: 'ready'; sql: string; params: unknown[] }
  | { status: 'missing' };

/** Resolve and compile managed/linked folder scopes without reading paths. */
export function buildCatalogFolderScopeClause(
  connection: CatalogReadConnection,
  input: { libraryId: string; scope: Extract<SearchScope, { kind: 'folder' }> },
): CatalogFolderScopeClauseResult {
  const { folderId, recursive } = input.scope;
  if (folderId === null) {
    return {
      status: 'ready',
      sql: recursive
        ? "a.location_kind = 'managed'"
        : "a.location_kind = 'managed' AND a.managed_folder_id IS NULL",
      params: [],
    };
  }

  const managed = connection.prepare(
    'SELECT folder_id FROM managed_folders WHERE folder_id = ?',
  ).get(folderId);
  if (managed) {
    return recursive
      ? {
          status: 'ready',
          sql: `a.managed_folder_id IN (
              WITH RECURSIVE descendants(folder_id) AS (
                SELECT folder_id FROM managed_folders WHERE folder_id = ?
                UNION ALL
                SELECT child.folder_id FROM managed_folders child
                  JOIN descendants parent ON child.parent_folder_id = parent.folder_id
              )
              SELECT folder_id FROM descendants
            )`,
          params: [folderId],
        }
      : { status: 'ready', sql: 'a.managed_folder_id = ?', params: [folderId] };
  }

  const virtual = parseLinkedVirtualFolderId(folderId);
  const linkedFolderId = virtual?.linkedFolderId ?? folderId;
  const relativePath = virtual?.relativePath ?? '';
  // Preserve the existing rule that an encoded empty virtual path is not a
  // real linked folder scope; the real linked root uses its native folder id.
  if (virtual && relativePath === '') return { status: 'missing' };
  const linked = connection.prepare(
    'SELECT folder_id FROM linked_folders WHERE folder_id = ? AND library_id = ?',
  ).get(linkedFolderId, input.libraryId);
  if (!linked) return { status: 'missing' };

  const predicates = ['a.linked_folder_id = ?'];
  const params: unknown[] = [linkedFolderId];
  if (!recursive) {
    if (relativePath === '') {
      predicates.push("instr(a.relative_file_path, '/') = 0");
    } else {
      const escaped = relativePath
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
      predicates.push("a.relative_file_path LIKE ? ESCAPE '\\' AND instr(substr(a.relative_file_path, ?), '/') = 0");
      params.push(`${escaped}/%`, relativePath.length + 2);
    }
  } else if (relativePath !== '') {
    const prefix = `${relativePath}/`;
    predicates.push('(a.relative_file_path = ? OR substr(a.relative_file_path, 1, ?) = ?)');
    params.push(relativePath, [...prefix].length, prefix);
  }
  return { status: 'ready', sql: predicates.join(' AND '), params };
}

export function buildCatalogSortOrder(input: {
  hasPositiveQuery: boolean;
  searchGroups: CatalogSearchGroup[];
  hasSearchIndex: boolean;
  sort?: SortDefinition | null;
  revisionColumns: ReadonlySet<string>;
  metadataColumns: ReadonlySet<string>;
  artifactColumns: ReadonlySet<string>;
  hasAiContent: boolean;
  sessionMode: boolean;
  collectionScoped: boolean;
  trashScope: boolean;
}): { sql: string; params: unknown[] } {
  const defaultNameSort = 'a.relative_file_path ASC, a.asset_id ASC';
  if (input.hasPositiveQuery && !input.sort) {
    const relevance = input.hasSearchIndex
      ? buildCatalogContextualSearchRank(input.searchGroups)
      : { sql: '', params: [] };
    return relevance.sql
      ? { sql: `${relevance.sql} ASC, a.relative_file_path ASC, a.asset_id ASC`, params: relevance.params }
      : { sql: defaultNameSort, params: [] };
  }
  if (input.sort) {
    const field = input.sort.field;
    const direction = input.sort.order === 'desc' ? 'DESC' : 'ASC';
    const sortable = {
      modified_at: input.revisionColumns.has('modified_at'),
      byte_size: input.revisionColumns.has('byte_size'),
      rating: input.metadataColumns.has('rating'),
      author: input.metadataColumns.has('author'),
      duration: input.artifactColumns.has('duration_ms'),
      long_edge: input.artifactColumns.has('width') && input.artifactColumns.has('height'),
      color: input.artifactColumns.has('dominant_hue') && input.artifactColumns.has('dominant_lightness'),
    };
    switch (field) {
      case 'name': return { sql: `a.relative_file_path ${direction}, a.asset_id ASC`, params: [] };
      case 'modified_at': return { sql: sortable.modified_at ? `r.modified_at ${direction}, a.asset_id ASC` : defaultNameSort, params: [] };
      case 'created_at': return { sql: `a.created_at ${direction}, a.asset_id ASC`, params: [] };
      case 'byte_size': return { sql: sortable.byte_size ? `r.byte_size ${direction}, a.asset_id ASC` : defaultNameSort, params: [] };
      case 'long_edge': {
        if (!sortable.long_edge) return { sql: defaultNameSort, params: [] };
        const width = 'COALESCE(duration_meta.width, technical_thumbnail.width)';
        const height = 'COALESCE(duration_meta.height, technical_thumbnail.height)';
        const edge = `NULLIF(MAX(COALESCE(${width}, 0), COALESCE(${height}, 0)), 0)`;
        return { sql: `${edge} IS NULL ASC, ${edge} ${direction}, a.asset_id ASC`, params: [] };
      }
      case 'duration': return { sql: sortable.duration ? `duration_meta.duration_ms IS NULL ASC, duration_meta.duration_ms ${direction}, a.asset_id ASC` : defaultNameSort, params: [] };
      case 'rating': return {
        sql: sortable.rating
          ? `${input.hasAiContent
            ? `COALESCE(NULLIF(m.rating, 0), (SELECT CAST(ac.value AS INTEGER) FROM ai_content ac WHERE ac.asset_id = a.asset_id AND ac.field_name = 'rating' ORDER BY ac.generated_at DESC, ac.ai_content_id DESC LIMIT 1), 0)`
            : 'COALESCE(m.rating, 0)'} ${direction}, a.asset_id ASC`
          : defaultNameSort,
        params: [],
      };
      case 'author': return {
        sql: sortable.author
          ? `COALESCE(m.author, '') = '' ASC, COALESCE(m.author, '') COLLATE NOCASE ${direction}, a.asset_id ASC`
          : defaultNameSort,
        params: [],
      };
      case 'color': return {
        sql: sortable.color
          ? `palette_meta.dominant_hue IS NULL ASC,
               palette_meta.dominant_hue ${direction},
               palette_meta.dominant_lightness ${direction},
               a.asset_id ASC`
          : defaultNameSort,
        params: [],
      };
      default: return { sql: defaultNameSort, params: [] };
    }
  }
  if (input.sessionMode) return { sql: 'a.asset_id ASC', params: [] };
  if (input.collectionScoped) {
    return { sql: 'collection_scope.collection_position ASC, a.relative_file_path ASC, a.asset_id ASC', params: [] };
  }
  if (input.trashScope) return { sql: 'a.deleted_at DESC, a.asset_id ASC', params: [] };
  return { sql: defaultNameSort, params: [] };
}

export interface CatalogAssetSummaryRow {
  asset_id: string;
  location_kind: 'managed' | 'linked';
  managed_folder_id: string | null;
  linked_folder_id?: string | null;
  relative_file_path: string;
  current_revision_id: string;
  availability: 'available' | 'missing';
  byte_size: number;
  modified_at: string;
  rating: number;
  favorite: number;
  deleted_at?: string | null;
  trashed_from_relative_path?: string | null;
  trashed_from_tombstone_id?: string | null;
  thumbnail_status?: 'ready' | 'pending' | 'failed' | null;
  thumbnail_artifact_id?: string | null;
  media_type?: 'image' | 'video' | 'audio' | 'text' | 'model' | 'document' | 'font' | 'other' | null;
  artifact_width?: number | null;
  artifact_height?: number | null;
  artifact_duration_ms?: number | null;
}

/**
 * Pixel size for protocol fields that only accept a positive integer or null.
 * Zero, negative, and non-integer readings are unknown dimensions. Emitting
 * them makes the browse layout fail validation and the main process shut the
 * Library Worker down.
 */
function knownPixelDimension(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function catalogAssetSummaryFromRow(
  row: CatalogAssetSummaryRow,
  nowMs = Date.now(),
): AssetSummary {
  let remainingDays: number | null = null;
  if (row.deleted_at) {
    const deletedMs = new Date(row.deleted_at).getTime();
    const expiryMs = deletedMs + 30 * 24 * 60 * 60 * 1000;
    remainingDays = Math.max(0, Math.ceil((expiryMs - nowMs) / (24 * 60 * 60 * 1000)));
  }
  const mediaType = row.media_type ?? 'other';
  const width = knownPixelDimension(row.artifact_width);
  const height = knownPixelDimension(row.artifact_height);
  const sourceDirect = row.availability === 'available'
    && !row.deleted_at
    && isSourceDirectPreview({
      fileName: row.relative_file_path,
      mediaType,
      byteSize: row.byte_size,
      width,
      height,
    });
  return {
    assetId: row.asset_id,
    locationKind: row.location_kind,
    managedFolderId: row.managed_folder_id,
    linkedFolderId: row.linked_folder_id ?? null,
    relativeFilePath: row.relative_file_path,
    displayName: path.posix.basename(row.relative_file_path),
    currentRevisionId: row.current_revision_id,
    byteSize: row.byte_size,
    modifiedAt: row.modified_at,
    availability: row.availability,
    rating: row.rating,
    favorite: row.favorite !== 0,
    deletedAt: row.deleted_at ?? null,
    trashedFromPath: row.trashed_from_relative_path ?? null,
    trashedFromTombstoneId: row.trashed_from_tombstone_id ?? null,
    remainingDays,
    thumbnailStatus: row.thumbnail_status ?? null,
    thumbnailArtifactId: row.thumbnail_artifact_id ?? null,
    ...(sourceDirect ? { previewKind: 'source' as const, previewRevisionId: row.current_revision_id } : {}),
    mediaType,
    width,
    height,
    durationMs: row.artifact_duration_ms ?? null,
    sequence: null,
  };
}

export interface CatalogLayoutRow {
  asset_id: string;
  relative_file_path: string;
  layout_width?: number | null;
  layout_height?: number | null;
  layout_availability?: 'available' | 'missing' | null;
  layout_deleted_at?: string | null;
  layout_byte_size?: number | null;
  layout_modified_at?: string | null;
  layout_rating?: number | null;
  layout_preview_artifact_id?: string | null;
  layout_revision_id?: string | null;
}

export function catalogBrowseLayoutEntryFromRow(
  row: CatalogLayoutRow,
  mediaType: 'image' | 'video' | 'audio' | 'text' | 'model' | 'document' | 'font' | 'other',
): BrowseLayoutEntry {
  const width = knownPixelDimension(row.layout_width);
  const height = knownPixelDimension(row.layout_height);
  const sourceDirect = row.layout_availability === 'available'
    && !row.layout_deleted_at
    && isSourceDirectPreview({
      fileName: row.relative_file_path,
      mediaType,
      byteSize: row.layout_byte_size ?? 0,
      width,
      height,
    });
  const entry: Record<string, unknown> = {
    assetId: row.asset_id,
    width,
    height,
    previewArtifactId: row.layout_preview_artifact_id ?? null,
    displayName: path.posix.basename(row.relative_file_path),
    relativeFilePath: row.relative_file_path,
    mediaType,
  };
  if (sourceDirect) {
    entry.previewKind = 'source';
    entry.previewRevisionId = row.layout_revision_id ?? null;
  }
  if (row.layout_byte_size != null) entry.byteSize = row.layout_byte_size;
  if (row.layout_modified_at != null) entry.modifiedAt = row.layout_modified_at;
  if (row.layout_rating != null) entry.rating = row.layout_rating;
  return entry as BrowseLayoutEntry;
}

export interface CatalogThumbnailArtifact {
  status: 'ready' | 'pending' | 'failed' | null;
  artifactId: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface CatalogSequenceMembership {
  asset_id: string;
  position: number;
  sequence_id: string;
}

export interface CatalogSequenceFrameRow {
  sequence_id: string;
  primary_asset_id: string;
  fps: number;
  asset_id: string;
  frame_number: number;
  position: number;
  relative_file_path: string;
  current_revision_id: string;
  availability: 'available' | 'missing';
  deleted_at: string | null;
  byte_size: number;
  source_width: number | null;
  source_height: number | null;
}

/** Fold already-read membership/frame rows into visible summaries, with no I/O. */
export function foldCatalogImageSequenceSummaries(input: {
  assets: readonly AssetSummary[];
  memberships: readonly CatalogSequenceMembership[];
  frameRows: readonly CatalogSequenceFrameRow[];
  artifacts: ReadonlyMap<string, CatalogThumbnailArtifact>;
}): AssetSummary[] {
  const { assets, memberships, frameRows, artifacts } = input;
  if (assets.length === 0) return [];
  const hiddenIds = new Set(
    memberships.filter((membership) => membership.position > 0)
      .map((membership) => membership.asset_id),
  );
  const primaryMembershipIds = new Set(
    memberships.filter((membership) => membership.position === 0)
      .map((membership) => membership.asset_id),
  );
  const visible = assets.filter((asset) => !hiddenIds.has(asset.assetId));
  const primaryIds = new Set(
    visible.filter((asset) => primaryMembershipIds.has(asset.assetId))
      .map((asset) => asset.assetId),
  );
  if (primaryIds.size === 0) {
    return visible.map((asset) => ({ ...asset, sequence: null }));
  }

  const sequences = new Map<string, NonNullable<AssetSummary['sequence']>>();
  const sequenceByteSizes = new Map<string, number>();
  for (const row of frameRows) {
    if (!primaryIds.has(row.primary_asset_id)) continue;
    const current = sequences.get(row.primary_asset_id) ?? {
      sequenceId: row.sequence_id,
      fps: row.fps,
      frameCount: 0,
      frames: [],
    };
    current.frames.push({
      assetId: row.asset_id,
      displayName: path.posix.basename(row.relative_file_path),
      relativeFilePath: row.relative_file_path,
      currentRevisionId: row.current_revision_id,
      frameNumber: row.frame_number,
      thumbnailArtifactId: artifacts.get(row.asset_id)?.artifactId ?? null,
      ...(row.availability === 'available'
        && !row.deleted_at
        && isSourceDirectPreview({
          fileName: row.relative_file_path,
          mediaType: 'image',
          byteSize: row.byte_size,
          width: row.source_width,
          height: row.source_height,
        })
        ? {
            previewKind: 'source' as const,
            previewRevisionId: row.current_revision_id,
          }
        : {}),
    });
    current.frameCount = current.frames.length;
    sequences.set(row.primary_asset_id, current);
    sequenceByteSizes.set(
      row.primary_asset_id,
      (sequenceByteSizes.get(row.primary_asset_id) ?? 0) + row.byte_size,
    );
  }

  return visible.map((asset) => {
    const sequence = sequences.get(asset.assetId) ?? null;
    if (!sequence || sequence.frames.length === 0) {
      return { ...asset, sequence: null };
    }
    const first = sequence.frames[0]!;
    const last = sequence.frames.at(-1)!;
    const parsed = parseImageSequenceFileName(first.relativeFilePath);
    const displayName = parsed
      ? formatImageSequenceDisplayName({
          prefix: parsed.prefix,
          firstFrame: first.frameNumber,
          lastFrame: last.frameNumber,
          numberStyle: parsed.numberStyle,
          numericWidth: parsed.numericWidth,
        })
      : asset.displayName;
    return {
      ...asset,
      byteSize: sequenceByteSizes.get(asset.assetId) ?? asset.byteSize,
      displayName,
      sequence,
    };
  });
}

export function readCatalogThumbnailArtifacts(
  connection: CatalogReadConnection,
  assetIds: readonly string[],
): Map<string, CatalogThumbnailArtifact> {
  if (assetIds.length === 0) return new Map();
  const rows = sqliteAllInChunks<string, {
    asset_id: string;
    thumbnail_status: 'ready' | 'pending' | 'generating' | 'failed' | null;
    thumbnail_artifact_id: string | null;
    artifact_width: number | null;
    artifact_height: number | null;
    artifact_duration_ms: number | null;
  }>({
    connection,
    values: assetIds,
    buildSql: (placeholders) =>
      `SELECT a.asset_id, ra.status AS thumbnail_status,
              ra.artifact_id AS thumbnail_artifact_id,
              COALESCE(ra.width, video_meta.width) AS artifact_width,
              COALESCE(ra.height, video_meta.height) AS artifact_height,
              video_meta.duration_ms AS artifact_duration_ms
         FROM assets a
         LEFT JOIN revision_artifacts ra
           ON ra.revision_id = a.current_revision_id
          AND ra.kind = CASE
            WHEN LOWER(a.relative_file_path) LIKE '%.mp4'
              OR LOWER(a.relative_file_path) LIKE '%.webm'
              OR LOWER(a.relative_file_path) LIKE '%.mov'
              OR LOWER(a.relative_file_path) LIKE '%.avi'
              OR LOWER(a.relative_file_path) LIKE '%.wmv'
              OR LOWER(a.relative_file_path) LIKE '%.mkv'
              OR LOWER(a.relative_file_path) LIKE '%.m4v'
            THEN 'video_poster'
            ELSE 'thumbnail'
          END
          AND ra.invalidated_at IS NULL
         LEFT JOIN revision_artifacts video_meta
           ON video_meta.revision_id = a.current_revision_id
          AND video_meta.kind = 'extracted_metadata'
          AND video_meta.status = 'ready'
          AND video_meta.invalidated_at IS NULL
        WHERE a.asset_id IN (${placeholders})`,
  });
  const map = new Map<string, CatalogThumbnailArtifact>();
  for (const row of rows) {
    const status = row.thumbnail_status === 'ready' ? 'ready'
      : row.thumbnail_status === 'failed' ? 'failed'
        : row.thumbnail_status === 'generating' || row.thumbnail_status === 'pending' ? 'pending'
          : null;
    map.set(row.asset_id, {
      status,
      artifactId: status === 'ready' ? row.thumbnail_artifact_id : null,
      width: row.artifact_width,
      height: row.artifact_height,
      durationMs: row.artifact_duration_ms,
    });
  }
  return map;
}

export interface CatalogArtifactDescriptor {
  artifactId: string;
  filePath: string;
  mimeType: string;
  generatorVersion: string;
  artifactRole: string | null;
  generatorId: string | null;
  settingsHash: string | null;
  artifactKey: string | null;
  status: string;
  errorCode: string | null;
  width: number | null;
  height: number | null;
  generatedAt: string | null;
}

export function readCatalogArtifactDescriptor(
  connection: CatalogReadConnection,
  input: {
    revisionId: string;
    kind: string;
    selectedColumns: readonly string[];
    hasInvalidatedAt: boolean;
    expectedGeneratorVersion?: string;
  },
): CatalogArtifactDescriptor | null {
  if (input.selectedColumns.length === 0) return null;
  const expectedGeneratorClause = input.expectedGeneratorVersion === undefined
    ? ''
    : 'AND generator_version = ?';
  const row = connection.prepare(
    `SELECT ${input.selectedColumns.join(', ')}
       FROM revision_artifacts
      WHERE revision_id = ?
        AND kind = ?
        ${input.hasInvalidatedAt ? 'AND invalidated_at IS NULL' : ''}
        ${expectedGeneratorClause}
      ORDER BY generated_at DESC, artifact_id DESC
      LIMIT 1`,
  ).get(
    input.revisionId,
    input.kind,
    ...(input.expectedGeneratorVersion === undefined ? [] : [input.expectedGeneratorVersion]),
  ) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    artifactId: typeof row.artifact_id === 'string' ? row.artifact_id : '',
    filePath: typeof row.file_path === 'string' ? row.file_path : '',
    mimeType: typeof row.mime_type === 'string' ? row.mime_type : '',
    generatorVersion: typeof row.generator_version === 'string' ? row.generator_version : '',
    artifactRole: typeof row.artifact_role === 'string' ? row.artifact_role : null,
    generatorId: typeof row.generator_id === 'string' ? row.generator_id : null,
    settingsHash: typeof row.settings_hash === 'string' ? row.settings_hash : null,
    artifactKey: typeof row.artifact_key === 'string' ? row.artifact_key : null,
    status: typeof row.status === 'string' ? row.status : '',
    errorCode: typeof row.error_code === 'string' ? row.error_code : null,
    width: typeof row.width === 'number' ? row.width : null,
    height: typeof row.height === 'number' ? row.height : null,
    generatedAt: typeof row.generated_at === 'string' ? row.generated_at : null,
  };
}
