import type { Readable } from 'node:stream';

import { ZipImportStreamError, decodeZipEntryName, portableEntryName } from './zip-import-stream';

import * as yauzl from 'yauzl';

const MAX_SCANNED_ENTRIES = 20_000;
const MAX_LISTED_FILES = 4_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_BYTES = 512 * 1024;
const COMPRESSION_RATIO_MIN_SIZE = 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg',
]);
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.csv', '.log', '.xml', '.yaml', '.yml',
  '.html', '.css', '.js', '.ts', '.tsx', '.jsx', '.ini', '.toml',
]);

export type ZipArchiveFileEntry = {
  index: number;
  name: string;
  uncompressedSize: number;
};

export type ZipArchiveListing = {
  status: 'ready' | 'unreadable';
  truncated: boolean;
  files: ZipArchiveFileEntry[];
};

export type ZipArchiveEntryPreview = {
  name: string;
  uncompressedSize: number;
  kind: 'image' | 'text' | 'unavailable';
  mimeType?: string;
  bytesBase64?: string;
  text?: string;
  truncated?: boolean;
};

function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

function unixMode(entry: yauzl.Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0o170000;
}

function displayName(entry: yauzl.Entry, index: number): { name: string; directory: boolean } | undefined {
  let decoded: string;
  try {
    decoded = decodeZipEntryName(entry);
  } catch {
    return { name: `entry-${index}`, directory: false };
  }
  try {
    const portable = portableEntryName(decoded);
    const directory = portable.directoryByName || unixMode(entry) === 0o040000;
    return { name: portable.name, directory };
  } catch (error) {
    if (error instanceof ZipImportStreamError) {
      return { name: `entry-${index}`, directory: decoded.endsWith('/') };
    }
    return undefined;
  }
}

async function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return yauzl.openPromise(zipPath, {
    autoClose: false,
    lazyEntries: true,
    decodeStrings: false,
    validateEntrySizes: true,
    strictFileNames: false,
  });
}

function refusesInflate(entry: yauzl.Entry): boolean {
  if (entry.isEncrypted() || !entry.canDecodeFileData()) return true;
  if (unixMode(entry) === 0o120000) return true;
  if (
    entry.uncompressedSize >= COMPRESSION_RATIO_MIN_SIZE
    && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > MAX_COMPRESSION_RATIO
  ) {
    return true;
  }
  return false;
}

async function readBounded(stream: Readable, maxBytes: number): Promise<{
  buffer: Buffer;
  truncated: boolean;
}> {
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (total + buf.length > maxBytes) {
        const keep = maxBytes - total;
        if (keep > 0) chunks.push(buf.subarray(0, keep));
        total = maxBytes;
        truncated = true;
        stream.destroy();
        break;
      }
      chunks.push(buf);
      total += buf.length;
    }
  } catch (error) {
    if (!truncated) throw error;
  }
  return { buffer: Buffer.concat(chunks), truncated };
}

export async function listZipArchiveFiles(zipPath: string): Promise<ZipArchiveListing> {
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(zipPath);
  } catch {
    return { status: 'unreadable', truncated: false, files: [] };
  }
  const files: ZipArchiveFileEntry[] = [];
  let truncated = false;
  let scanned = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      const described = displayName(entry, scanned);
      scanned += 1;
      if (described && !described.directory) {
        if (files.length >= MAX_LISTED_FILES) {
          truncated = true;
          break;
        }
        const name = described.name.slice(0, 1_024);
        if (name.length === 0) continue;
        files.push({
          index: scanned - 1,
          name,
          uncompressedSize: entry.uncompressedSize,
        });
      }
      if (scanned >= MAX_SCANNED_ENTRIES) {
        truncated = true;
        break;
      }
    }
  } catch {
    return { status: 'unreadable', truncated: false, files: [] };
  } finally {
    zip.close();
  }
  files.sort((left, right) => left.name.localeCompare(right.name));
  return { status: 'ready', truncated, files };
}

function mimeFor(extension: string, kind: 'image' | 'text'): string {
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.bmp') return 'image/bmp';
  if (extension === '.json') return 'application/json';
  if (extension === '.html') return 'text/html';
  if (extension === '.css') return 'text/css';
  if (extension === '.xml') return 'application/xml';
  if (kind === 'image') return 'application/octet-stream';
  return 'text/plain';
}

export async function readZipArchiveEntry(
  zipPath: string,
  entryIndex: number,
): Promise<ZipArchiveEntryPreview | undefined> {
  if (!Number.isInteger(entryIndex) || entryIndex < 0 || entryIndex >= MAX_SCANNED_ENTRIES) {
    return undefined;
  }
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(zipPath);
  } catch {
    return undefined;
  }
  let found: yauzl.Entry | undefined;
  let name = `entry-${entryIndex}`;
  let scanned = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      if (scanned === entryIndex) {
        found = entry;
        const described = displayName(entry, scanned);
        if (described && described.name.length > 0) name = described.name.slice(0, 1_024);
        break;
      }
      scanned += 1;
    }
  } catch {
    zip.close();
    return undefined;
  }
  if (!found) {
    zip.close();
    return undefined;
  }
  const unavailable = (uncompressedSize: number): ZipArchiveEntryPreview => ({
    name,
    uncompressedSize,
    kind: 'unavailable',
  });
  if (refusesInflate(found) || name.endsWith('/')) {
    zip.close();
    return unavailable(found.uncompressedSize);
  }
  const extension = extensionOf(name);
  const kind = IMAGE_EXTENSIONS.has(extension)
    ? 'image'
    : TEXT_EXTENSIONS.has(extension)
      ? 'text'
      : undefined;
  if (kind === undefined) {
    zip.close();
    return unavailable(found.uncompressedSize);
  }
  const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
  if (found.uncompressedSize > maxBytes) {
    zip.close();
    return unavailable(found.uncompressedSize);
  }
  try {
    const stream = await zip.openReadStreamPromise(found);
    const read = await readBounded(stream, maxBytes);
    if (kind === 'image') {
      if (read.truncated || read.buffer.length === 0) return unavailable(found.uncompressedSize);
      return {
        name,
        uncompressedSize: found.uncompressedSize,
        kind,
        mimeType: mimeFor(extension, kind),
        bytesBase64: read.buffer.toString('base64'),
      };
    }
    const text = read.buffer.toString('utf8');
    return {
      name,
      uncompressedSize: found.uncompressedSize,
      kind,
      mimeType: mimeFor(extension, kind),
      text,
      ...(read.truncated ? { truncated: true } : {}),
    };
  } catch {
    return unavailable(found.uncompressedSize);
  } finally {
    zip.close();
  }
}
