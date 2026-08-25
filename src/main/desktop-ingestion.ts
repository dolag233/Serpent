import path from 'node:path';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
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
