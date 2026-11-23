import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Thumbnail extraction for PaintTool SAI via the libsai sample tools.
 * `.sai2` starts with `SAI-CANVAS`. `.sai` is the encrypted version-1 document.
 */

const SAI2_MAGIC = Buffer.from('SAI-CANVAS', 'ascii');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const TOOL_TIMEOUT_MS = 30_000;

export interface SaiLibsaiTools {
  sai1: string;
  sai2: string;
}

export function defaultSaiLibsaiTools(root = process.cwd()): SaiLibsaiTools {
  const directory = path.join(root, 'out', 'libsai', 'build', 'Release');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return {
    sai1: path.join(directory, `Thumbnail-Sai1${suffix}`),
    sai2: path.join(directory, `Thumbnail-Sai2${suffix}`),
  };
}

function fileStartsWith(filePath: string, magic: Buffer): boolean {
  const handle = openSync(filePath, 'r');
  try {
    if (fstatSync(handle).size < magic.length) return false;
    const prefix = Buffer.alloc(magic.length);
    const count = readSync(handle, prefix, 0, magic.length, 0);
    return count === magic.length && prefix.equals(magic);
  } finally {
    closeSync(handle);
  }
}

function readPng(filePath: string): Buffer | null {
  if (!existsSync(filePath)) return null;
  const bytes = readFileSync(filePath);
  if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    return null;
  }
  return bytes;
}

/** Runs the matching libsai tool and returns a PNG, or null when extraction fails. */
export function extractSaiThumbnailWithLibsai(
  filePath: string,
  tools: SaiLibsaiTools = defaultSaiLibsaiTools(),
): Buffer | null {
  const tool = fileStartsWith(filePath, SAI2_MAGIC) ? tools.sai2 : tools.sai1;
  if (!existsSync(tool)) return null;
  const outputPath = path.join(
    tmpdir(),
    `serpent-sai-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`,
  );
  try {
    const result = spawnSync(tool, [filePath, outputPath], {
      timeout: TOOL_TIMEOUT_MS,
      windowsHide: true,
    });
    if (result.error || result.signal) return null;
    return readPng(outputPath);
  } finally {
    rmSync(outputPath, { force: true });
  }
}
