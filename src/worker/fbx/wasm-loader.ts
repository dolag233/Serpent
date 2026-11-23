import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import workerSource from './wasm-parse-worker.cjs?raw';
import { SerializedFbxParseQueue } from './serialized-parse-queue';

/**
 * Runtime loader for the ufbx WASM module built by
 * scripts/build-ufbx-wasm.mjs (see scripts/ufbx-wasm-lock.json for the pinned
 * source/toolchain). The module is platform-independent and lives under
 * resources/ufbx/ (gitignored, media:acquire convention).
 *
 * Resolution order:
 *   1. SERPENT_UFBX_DIR environment variable
 *   2. Packaged: <process.resourcesPath>/resources/ufbx
 *   3. Dev/tests: <cwd>/resources/ufbx
 *
 * The Emscripten glue remains runtime-loaded inside a disposable node worker
 * thread. Vite embeds only its small CJS bootstrap; the WASM binary stays at
 * its resolved resources path.
 */

export function resolveUfbxDir(): string | null {
  // SERPENT_UFBX_DIR is authoritative when set (mirrors the SERPENT_FFMPEG_PATH
  // convention in binary-resolver.ts): a broken override must fail loudly
  // instead of silently falling back to a bundled module.
  const envDir = process.env['SERPENT_UFBX_DIR'];
  if (envDir) {
    try {
      const stat = statSync(path.join(envDir, 'ufbx.wasm'));
      if (stat.isFile() && stat.size > 0) return envDir;
    } catch {
      // fall through to the "not usable" result below
    }
    return null;
  }
  const candidates: string[] = [];
  if (
    typeof process.resourcesPath === 'string' &&
    process.resourcesPath.length > 0
  ) {
    candidates.push(path.join(process.resourcesPath, 'resources', 'ufbx'));
  }
  candidates.push(path.join(process.cwd(), 'resources', 'ufbx'));

  for (const candidate of candidates) {
    try {
      const stat = statSync(path.join(candidate, 'ufbx.wasm'));
      if (stat.isFile() && stat.size > 0) return candidate;
    } catch {
      // candidate not usable; keep looking
    }
  }
  return null;
}

const parseQueue = new SerializedFbxParseQueue(workerSource);

/** Parse FBX bytes in an isolated worker thread; returns the packed descriptor. */
export async function parseFbxBytes(
  fbxBytes: Buffer,
  options: { filename: string; maxTriangles?: number; signal?: AbortSignal },
): Promise<Buffer> {
  if (options.signal?.aborted) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error('FBX conversion aborted.');
  }
  const dir = resolveUfbxDir();
  if (!dir) {
    throw new Error(
      'UFBX_WASM_MISSING: resources/ufbx/ufbx.wasm not found. ' +
        'Run `node scripts/build-ufbx-wasm.mjs` (see CLAUDE.md media:acquire notes).',
    );
  }
  if (!existsSync(path.join(dir, 'ufbx.js'))) {
    throw new Error('UFBX_WASM_MISSING: ufbx.js glue not found next to ufbx.wasm.');
  }
  return parseQueue.parse({
    fbxBytes,
    filename: options.filename,
    maxTriangles: options.maxTriangles ?? 0,
    ufbxDir: dir,
  }, options.signal);
}
