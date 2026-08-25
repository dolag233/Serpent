import BetterSqlite3 from 'better-sqlite3';
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type BigIntStats,
  type Dirent,
} from 'node:fs';
import path from 'node:path';

import { normalizeAbsolutePath } from './library-rules';
import { pathIsWithin } from './path-utils';

const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_LENGTH = 10_000;
const MAX_URL_LENGTH = 8_192;
const MAX_METADATA_ROWS = 250_000;

const IGNORED_DIRECTORIES = new Set([
  '.bf',
  '.recycle',
  '.recycle2',
  '.trash',
]);

export class BillfishLibraryReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BillfishLibraryReadError';
  }
}

export interface BillfishAssetMetadata {
  description: string | null;
  rating: number;
  sourcePageUrl: string | null;
  tags: string[];
  thumbnailPath: string | null;
}

export interface BillfishAssetCandidate {
  sourcePath: string;
  relativePath: string;
  byteSize: number;
  sourceModifiedAtMs: number;
  metadata: BillfishAssetMetadata | null;
}

export interface BillfishLibrarySnapshot {
  displayName: string;
  sourceRootPath: string;
  directories: string[];
  items: BillfishAssetCandidate[];
  skippedCount: number;
  metadataAvailable: boolean;
}

interface JsonObject {
  [key: string]: unknown;
}

interface MetadataIndex {
  byPath: Map<string, BillfishAssetMetadata>;
  byName: Map<string, BillfishAssetMetadata[]>;
  available: boolean;
}

interface BillfishDatabase {
  prepare(sql: string): { all(...parameters: unknown[]): unknown[] };
  close(): void;
}

const BillfishDatabase = BetterSqlite3 as unknown as {
  new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }): BillfishDatabase;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function ratingValue(value: unknown): number {
  const number = finiteNumber(value);
  if (number === undefined) return 0;
  return Math.max(0, Math.min(5, Math.trunc(number)));
}

