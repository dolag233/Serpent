import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

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
 * The Emscripten glue (ufbx.js, MODULARIZE + ENVIRONMENT=node) is CommonJS and
 * is required at runtime so Vite never bundles the WASM into the worker.
 */

export interface SerpentUfbxModule {
  _serpent_parse(fbxPtr: number, fbxSize: number, optsPtr: number): number;
  _serpent_error(): number;
  _serpent_out_ptr(): number;
  _serpent_out_size(): number;
  _serpent_free_out(): void;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPU8: Uint8Array;
  UTF8ToString(ptr: number): string;
}

type EmscriptenFactory = (overrides?: {
  locateFile?: (file: string) => string;
}) => Promise<SerpentUfbxModule>;

interface EmscriptenModuleExports {
  default?: EmscriptenFactory;
  [key: string]: unknown;
}

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

let modulePromise: Promise<SerpentUfbxModule> | null = null;

/**
 * Load (once) and return the ufbx WASM module. Serializes on the module
 * singleton; the bridge keeps global output state so callers must not run two
 * conversions concurrently — route through withSerpentUfbx or the single-flight
 * queue in convert-command.ts. A failed load is not cached, so a later call
 * (e.g. after resources/ufbx was built) can retry.
 */
export function loadSerpentUfbxModule(): Promise<SerpentUfbxModule> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const dir = resolveUfbxDir();
    if (!dir) {
      throw new Error(
        'UFBX_WASM_MISSING: resources/ufbx/ufbx.wasm not found. ' +
          'Run `node scripts/build-ufbx-wasm.mjs` (see CLAUDE.md media:acquire notes).',
      );
    }
    const gluePath = path.join(dir, 'ufbx.js');
    if (!existsSync(gluePath)) {
      throw new Error('UFBX_WASM_MISSING: ufbx.js glue not found next to ufbx.wasm.');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(gluePath) as EmscriptenModuleExports;
    const factory = (loaded.default ?? loaded) as EmscriptenFactory;
    if (typeof factory !== 'function') {
      throw new Error(`UFBX_WASM_GLUE_BROKEN: ${gluePath} did not export a module factory.`);
    }
    const instance = await factory({
      locateFile: (file) => {
        if (file === 'ufbx.wasm') return path.join(dir, 'ufbx.wasm');
        return file;
      },
    });
    if (typeof instance._serpent_parse !== 'function') {
      throw new Error('UFBX_WASM_BROKEN: glue does not expose serpent_parse.');
    }
    return instance;
  })();

  modulePromise.catch(() => {
    modulePromise = null;
  });
  return modulePromise;
}

/** Test-only hook: drop the cached module so the next call re-resolves. */
export function resetSerpentUfbxModuleForTest(): void {
  modulePromise = null;
}

/**
 * Enqueue a task against the singleton WASM module, guaranteeing serialized
 * access (the bridge keeps global output state).
 */
export async function withSerpentUfbx<T>(
  task: (module: SerpentUfbxModule) => Promise<T>,
): Promise<T> {
  const module = await loadSerpentUfbxModule();
  return withSerpentUfbxChain(task, module);
}

let chainTail: Promise<unknown> = Promise.resolve();

function withSerpentUfbxChain<T>(
  task: (module: SerpentUfbxModule) => Promise<T>,
  module: SerpentUfbxModule,
): Promise<T> {
  const result = chainTail.then(() => task(module));
  chainTail = result.catch(() => undefined);
  return result;
}

/** Parse FBX bytes through the bridge; returns the packed descriptor buffer. */
export async function parseFbxBytes(
  fbxBytes: Buffer,
  options: { filename: string; maxTriangles?: number },
): Promise<Buffer> {
  return withSerpentUfbx(async (module) => {
    const optsJson = Buffer.from(
      JSON.stringify({
        filename: options.filename,
        maxTriangles: options.maxTriangles ?? 0,
      }),
      'utf8',
    );

    const fbxPtr = module._malloc(fbxBytes.length);
    const optsPtr = module._malloc(optsJson.length);
    if (fbxPtr === 0 || optsPtr === 0) {
      if (fbxPtr !== 0) module._free(fbxPtr);
      if (optsPtr !== 0) module._free(optsPtr);
      throw new Error('UFBX_WASM_OOM: bridge memory allocation failed');
    }
    module.HEAPU8.set(fbxBytes, fbxPtr);
    module.HEAPU8.set(optsJson, optsPtr);

    try {
      const rc = module._serpent_parse(fbxPtr, fbxBytes.length, optsPtr);
      if (rc !== 0) {
        const errPtr = module._serpent_error();
        const message = errPtr !== 0 ? module.UTF8ToString(errPtr) : '{"ok":false}';
        throw new Error(message);
      }
      const outPtr = module._serpent_out_ptr();
      const outSize = module._serpent_out_size();
      if (outPtr === 0 || outSize === 0) {
        throw new Error('UFBX_WASM_BROKEN: bridge returned an empty result');
      }
      const packed = Buffer.allocUnsafe(outSize);
      Buffer.from(module.HEAPU8.buffer, outPtr, outSize).copy(packed);
      return packed;
    } finally {
      module._serpent_free_out();
      module._free(fbxPtr);
      module._free(optsPtr);
    }
  });
}
