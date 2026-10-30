import BetterSqlite3 from 'better-sqlite3';
import {
  lstatSync,
  realpathSync,
  existsSync,
  type BigIntStats,
} from 'node:fs';
import path from 'node:path';

import { normalizeAbsolutePath } from './library-rules';
import { pathIsWithin } from './path-utils';

const MAX_TEXT_LENGTH = 10_000;
const MAX_TAG_LENGTH = 255;
const MAX_URL_LENGTH = 8_192;
const MAX_DATABASE_ROWS = 500_000;
const ACTIVE_LIBRARY_ROOT_ID = '1';
const TRASH_ROOT_ID = '2';

export class PixcallLibraryReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PixcallLibraryReadError';
  }
}

export interface PixcallAssetMetadata {
  author: string | null;
  description: string | null;
  rating: number;
  sourcePageUrl: string | null;
  tags: string[];
  thumbnailPath: null;
  exif?: Record<string, string | number | number[]>;
  width?: number;
  height?: number;
}

export interface PixcallAssetCandidate {
  sourcePath: string;
  relativePath: string;
  byteSize: number;
  sourceModifiedAtMs: number;
  metadata: PixcallAssetMetadata | null;
}

export interface PixcallLibrarySnapshot {
  displayName: string;
  sourceRootPath: string;
  directories: string[];
  folderOrder: Array<{ relativePath: string; position: number }>;
  items: PixcallAssetCandidate[];
  skippedCount: number;
  skippedItems: Array<{ relativePath: string; reason: 'unreadable' | 'unsafe' }>;
  metadataAvailable: boolean;
}

interface PixcallEntryRow {
  id: string;
  parentId: string;
  name: string;
  kind: number;
  ranking: string | null;
  description: string | null;
  link: string | null;
  tags: string | null;
  rating: number | null;
  metadata: string | null;
  isDeleted: number;
}

interface PixcallDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[];
  };
  close(): void;
}

interface JsonObject {
  [key: string]: unknown;
}

const PixcallDatabase = BetterSqlite3 as unknown as {
  new (
    filename: string,
    options?: { readonly?: boolean; fileMustExist?: boolean },
  ): PixcallDatabase;
};