function httpUrlValue(value: unknown): string | null {
  const candidate = textValue(value, MAX_URL_LENGTH);
  if (candidate === '') return null;
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username !== ''
      || parsed.password !== ''
    ) return null;
    return candidate;
  } catch {
    return null;
  }
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function stringArray(value: unknown): string[] {
  const parsed = parseJsonValue(value);
  const values = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'string'
      ? parsed.split(/[,，;；\n]/u)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    const text = textValue(item, 255);
    if (text === '' || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function firstValue(row: JsonObject, keys: readonly string[]): unknown {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [
    key.toLowerCase().replace(/[^a-z0-9]/gu, ''),
    value,
  ]));
  for (const key of keys) {
    const value = normalized.get(key.toLowerCase().replace(/[^a-z0-9]/gu, ''));
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function relativeIdentity(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '').toLocaleLowerCase();
}

function safeRelativePath(root: string, candidate: string): string | null {
  const normalized = candidate.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (normalized === '' || normalized.startsWith('../') || normalized.includes('/../')) return null;
  const absolute = path.isAbsolute(candidate)
    ? candidate
    : path.join(root, ...normalized.split('/'));
  try {
    const canonical = realpathSync(absolute);
    if (!pathIsWithin(root, canonical)) return null;
    return path.relative(root, canonical).split(path.sep).join('/');
  } catch {
    return null;
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`;
}

function findChildCaseInsensitive(directory: string, names: readonly string[]): string | null {
  try {
    const entries = readdirSync(directory, { withFileTypes: true });
    const wanted = new Set(names.map((name) => name.toLocaleLowerCase()));
    const entry = entries.find((candidate) => wanted.has(candidate.name.toLocaleLowerCase()));
    return entry ? path.join(directory, entry.name) : null;
  } catch {
    return null;
  }
}

function metadataFromRow(row: JsonObject): BillfishAssetMetadata {
  const description = textValue(
    firstValue(row, ['description', 'remark', 'note', 'memo', 'comment', 'desc']),
    MAX_TEXT_LENGTH,
  ) || null;
  const sourcePageUrl = httpUrlValue(
    firstValue(row, ['source_url', 'sourceUrl', 'origin_url', 'originUrl', 'origin', 'url', 'website']),
  );
  const tags = stringArray(firstValue(row, ['tags', 'tag', 'labels', 'keywords']));
  const thumbnailPath = textValue(
    firstValue(row, ['thumbnail', 'thumbnail_path', 'thumb', 'preview', 'preview_path', 'cover']),
    4_096,
  ) || null;
  return {
    description,
    rating: ratingValue(firstValue(row, ['rating', 'score', 'star', 'stars'])),
    sourcePageUrl,
    tags,
    thumbnailPath,
  };
}

function metadataPathValue(row: JsonObject): string | null {
  const value = firstValue(row, [
    'relative_path',
    'relativePath',
    'file_path',
    'filePath',
    'asset_path',
    'assetPath',
    'path',
    'filepath',
    'filename',
    'file_name',
    'fileName',
  ]);
  const text = textValue(value, 4_096);
  return text === '' ? null : text;
}

function readJsonMetadata(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const directories = [root, findChildCaseInsensitive(root, ['.bf'])].filter(
    (value): value is string => value !== null,
  );
  for (const directory of directories) {
    const candidate = findChildCaseInsensitive(directory, [
      'library.json',
      'config.json',
      'settings.json',
      'setting.json',
    ]);
    if (!candidate) continue;
    try {
      const stat = lstatSync(candidate, { bigint: true });
      if (!stat.isFile() || stat.size > BigInt(MAX_METADATA_BYTES)) continue;
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
      if (!isObject(parsed)) continue;
      for (const key of ['name', 'libraryName', 'library_name', 'title']) {
        const value = textValue(parsed[key], 255);
        if (value !== '') result.set('displayName', value);
      }
    } catch {
      // The filesystem import remains useful when optional metadata is damaged.
    }
  }
  return result;
}

function tableExists(tableNames: ReadonlySet<string>, name: string): boolean {
  return tableNames.has(name);
}

function safePathSegment(value: unknown): string | null {
  const text = textValue(value, 1_024);
  if (text === '' || text === '.' || text === '..' || text.includes('/') || text.includes('\\')) {
    return null;
  }
  return text;
}

/**
 * Billfish 3.x stores metadata across normalized tables (`bf_file`,
 * `bf_folder`, `bf_material_userdata`, `bf_tag_v2`, `bf_tag_join_file`) and
 * none of them carries a path column, so the generic single-table reader below
 * silently drops every note, rating, URL, and tag. Index those tables here.
 *
 * Exported `.BillfishPack` archives flatten asset files to the archive root
 * while the database still records the original folder hierarchy, so entries
 * are registered both by their database path and by file name; the caller
 * resolves flattened layouts through the by-name fallback.
 */
function readBillfish3Metadata(
  database: BillfishDatabase,
  tableNames: ReadonlySet<string>,
  byPath: Map<string, BillfishAssetMetadata>,
  byName: Map<string, BillfishAssetMetadata[]>,
): boolean {
  if (!tableExists(tableNames, 'bf_file')) return false;

  const folders = new Map<number, { pid: number; name: string }>();
  if (tableExists(tableNames, 'bf_folder')) {
    try {
      const rows = database.prepare('SELECT id, pid, name FROM bf_folder').all() as JsonObject[];
      for (const row of rows) {
        const id = finiteNumber(row.id);
        const pid = finiteNumber(row.pid);
        const name = safePathSegment(row.name);
        if (id === undefined || pid === undefined || name === null) continue;
        folders.set(id, { pid, name });
      }
    } catch {
      // Folder hierarchy is optional; files fall back to name-only entries.
    }
  }

  const userdata = new Map<number, { note: string; origin: string; score: unknown }>();
  if (tableExists(tableNames, 'bf_material_userdata')) {
    try {
      const rows = database
        .prepare('SELECT file_id, note, origin, score FROM bf_material_userdata')
        .all() as JsonObject[];
      for (const row of rows) {
        const fileId = finiteNumber(row.file_id);
        if (fileId === undefined) continue;
        userdata.set(fileId, {
          note: textValue(firstValue(row, ['note', 'comments_summary']), MAX_TEXT_LENGTH),
          origin: textValue(row.origin, MAX_URL_LENGTH),
          score: row.score,
        });
      }
    } catch {
      // Ratings/notes/URLs are optional metadata.
    }
  }

  const tagNameById = new Map<number, string>();
  const joinTable = tableExists(tableNames, 'bf_tag_join_file');
  const tagTable = tableExists(tableNames, 'bf_tag_v2')
    ? 'bf_tag_v2'
    : tableExists(tableNames, 'bf_tag')
      ? 'bf_tag'
      : null;
  if (tagTable) {
    try {
      const rows = database.prepare(`SELECT id, name FROM ${tagTable}`).all() as JsonObject[];
      for (const row of rows) {
        const id = finiteNumber(row.id);
        const name = textValue(row.name, 255);
        if (id === undefined || name === '') continue;
        tagNameById.set(id, name);
      }
    } catch {
      // Tags are optional metadata.
    }
  }
  const tagIdsByFile = new Map<number, Set<number>>();
  if (joinTable && tagNameById.size > 0) {
    try {
      const rows = database
        .prepare('SELECT file_id, tag_id FROM bf_tag_join_file')
        .all() as JsonObject[];
      for (const row of rows) {
        const fileId = finiteNumber(row.file_id);
        const tagId = finiteNumber(row.tag_id);
        if (fileId === undefined || tagId === undefined) continue;
        const tags = tagIdsByFile.get(fileId) ?? new Set<number>();
        tags.add(tagId);
        tagIdsByFile.set(fileId, tags);
      }
    } catch {
      // Tag joins are optional metadata.
    }
  }

  let files: JsonObject[];
  try {
    files = database
      .prepare(`SELECT id, name, pid FROM bf_file LIMIT ${MAX_METADATA_ROWS}`)
      .all() as JsonObject[];
  } catch {
    return false;
  }

  const seen = new Set<string>();
  for (const row of files) {
    const fileId = finiteNumber(row.id);
    const fileName = safePathSegment(row.name);
    if (fileId === undefined || fileName === null) continue;

    // Rebuild the recorded folder chain (pid 0 is the library root) without
    // requiring the chain to resolve: broken references degrade to a
    // root-level entry so the by-name fallback can still match.
    const segments: string[] = [];
    let current = finiteNumber(row.pid) ?? 0;
    let valid = true;
    for (let depth = 0; current !== 0; depth += 1) {
      if (depth >= 64) {
        valid = false;
        break;
      }
      const folder = folders.get(current);
      if (!folder) {
        valid = false;
        break;
      }
      segments.unshift(folder.name);
      current = folder.pid;
    }
    const relative = valid && segments.length > 0 ? [...segments, fileName].join('/') : fileName;

    const data = userdata.get(fileId);
    const tags: string[] = [];
    const tagIds = tagIdsByFile.get(fileId);
    if (tagIds) {
      for (const tagId of tagIds) {
        const name = tagNameById.get(tagId);
        if (name === undefined || tags.includes(name)) continue;
        tags.push(name);
      }
    }
    const metadata: BillfishAssetMetadata = {
      description: data && data.note !== '' ? data.note : null,
      rating: data ? ratingValue(data.score) : 0,
      sourcePageUrl: data ? httpUrlValue(data.origin) : null,
      tags,
      thumbnailPath: null,
    };
    if (!metadata.description && metadata.rating === 0 && !metadata.sourcePageUrl && tags.length === 0) {
      continue;
    }

    const key = relativeIdentity(relative);
    if (seen.has(key)) continue;
    seen.add(key);
    byPath.set(key, metadata);
    const name = fileName.toLocaleLowerCase();
    const sameName = byName.get(name) ?? [];
    sameName.push(metadata);
    byName.set(name, sameName);
  }
  return true;
}

function readDatabaseMetadata(root: string, databasePath: string): MetadataIndex {
  const byPath = new Map<string, BillfishAssetMetadata>();
  const byName = new Map<string, BillfishAssetMetadata[]>();
  let database: BillfishDatabase | undefined;
  try {
    database = new BillfishDatabase(databasePath, { readonly: true, fileMustExist: true });
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name?: unknown }>;
    const tableNames = new Set(
      tables
        .map((table) => textValue(table.name, 255).toLocaleLowerCase())
        .filter((name) => name !== ''),
    );
    if (readBillfish3Metadata(database, tableNames, byPath, byName)) {
      return { byPath, byName, available: true };
    }
    for (const table of tables.slice(0, 256)) {
      const tableName = textValue(table.name, 255);
      if (tableName === '') continue;
      let columns: Array<{ name?: unknown }>;
      try {
        columns = database
          .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
          .all() as Array<{ name?: unknown }>;
      } catch {
        continue;
      }
      const hasPathColumn = columns.some((column) => {
        const name = textValue(column.name, 255).toLowerCase().replace(/[^a-z0-9]/gu, '');
        return ['path', 'filepath', 'filename', 'relativepath', 'assetpath'].includes(name);
      });
      if (!hasPathColumn) continue;
      let rows: JsonObject[];
      try {
        rows = database
          .prepare(`SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ${MAX_METADATA_ROWS}`)
          .all() as JsonObject[];
      } catch {
        continue;
      }
      for (const row of rows) {
        const pathValue = metadataPathValue(row);
        if (!pathValue) continue;
        const relative = safeRelativePath(root, pathValue);
        if (!relative) continue;
        const metadata = metadataFromRow(row);
        const thumbnail = metadata.thumbnailPath
          ? safeRelativePath(root, metadata.thumbnailPath)
          : null;
        metadata.thumbnailPath = thumbnail ? path.join(root, ...thumbnail.split('/')) : null;
        const key = relativeIdentity(relative);
        byPath.set(key, metadata);
        const name = path.posix.basename(relative).toLocaleLowerCase();
        const sameName = byName.get(name) ?? [];
        sameName.push(metadata);
        byName.set(name, sameName);
      }
    }
    return { byPath, byName, available: true };
  } catch {
    return { byPath, byName, available: false };
  } finally {
    try {
      database?.close();
    } catch {
      // Best effort: read-only connection cleanup must not fail the import.
    }
  }
}

function readBillfishMetadata(root: string): {
  displayName: string | null;
  index: MetadataIndex;
} {
  const jsonMetadata = readJsonMetadata(root);
  const bfDirectory = findChildCaseInsensitive(root, ['.bf']);
  const databasePath = bfDirectory
    ? findChildCaseInsensitive(bfDirectory, ['billfish.db', 'billfish'])
    : null;
  const index = databasePath
    ? readDatabaseMetadata(root, databasePath)
    : { byPath: new Map(), byName: new Map(), available: false };
  return {
    displayName: jsonMetadata.get('displayName') ?? null,
    index,
  };
}

function metadataForCandidate(
  root: string,
  relativePath: string,
  index: MetadataIndex,
): BillfishAssetMetadata | null {
  const direct = index.byPath.get(relativeIdentity(relativePath));
  const matches = direct
    ? [direct]
    : index.byName.get(path.posix.basename(relativePath).toLocaleLowerCase()) ?? [];
  const metadata = matches.length === 1 ? matches[0] : direct;
  if (!metadata) return null;
  if (metadata.thumbnailPath) {
    const canonical = safeRelativePath(root, metadata.thumbnailPath);
    metadata.thumbnailPath = canonical
      ? path.join(root, ...canonical.split('/'))
      : null;
  }
  return metadata;
}

export function readBillfishLibrary(sourceRootPath: string): BillfishLibrarySnapshot {
  let root: string;
  try {
    root = realpathSync(normalizeAbsolutePath(sourceRootPath));
    const stat = lstatSync(root, { bigint: true });
    if (!stat.isDirectory()) throw new Error('Billfish root is not a directory.');
  } catch (error) {
    throw new BillfishLibraryReadError('Could not read the Billfish library folder.', { cause: error });
  }

  // A Billfish library is a normal folder plus the hidden first-level `.bf`
  // metadata directory. Requiring that marker prevents a generic asset folder
  // selected by mistake from being silently imported as a Billfish library;
  // the database itself remains optional so older/damaged libraries can still
  // contribute their readable files.
  const bfDirectory = findChildCaseInsensitive(root, ['.bf']);
  if (!bfDirectory) {
    throw new BillfishLibraryReadError(
      'The selected folder is not a Billfish library (.bf metadata directory is missing).',
    );
  }
  try {
    if (!lstatSync(bfDirectory, { bigint: true }).isDirectory()) {
      throw new Error('Billfish metadata marker is not a directory.');
    }
  } catch (error) {
    throw new BillfishLibraryReadError('Could not read the Billfish metadata directory.', {
      cause: error,
    });
  }

  const metadata = readBillfishMetadata(root);
  const directories = new Set<string>();
  const items: BillfishAssetCandidate[] = [];
  let skippedCount = 0;

  const visit = (directory: string, relativeDirectory: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    } catch (error) {
      throw new BillfishLibraryReadError(`Could not read Billfish directory: ${directory}`, { cause: error });
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        skippedCount += 1;
        continue;
      }
      const childPath = path.join(directory, entry.name);
      const childRelative = relativeDirectory === ''
        ? entry.name
        : path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name.toLocaleLowerCase())) continue;
        directories.add(childRelative);
        visit(childPath, childRelative);
        continue;
      }
      if (!entry.isFile()) {
        skippedCount += 1;
        continue;
      }
      try {
        const stat: BigIntStats = lstatSync(childPath, { bigint: true });
        if (stat.isSymbolicLink() || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) {
          skippedCount += 1;
          continue;
        }
        const canonical = realpathSync(childPath);
        if (!pathIsWithin(root, canonical)) {
          skippedCount += 1;
          continue;
        }
        const relativePath = childRelative.replace(/\\/gu, '/');
        items.push({
          sourcePath: childPath,
          relativePath,
          byteSize: Number(stat.size),
          sourceModifiedAtMs: Number(stat.mtimeMs),
          metadata: metadataForCandidate(root, relativePath, metadata.index),
        });
      } catch {
        skippedCount += 1;
      }
    }
  };

  visit(root, '');
  if (items.length === 0 && directories.size === 0) {
    throw new BillfishLibraryReadError('The selected folder does not contain Billfish assets.');
  }
  return {
    displayName: metadata.displayName ?? path.basename(root),
    sourceRootPath: root,
    directories: [...directories].sort(),
    items,
    skippedCount,
    metadataAvailable: metadata.index.available,
  };
}
