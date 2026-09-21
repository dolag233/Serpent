/**
 * Normalization shared by the embedded metadata readers.
 *
 * The source file remains authoritative. These helpers only produce a small,
 * bounded projection suitable for the revision artifact and full text search.
 */

const MAX_TEXT_LENGTH = 255;
const MAX_CUSTOM_TAGS = 32;

export interface EmbeddedCustomTag {
  key: string;
  value: string;
}

export interface EmbeddedMetadataFields {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNumber: string | null;
  discNumber: string | null;
  genre: string | null;
  composer: string | null;
  comment: string | null;
  copyright: string | null;
  date: string | null;
  captureDate?: string | null;
  author?: string | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lensModel?: string | null;
  description?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;
  width?: number | null;
  height?: number | null;
  orientation?: number | string | null;
  iso?: number | string | null;
  fNumber?: number | string | null;
  exposureTime?: number | string | null;
  exposureCompensation?: number | string | null;
  exposureProgram?: number | string | null;
  meteringMode?: number | string | null;
  flash?: number | string | null;
  focalLength?: number | string | null;
  customTags: EmbeddedCustomTag[];
}

type UnknownRecord = Record<string, unknown>;

function boundedText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = Array.from(String(value), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('').trim();
  return normalized ? normalized.slice(0, MAX_TEXT_LENGTH) : null;
}

function tagRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function firstTag(records: readonly UnknownRecord[], keys: readonly string[]): string | null {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase().replace(/[\s_-]/gu, '')));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (!normalizedKeys.has(key.toLowerCase().replace(/[\s_-]/gu, ''))) continue;
      const text = boundedText(Array.isArray(value) ? value[0] : value);
      if (text) return text;
    }
  }
  return null;
}

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/gu, '');
}

const KNOWN_KEYS = new Set([
  'title', 'name', 'track', 'tracknumber', 'tracktotal', 'disc', 'discnumber',
  'disctotal', 'artist', 'performer', 'albumartist', 'albumartists', 'album',
  'genre', 'composer', 'comment', 'comments', 'copyright', 'date', 'year',
  'creationtime', 'encodeddate', 'releasedate', 'majorbrand', 'minorversion',
  'compatiblebrands', 'encoder', 'handlername', 'language', 'lyrics',
]);

function customTags(records: readonly UnknownRecord[]): EmbeddedCustomTag[] {
  const output: EmbeddedCustomTag[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const [key, rawValue] of Object.entries(record)) {
      const normalized = normalizedKey(key);
      if (KNOWN_KEYS.has(normalized)) continue;
      const value = boundedText(Array.isArray(rawValue) ? rawValue[0] : rawValue);
      const trimmedKey = key.trim().slice(0, 128);
      if (!trimmedKey || !value || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push({ key: trimmedKey, value });
      if (output.length >= MAX_CUSTOM_TAGS) return output;
    }
  }
  return output;
}

/** Normalize ffprobe `format.tags` and stream-level tags into common fields. */
export function normalizeProbeEmbeddedMetadata(probe: unknown): EmbeddedMetadataFields {
  const root = tagRecord(probe);
  const format = tagRecord(root.format);
  const streams = Array.isArray(root.streams) ? root.streams : [];
  const streamRecords = streams
    .filter((stream): stream is UnknownRecord => stream && typeof stream === 'object')
    .map((stream) => tagRecord(stream.tags));
  const records = [tagRecord(format.tags), ...streamRecords];
  return {
    title: firstTag(records, ['title', 'name']),
    artist: firstTag(records, ['artist', 'performer']),
    album: firstTag(records, ['album']),
    albumArtist: firstTag(records, ['album_artist', 'albumartist', 'album artists']),
    trackNumber: firstTag(records, ['track', 'tracknumber']),
    discNumber: firstTag(records, ['disc', 'discnumber']),
    genre: firstTag(records, ['genre']),
    composer: firstTag(records, ['composer']),
    comment: firstTag(records, ['comment', 'comments', 'description']),
    copyright: firstTag(records, ['copyright']),
    date: firstTag(records, ['date', 'year', 'creation_time', 'encoded_date', 'release_date']),
    customTags: customTags(records),
  };
}

/** Return only user-searchable values from the bounded embedded projection. */
export function embeddedMetadataSearchText(metadata: Partial<EmbeddedMetadataFields> | null | undefined): string {
  if (!metadata) return '';
  const values: string[] = [];
  for (const key of [
    'title', 'artist', 'album', 'albumArtist', 'trackNumber', 'discNumber',
    'genre', 'composer', 'comment', 'copyright', 'date',
    'captureDate', 'author', 'cameraMake', 'cameraModel', 'lensModel', 'description',
    'gpsLatitude', 'gpsLongitude',
    'width', 'height', 'orientation', 'iso', 'fNumber', 'exposureTime',
    'exposureCompensation', 'exposureProgram', 'meteringMode', 'flash', 'focalLength',
  ] as const) {
    const value = boundedText(metadata[key]);
    if (value) values.push(value);
  }
  for (const tag of metadata.customTags ?? []) {
    if (tag && typeof tag === 'object') {
      const key = boundedText(tag.key);
      const value = boundedText(tag.value);
      if (key) values.push(key);
      if (value) values.push(value);
    }
  }
  return values.join(' ');
}
