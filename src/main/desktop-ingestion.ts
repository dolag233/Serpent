import path from 'node:path';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  type Stats,
} from 'node:fs';

export type DroppedSourceKind = 'files' | 'folder';

function unsupportedDroppedEntry(reason: 'SYMBOLIC_LINK_NOT_ALLOWED' | 'UNSUPPORTED_FILE_ENTRY'): Error & { reason: typeof reason } {
  return Object.assign(new Error(reason), { reason });
}

export function classifyDroppedSourcePaths(
  sourcePaths: readonly string[],
  statPath: (candidate: string) => Pick<Stats, 'isDirectory' | 'isFile' | 'isSymbolicLink'> = lstatSync,
): DroppedSourceKind {
  if (sourcePaths.length === 0 || sourcePaths.length > 1_000) {
    throw new Error('INVALID_DROP_SELECTION');
  }
  const kinds = sourcePaths.map((candidate) => {
    if (!path.isAbsolute(candidate)) throw new Error('INVALID_DROP_SELECTION');
    const stat = statPath(candidate);
    if (stat.isSymbolicLink()) throw unsupportedDroppedEntry('SYMBOLIC_LINK_NOT_ALLOWED');
    if (stat.isDirectory()) return 'folder' as const;
    if (stat.isFile()) return 'file' as const;
    throw unsupportedDroppedEntry('UNSUPPORTED_FILE_ENTRY');
  });
  // A single folder keeps the recursive-folder import path. Every other
  // valid selection (multiple files, multiple folders, or a mixed selection)
  // is handled by the multi-source path in the Worker. Previously mixed
  // selections were rejected here, which made native Explorer drags appear
  // to do nothing even though each selected entry was importable.
  if (kinds.length === 1 && kinds[0] === 'folder') return 'folder';
  return 'files';
}