function textValue(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

function safePathSegment(value: unknown): string | null {
  const text = textValue(value, 1_024);
  if (
    text === ''
    || text === '.'
    || text === '..'
    || text.includes('/')
    || text.includes('\\')
  ) {
    return null;
  }
  return text;
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

function positiveDimension(value: unknown): number | undefined {
  const number = finiteNumber(value);
  if (
    number === undefined
    || number < 1
    || number > 1_000_000
    || !Number.isSafeInteger(Math.trunc(number))
  ) {
    return undefined;
  }
  return Math.trunc(number);
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
    ) {
      return null;
    }
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

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tagIds(value: unknown): string[] {
  const parsed = parseJsonValue(value);
  const values = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'string'
      ? parsed
          .replace(/^\[/u, '')
          .replace(/\]$/u, '')
          .split(/[,;\s]+/u)
          .map((item) => item.replace(/^"|"$/gu, ''))
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    const id = textValue(String(item), 128);
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function entryRows(database: PixcallDatabase, selectedSegments: string[]): PixcallEntryRow[] {
  const columns = database.prepare('PRAGMA table_info(entries)').all() as Array<{ name: string }>;
  const ranking = columns.some((column) => column.name === 'ranking')
    ? 'CAST(ranking AS TEXT)' : 'NULL';
  let selectedId = ACTIVE_LIBRARY_ROOT_ID;
  const ancestors: Array<Record<string, unknown>> = [];
  for (const segment of selectedSegments) {
    const matches = database.prepare(`SELECT CAST(id AS TEXT) AS id, CAST(parent_id AS TEXT) AS parentId,
      name, kind, ${ranking} AS ranking, description, link, tags, rating, metadata, is_deleted AS isDeleted
      FROM entries WHERE parent_id = CAST(? AS INTEGER) AND name = ? AND kind = 0 AND is_deleted = 0 LIMIT 2`)
      .all(selectedId, segment) as Array<Record<string, unknown>>;
    if (matches.length !== 1) throw new PixcallLibraryReadError('The selected folder is not a unique active Pixcall folder.');
    ancestors.push(matches[0]!);
    selectedId = String(matches[0]!.id);
  }
  const rows = database
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT CAST(? AS INTEGER)
         UNION
         SELECT entries.id FROM entries JOIN subtree ON entries.parent_id = subtree.id
          WHERE entries.is_deleted = 0 AND entries.kind IN (0, 1)
       )
       SELECT CAST(id AS TEXT) AS id,
              CAST(parent_id AS TEXT) AS parentId,
              name,
              kind,
              ${ranking} AS ranking,
              description,
              link,
              tags,
              rating,
              metadata,
              is_deleted AS isDeleted
         FROM entries
        WHERE is_deleted = 0 AND kind IN (0, 1) AND id IN (SELECT id FROM subtree)
        LIMIT ${MAX_DATABASE_ROWS + 1}`,
    )
    .all(selectedId) as Array<Record<string, unknown>>;
  if (rows.length > MAX_DATABASE_ROWS) {
    throw new PixcallLibraryReadError('Pixcall library exceeds the supported entry limit.');
  }
  const combined = [...ancestors.slice(0, -1), ...rows];
  return combined.map((row) => ({
    id: textValue(row.id, 128),
    parentId: textValue(row.parentId, 128),
    name: textValue(row.name, 1_024),
    kind: finiteNumber(row.kind) ?? -1,
    ranking: typeof row.ranking === 'string' ? row.ranking : null,
    description: typeof row.description === 'string' ? row.description : null,
    link: typeof row.link === 'string' ? row.link : null,
    tags: typeof row.tags === 'string' ? row.tags : null,
    rating: finiteNumber(row.rating) ?? null,
    metadata: typeof row.metadata === 'string' ? row.metadata : null,
    isDeleted: finiteNumber(row.isDeleted) ?? 0,
  }));
}

function readTagNames(database: PixcallDatabase, entries: PixcallEntryRow[]): Map<string, string> {
  const result = new Map<string, string>();
  if (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").all('tags').length === 0) return result;
  const ids = [...new Set(entries.flatMap((entry) => tagIds(entry.tags)))].filter((id) => /^\d+$/u.test(id));
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < ids.length; offset += 400) {
    const batch = ids.slice(offset, offset + 400);
    try {
      rows.push(...database.prepare(`SELECT CAST(id AS TEXT) AS id, name FROM tags WHERE id IN (${batch.map(() => 'CAST(? AS INTEGER)').join(',')})`).all(...batch) as Array<Record<string, unknown>>);
    } catch (error) { throw new PixcallLibraryReadError('Could not read Pixcall metadata.', { cause: error }); }
  }
  for (const row of rows) {
    const id = textValue(row.id, 128);
    const name = textValue(row.name, MAX_TAG_LENGTH);
    if (id !== '' && name !== '') result.set(id, name);
  }
  return result;
}

function readExif(database: PixcallDatabase, entries: PixcallEntryRow[]): Map<string, Record<string, string | number | number[]>> {
  const result = new Map<string, Record<string, string | number | number[]>>();
  if (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").all('exif').length === 0) return result;
  const ids = entries.filter((entry) => entry.kind === 1).map((entry) => entry.id).filter((id) => /^\d+$/u.test(id));
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < ids.length; offset += 400) {
    const batch = ids.slice(offset, offset + 400);
    try {
      rows.push(...database.prepare(`SELECT CAST(entry_id AS TEXT) AS entryId, metadata FROM exif WHERE entry_id IN (${batch.map(() => 'CAST(? AS INTEGER)').join(',')})`).all(...batch) as Array<Record<string, unknown>>);
    } catch (error) { throw new PixcallLibraryReadError('Could not read Pixcall metadata.', { cause: error }); }
  }
  for (const row of rows) {
    const entryId = textValue(row.entryId, 128);
    if (entryId === '' || typeof row.metadata !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(row.metadata);
      if (!isObject(parsed)) continue;
      const fields: Record<string, string | number | number[]> = {};
      const mapping: Record<string, string> = {
        artist: 'Artist', make: 'Make', model: 'Model', lens_model: 'LensModel',
        iso: 'ISO', f_number: 'FNumber', exposure_time: 'ExposureTime',
        exposure_bias_value: 'ExposureCompensation', exposure_program: 'ExposureProgram',
        metering_mode: 'MeteringMode', flash: 'Flash', focal_length: 'FocalLength',
        date_time_original: 'DateTimeOriginal', orientation: 'Orientation',
        pixel_x_dimension: 'PixelXDimension', pixel_y_dimension: 'PixelYDimension',
        gps_latitude: 'GPSLatitude', gps_longitude: 'GPSLongitude',
        gps_latitude_ref: 'GPSLatitudeRef', gps_longitude_ref: 'GPSLongitudeRef',
      };
      for (const [source, target] of Object.entries(mapping)) {
        const value = parsed[source];
        if (typeof value === 'number' && Number.isFinite(value)) fields[target] = value;
        else if (typeof value === 'string' && value.trim()) fields[target] = textValue(value, 255);
        else if ((source === 'gps_latitude' || source === 'gps_longitude') && Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) fields[target] = value as number[];
      }
      if (Object.keys(fields).length) result.set(entryId, fields);
    } catch {
      // One malformed EXIF blob must not fail the rest of the library.
    }
  }
  return result;
}

function metadataFromEntry(
  row: PixcallEntryRow,
  tagNames: ReadonlyMap<string, string>,
  exif: ReadonlyMap<string, Record<string, string | number | number[]>>,
): PixcallAssetMetadata | null {
  const tags = [...new Set(
    tagIds(row.tags)
      .map((id) => tagNames.get(id))
      .filter((name): name is string => name !== undefined),
  )];
  let width: number | undefined;
  let height: number | undefined;
  if (row.metadata !== null) {
    const parsed = parseJsonValue(row.metadata);
    if (isObject(parsed)) {
      width = positiveDimension(parsed.image_width);
      height = positiveDimension(parsed.image_height);
    }
  }
  const metadata: PixcallAssetMetadata = {
    author: typeof exif.get(row.id)?.Artist === 'string' ? exif.get(row.id)!.Artist as string : null,
    description: textValue(row.description, MAX_TEXT_LENGTH) || null,
    rating: ratingValue(row.rating),
    sourcePageUrl: httpUrlValue(row.link),
    tags,
    thumbnailPath: null,
    ...(exif.has(row.id) ? { exif: exif.get(row.id) } : {}),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
  return metadata.author
    || metadata.description
    || metadata.rating > 0
    || metadata.sourcePageUrl
    || metadata.tags.length > 0
    || metadata.width
    || metadata.height
    || metadata.exif
    ? metadata
    : null;
}

function pathSegmentsForEntry(
  entry: PixcallEntryRow,
  entriesById: ReadonlyMap<string, PixcallEntryRow>,
): string[] | null {
  const fileName = safePathSegment(entry.name);
  if (fileName === null) return null;
  const segments = [fileName];
  const seen = new Set([entry.id]);
  let parentId = entry.parentId;

  for (let depth = 0; depth < 128; depth += 1) {
    if (parentId === ACTIVE_LIBRARY_ROOT_ID) return segments;
    if (parentId === TRASH_ROOT_ID || parentId === '-1') return null;
    const parent = entriesById.get(parentId);
    if (
      parent === undefined
      || parent.kind !== 0
      || parent.isDeleted !== 0
      || seen.has(parent.id)
    ) {
      return null;
    }
    const parentName = safePathSegment(parent.name);
    if (parentName === null) return null;
    seen.add(parent.id);
    segments.unshift(parentName);
    parentId = parent.parentId;
  }
  return null;
}

function sourceRootDisplayName(sourceRootPath: string): string {
  return textValue(path.basename(sourceRootPath), 255) || 'Pixcall Library';
}

export function readPixcallLibrary(sourceRootPath: string): PixcallLibrarySnapshot {
  let root: string;
  let selected: string;
  try {
    selected = realpathSync(normalizeAbsolutePath(sourceRootPath));
    const stat = lstatSync(selected, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Pixcall root is not a directory.');
    }
  } catch (error) {
    throw new PixcallLibraryReadError('Could not read the Pixcall library folder.', {
      cause: error,
    });
  }

  root = selected;
  while (!existsSync(path.join(root, '.pixcall', 'database', 'main.db'))) {
    const parent = path.dirname(root);
    if (parent === root) {
      throw new PixcallLibraryReadError('The selected folder is not inside a Pixcall library (.pixcall/database/main.db is missing).');
    }
    root = parent;
  }
  const selectedRelative = path.relative(root, selected);
  const selectedSegments = selectedRelative === '' ? [] : selectedRelative.split(path.sep);
  if (selectedSegments.some((segment) => segment.toLowerCase() === '.pixcall')) {
    throw new PixcallLibraryReadError('The Pixcall internal directory cannot be imported.');
  }

  const databasePath = path.join(root, '.pixcall', 'database', 'main.db');
  let database: PixcallDatabase | undefined;
  let rows: PixcallEntryRow[];
  let tagNames: Map<string, string>;
  let exif: Map<string, Record<string, string | number | number[]>>;
  try {
    database = new PixcallDatabase(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;');
    rows = entryRows(database, selectedSegments);
    // Pixcall's folder tree has its own rank; entries.ranking orders the
    // content grid. Older databases may only provide the latter.
    const folderTable = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'folders'").all();
    if (folderTable.length > 0) {
      const columns = database.prepare('PRAGMA table_info(folders)').all() as Array<{ name: string }>;
      if (columns.some((column) => column.name === 'ranking')) {
        const ranks = database.prepare('SELECT CAST(entry_id AS TEXT) AS id, CAST(ranking AS TEXT) AS ranking FROM folders').all() as Array<{ id: string; ranking: string | null }>;
        const byId = new Map(ranks.map((row) => [row.id, row.ranking]));
        rows = rows.map((row) => ({ ...row, ranking: byId.get(row.id) ?? row.ranking }));
      }
    }
    const selectedRows = rows.filter((row) => row.kind === 1);
    tagNames = readTagNames(database, selectedRows);
    exif = readExif(database, selectedRows);
  } catch (error) {
    if (error instanceof PixcallLibraryReadError) throw error;
    throw new PixcallLibraryReadError(
      'The selected folder is not a Pixcall library (.pixcall/database/main.db is missing or unreadable).',
      { cause: error },
    );
  } finally {
    try {
      database?.close();
    } catch {
      // Best effort: read-only cleanup must not hide the import result.
    }
  }

  const entriesById = new Map(rows.map((row) => [row.id, row]));
  const isSelected = (segments: string[]): boolean =>
    selectedSegments.every((segment, index) => segments[index] === segment);
  if (selectedSegments.length > 0 && !rows.some((row) => {
    if (row.kind !== 0) return false;
    const segments = pathSegmentsForEntry(row, entriesById);
    return segments !== null && segments.length === selectedSegments.length && isSelected(segments);
  })) {
    throw new PixcallLibraryReadError('The selected folder is not an active Pixcall folder.');
  }
  const directories = new Set<string>();
  const items: PixcallAssetCandidate[] = [];
  let skippedCount = 0;
  const skippedItems: PixcallLibrarySnapshot['skippedItems'] = [];
  const recordSkipped = (relativePath: string, reason: 'unreadable' | 'unsafe'): void => {
    skippedCount += 1;
    skippedItems.push({ relativePath, reason });
  };

  for (const row of rows) {
    if (row.kind !== 0) continue;
    const segments = pathSegmentsForEntry(row, entriesById);
    if (segments && isSelected(segments)) directories.add(segments.join('/'));
  }

  for (const row of rows) {
    if (row.kind !== 1) continue;
    const segments = pathSegmentsForEntry(row, entriesById);
    if (segments === null || !isSelected(segments)) continue;
    const relativePath = segments.join('/');
    const sourcePath = path.join(root, ...segments);
    try {
      const canonical = realpathSync(sourcePath);
      if (!pathIsWithin(root, canonical)) {
        recordSkipped(relativePath, 'unsafe');
        continue;
      }
      const stat: BigIntStats = lstatSync(canonical, { bigint: true });
      if (
        stat.isSymbolicLink()
        || !stat.isFile()
        || stat.size > BigInt(Number.MAX_SAFE_INTEGER)
      ) {
        recordSkipped(relativePath, 'unsafe');
        continue;
      }
      items.push({
        sourcePath: canonical,
        relativePath,
        byteSize: Number(stat.size),
        sourceModifiedAtMs: Number(stat.mtimeMs),
        metadata: metadataFromEntry(row, tagNames, exif),
      });
    } catch {
      recordSkipped(relativePath, 'unreadable');
    }
  }

  items.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const siblings = new Map<string, Array<{ relativePath: string; rank: bigint }>>();
  for (const row of rows) {
    if (row.kind !== 0 || !row.ranking || !/^-?\d+$/u.test(row.ranking)) continue;
    const segments = pathSegmentsForEntry(row, entriesById);
    if (!segments || !isSelected(segments) || !directories.has(segments.join('/'))) continue;
    const group = siblings.get(row.parentId) ?? [];
    group.push({ relativePath: segments.join('/'), rank: BigInt(row.ranking) });
    siblings.set(row.parentId, group);
  }
  const folderOrder = [...siblings.values()].flatMap((group) => {
    group.sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.relativePath.localeCompare(b.relativePath));
    return group.map(({ relativePath }, position) => ({ relativePath, position }));
  });
  if (items.length === 0 && directories.size === 0 && skippedCount === 0) {
    throw new PixcallLibraryReadError('The selected Pixcall library does not contain active assets.');
  }
  return {
    displayName: sourceRootDisplayName(root),
    sourceRootPath: root,
    directories: [...directories].sort(),
    folderOrder,
    items,
    skippedCount,
    skippedItems,
    metadataAvailable: true,
  };
}
