#!/usr/bin/env node
/**
 * Build the Serpent ufbx WASM module (media:acquire-style pipeline).
 *
 * Follows the trusted external-binary pattern used for FFmpeg/OIIO
 * (scripts/media-binaries.mjs): everything needed to reproduce the artifact is
 * pinned in scripts/ufbx-wasm-lock.json (source URL + SHA-256, Emscripten
 * version, compiler flags, expected artifact SHA-256), and the build writes a
 * provenance receipt next to the artifacts.
 *
 * Artifacts (NOT committed to git, see .gitignore `resources/ufbx/`):
 *   resources/ufbx/ufbx.wasm      — WASM binary (platform-independent)
 *   resources/ufbx/ufbx.js        — Emscripten JS glue (MODULARIZE, node)
 *   resources/ufbx/ufbx.c         — ufbx source (for license provenance)
 *   resources/ufbx/ufbx.h         — ufbx header
 *   resources/ufbx/LICENSE        — ufbx MIT license text
 *   resources/ufbx/acquisition.json — provenance receipt
 *
 * Usage:
 *   node scripts/build-ufbx-wasm.mjs [--emsdk <dir>] [--cache <dir>]
 *
 * Requirements: Emscripten SDK installed (see CLAUDE.md environment notes).
 * Recommended install (recorded in development logs):
 *   git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
 *   ~/emsdk/emsdk install 6.0.5 && ~/emsdk/emsdk activate 6.0.5
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = path.join(REPO_ROOT, 'scripts', 'ufbx-wasm-lock.json');
const BRIDGE_PATH = path.join(REPO_ROOT, 'scripts', 'ufbx-bridge.c');
const DEFAULT_CACHE = path.join(REPO_ROOT, '.media-build', 'ufbx');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

async function download(url, destination) {
  if (existsSync(destination)) return;
  mkdirSync(path.dirname(destination), { recursive: true });
  console.log(`Downloading ${url}`);
  const response = await awaitFetch(url);
  writeFileSync(destination, Buffer.from(response));
}

async function awaitFetch(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
  }
  if (!response.url.startsWith('https://')) {
    throw new Error(`Download redirected away from HTTPS: ${response.url}`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 512 * 1024 * 1024) {
    throw new Error('Download exceeds the 512 MiB safety limit.');
  }
  return bytes;
}

function argumentsMap(args) {
  const result = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    result.set(key.slice(2), value);
    index += 1;
  }
  return result;
}

function candidateEmccPaths() {
  const candidates = [];
  const envEmcc = process.env.EMCC;
  if (envEmcc) candidates.push(envEmcc);
  const explicit = process.argv.indexOf('--emsdk');
  if (explicit >= 0) {
    candidates.push(path.join(process.argv[explicit + 1], 'upstream', 'emscripten', 'emcc'));
  }
  for (const base of [process.env.EMSDK, path.join(homedir(), 'emsdk')]) {
    if (base) {
      candidates.push(path.join(base, 'upstream', 'emscripten', 'emcc'));
    }
  }
  // Emscripten ships emcc(.exe) since 6.x; older SDKs shipped emcc(.bat) on
  // Windows. Probe all variants below.
  if (process.platform === 'win32') {
    return candidates.flatMap((p) => {
      if (path.extname(p) !== '') return [p];
      return [`${p}.exe`, `${p}.bat`, p];
    });
  }
  return candidates;
}

function resolveEmcc() {
  const candidates = candidateEmccPaths();
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const onPath = spawnSync(
    process.platform === 'win32' ? 'where' : 'which',
    ['emcc'],
    { encoding: 'utf8' },
  );
  if (onPath.status === 0 && onPath.stdout.trim()) return onPath.stdout.trim().split(/\r?\n/)[0];
  throw new Error(
    'emcc not found. Install the Emscripten SDK and retry, or pass --emsdk <dir>:\n' +
      '  git clone https://github.com/emscripten-core/emsdk.git ~/emsdk\n' +
      '  ~/emsdk/emsdk install 6.0.5 && ~/emsdk/emsdk activate 6.0.5',
  );
}

async function main() {
  const options = argumentsMap(process.argv.slice(2));
  const cache = path.resolve(options.get('cache') ?? DEFAULT_CACHE);
  const lock = readJson(LOCK_PATH);

  const { version, tag, sourceUrl, sourceSha256 } = lock.ufbx;
  if (!/^[a-f0-9]{64}$/.test(sourceSha256)) {
    throw new Error('ufbx-wasm-lock.json sourceSha256 must be a SHA-256 digest.');
  }

  // 1. Fetch and verify the pinned ufbx source.
  const archive = path.join(cache, `ufbx-${tag}.tar.gz`);
  await download(sourceUrl, archive);
  const actualHash = sha256File(archive);
  if (actualHash !== sourceSha256) {
    throw new Error(
      `ufbx ${tag} archive SHA-256 mismatch: expected ${sourceSha256}, got ${actualHash}`,
    );
  }

  // 2. Extract (idempotent).
  const srcDir = path.join(cache, `src-${version}`);
  if (!existsSync(path.join(srcDir, 'ufbx.c'))) {
    rmSync(srcDir, { recursive: true, force: true });
    mkdirSync(srcDir, { recursive: true });
    // cwd instead of -C, and --force-local: Git Bash's tar treats Windows
    // drive-letter paths like `X:\...` as remote hosts.
    const result = spawnSync('tar', ['--force-local', '-xzf', archive, '--strip-components=1'], {
      cwd: srcDir,
      stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error('Failed to extract the ufbx source archive.');
  }

  // 3. Compile.
  const emcc = resolveEmcc();
  const outDir = path.join(cache, 'out');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const flags = [...lock.emccFlags, '-I', srcDir];
  const args = [
    path.join(srcDir, 'ufbx.c'),
    BRIDGE_PATH,
    ...flags,
    '-o', path.join(outDir, 'ufbx.js'),
  ];
  console.log(`Compiling ufbx ${version} with emcc ${flags.join(' ')}`);
  const compile = spawnSync(
    process.platform === 'win32' ? 'cmd' : emcc,
    process.platform === 'win32' ? ['/c', emcc, ...args] : args,
    { stdio: 'inherit', shell: false },
  );
  if (compile.status !== 0) throw new Error(`emcc failed with exit code ${compile.status}`);

  const wasmPath = path.join(outDir, 'ufbx.wasm');
  const jsPath = path.join(outDir, 'ufbx.js');
  if (!existsSync(wasmPath) || !existsSync(jsPath)) {
    throw new Error('emcc did not produce ufbx.wasm / ufbx.js.');
  }

  // 4. Verify against the pinned hashes.
  const wasmHash = sha256File(wasmPath);
  const jsHash = sha256File(jsPath);
  const pinnedWasm = lock.artifacts['ufbx.wasm'].sha256;
  const pinnedJs = lock.artifacts['ufbx.js'].sha256;
  if (pinnedWasm && pinnedWasm !== wasmHash) {
    throw new Error(
      `ufbx.wasm SHA-256 mismatch: expected ${pinnedWasm}, got ${wasmHash}. ` +
        'If the toolchain changed, update scripts/ufbx-wasm-lock.json deliberately.',
    );
  }
  if (pinnedJs && pinnedJs !== jsHash) {
    throw new Error(
      `ufbx.js SHA-256 mismatch: expected ${pinnedJs}, got ${jsHash}. ` +
        'If the toolchain changed, update scripts/ufbx-wasm-lock.json deliberately.',
    );
  }

  // 5. Stage into resources/ufbx (gitignored) with provenance.
  const resourcesDir = path.join(REPO_ROOT, 'resources', 'ufbx');
  mkdirSync(resourcesDir, { recursive: true });
  copyFileSync(wasmPath, path.join(resourcesDir, 'ufbx.wasm'));
  copyFileSync(jsPath, path.join(resourcesDir, 'ufbx.js'));
  copyFileSync(path.join(srcDir, 'ufbx.c'), path.join(resourcesDir, 'ufbx.c'));
  copyFileSync(path.join(srcDir, 'ufbx.h'), path.join(resourcesDir, 'ufbx.h'));
  copyFileSync(path.join(srcDir, 'LICENSE'), path.join(resourcesDir, 'LICENSE'));
  writeFileSync(
    path.join(resourcesDir, 'acquisition.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        artifact: 'ufbx wasm module',
        ufbxVersion: version,
        sourceUrl,
        sourceSha256,
        emsdkVersion: lock.emsdk.version,
        emccFlags: lock.emccFlags,
        wasmSha256: wasmHash,
        jsSha256: jsHash,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`Built resources/ufbx (ufbx.wasm ${(wasmHash.slice(0, 12))}…, ${(jsHash.slice(0, 12))}…)`);
}

main().catch((error) => {
  console.error(`ufbx wasm build failed: ${error.message}`);
  process.exitCode = 1;
});