export interface ClipboardImageLike {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

export interface StagedClipboardImage {
  directoryPath: string;
  filePath: string;
}

const CLIPBOARD_STAGE_PREFIX = 'serpent-clipboard-';
const MAX_CLIPBOARD_IMAGE_BYTES = 500 * 1024 * 1024;

export function stageClipboardImage(
  image: ClipboardImageLike,
  temporaryRoot: string,
  now = new Date(),
): StagedClipboardImage {
  if (image.isEmpty()) throw new Error('CLIPBOARD_IMAGE_NOT_FOUND');
  mkdirSync(temporaryRoot, { recursive: true });
  const directoryPath = mkdtempSync(path.join(temporaryRoot, CLIPBOARD_STAGE_PREFIX));
  try {
    const png = image.toPNG();
    if (png.length === 0 || png.length > MAX_CLIPBOARD_IMAGE_BYTES) {
      throw new Error('CLIPBOARD_IMAGE_NOT_FOUND');
    }
    const timestamp = now.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
    const filePath = path.join(directoryPath, `Clipboard ${timestamp}.png`);
    writeFileSync(filePath, png, {
      flag: 'wx',
      mode: 0o600,
    });
    return { directoryPath, filePath };
  } catch (error) {
    rmSync(directoryPath, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupClipboardImage(directoryPath: string): void {
  rmSync(directoryPath, { recursive: true, force: true });
}

export function cleanupStaleClipboardImages(temporaryRoot: string): number {
  let entries;
  try {
    entries = readdirSync(temporaryRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith(CLIPBOARD_STAGE_PREFIX)) continue;
    rmSync(path.join(temporaryRoot, entry.name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Windows clipboard image extraction (Serpent-a3de58)
// ---------------------------------------------------------------------------

export interface ClipboardImageReaderDeps {
  readImage(): ClipboardImageLike;
  readBuffer(format: string): Buffer;
  readHTML(): string;
  createFromBuffer(buffer: Buffer): ClipboardImageLike;
  readFile?(filePath: string): Buffer;
}

export type ClipboardImageExtraction = {
  image: ClipboardImageLike;
  /** Which clipboard format produced the image (diagnostics log). */
  source: string;
};

const PNG_REGISTERED_FORMATS = ['PNG', 'image/png'] as const;
const DIB_REGISTERED_FORMATS = ['CF_DIB', 'CF_DIBV5'] as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML_IMG_SRC_PATTERN = /<img[^>]+src\s*=\s*["']([^"']+)["']/gi;

/**
 * Wrap a bare DIB (BITMAPINFOHEADER + pixel data, what Windows stores as
 * CF_DIB) into a BMP file container so Chromium's BMP decoder can take it.
 * Returns null for DIBs that cannot be re-wrapped losslessly (compressed
 * variants, truncated payloads, core headers).
 */
export function wrapDibInBmp(dib: Buffer): Buffer | null {
  if (dib.length < 40) return null;
  const headerSize = dib.readUInt32LE(0);
  if (headerSize < 40 || headerSize >= dib.length) return null;
  const width = dib.readInt32LE(4);
  const height = dib.readInt32LE(8);
  if (width === 0 || height === 0) return null;
  const bitCount = dib.readUInt16LE(14);
  const compression = dib.readUInt32LE(16);
  // BI_RGB (0) and BI_BITFIELDS (3) survive the re-wrap; RLE/JPEG/PNG-compressed
  // DIBs do not decode through a BMP container.
  if (compression !== 0 && compression !== 3) return null;
  let paletteEntries = 0;
  if (bitCount <= 8) {
    paletteEntries = dib.readUInt32LE(32);
    if (paletteEntries === 0) paletteEntries = 1 << bitCount;
  }
  const bitsOffset = 14 + headerSize + paletteEntries * 4;
  // Validity is against the assembled BMP file (file header + DIB), not the
  // bare DIB: the pixel data starts after the 14-byte file header.
  if (bitsOffset > 14 + dib.length) return null;
  const fileHeader = Buffer.alloc(14);
  fileHeader.write('BM', 0, 'ascii');
  fileHeader.writeUInt32LE(14 + dib.length, 2);
  fileHeader.writeUInt32LE(bitsOffset, 10);
  return Buffer.concat([fileHeader, dib]);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

function fileUrlToPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return null;
    const pathname = decodeURIComponent(parsed.pathname);
    // file:///C:/… → C:/…
    return parsed.host ? `//${parsed.host}${pathname}` : pathname.replace(/^\/+/, '');
  } catch {
    return null;
  }
}

/**
 * Pull image candidates out of CF_HTML. Office/OneNote-style apps paste HTML
 * that references a temp image file (`file:///…`) or embeds the bytes inline
 * (`data:image/…;base64`); some paste flows only carry the image this way.
 */
export function extractClipboardHtmlImageSources(html: string): {
  dataUrls: string[];
  filePaths: string[];
} {
  const dataUrls: string[] = [];
  const filePaths: string[] = [];
  for (const match of html.matchAll(HTML_IMG_SRC_PATTERN)) {
    const src = decodeHtmlEntities(match[1] ?? '').trim();
    if (src.startsWith('data:image/')) {
      dataUrls.push(src);
      continue;
    }
    if (/^file:\/\//i.test(src)) {
      const filePath = fileUrlToPath(src);
      if (filePath) filePaths.push(filePath);
    }
  }
  return { dataUrls, filePaths };
}

/**
 * Authoritative Windows clipboard image read. Chromium's `readImage()` misses
 * several real-world layouts (apps that write only a registered PNG format,
 * DIBV5 without DIB, HTML-only sources such as Office temp-file references),
 * so walk every format a clipboard image realistically arrives in.
 */
export function readClipboardImage(
  deps: ClipboardImageReaderDeps,
): ClipboardImageExtraction | null {
  const direct = deps.readImage();
  if (!direct.isEmpty()) return { image: direct, source: 'readImage' };

  for (const format of PNG_REGISTERED_FORMATS) {
    const bytes = deps.readBuffer(format);
    if (bytes.length <= PNG_SIGNATURE.length) continue;
    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) continue;
    const image = deps.createFromBuffer(bytes);
    if (!image.isEmpty()) return { image, source: `readBuffer:${format}` };
  }

  for (const format of DIB_REGISTERED_FORMATS) {
    const bytes = deps.readBuffer(format);
    if (bytes.length === 0) continue;
    const bmp = wrapDibInBmp(bytes);
    if (!bmp) continue;
    const image = deps.createFromBuffer(bmp);
    if (!image.isEmpty()) return { image, source: `readBuffer:${format}` };
  }

  const html = deps.readHTML();
  if (html) {
    const { dataUrls, filePaths } = extractClipboardHtmlImageSources(html);
    for (const dataUrl of dataUrls) {
      const separator = dataUrl.indexOf(',');
      if (separator === -1) continue;
      const bytes = Buffer.from(dataUrl.slice(separator + 1), 'base64');
      if (bytes.length === 0) continue;
      const image = deps.createFromBuffer(bytes);
      if (!image.isEmpty()) return { image, source: 'html:data-url' };
    }
    for (const filePath of filePaths) {
      try {
        const bytes = (deps.readFile ?? readFileSync)(filePath);
        if (bytes.length === 0) continue;
        const image = deps.createFromBuffer(bytes);
        if (!image.isEmpty()) return { image, source: 'html:file' };
      } catch {
        // The referenced temp file is gone — try the next candidate.
      }
    }
  }

  return null;
}
