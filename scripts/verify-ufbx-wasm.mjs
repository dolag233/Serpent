#!/usr/bin/env node
/**
 * Verify the ufbx WASM conversion component is present and byte-identical to
 * the pinned build (scripts/ufbx-wasm-lock.json).
 *
 * The artifacts live in resources/ufbx/ which is gitignored (each machine
 * builds them locally with scripts/build-ufbx-wasm.mjs). Packaging without
 * them silently ships a broken app: every FBX open falls back to "conversion
 * component unavailable" (FBX_WASM_UNAVAILABLE). This script is wired into
 * `prepackage` / `premake` so a missing or drifted component fails the build
 * with a reproducible hint instead of producing a crippled package.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = path.join(REPO_ROOT, 'scripts', 'ufbx-wasm-lock.json');
const UFBX_DIR = path.join(REPO_ROOT, 'resources', 'ufbx');

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

function fail(message) {
  console.error(
    `[verify-ufbx-wasm] FAILED: ${message}\n` +
      'Build the component with:\n' +
      '  git clone https://github.com/emscripten-core/emsdk.git ~/emsdk\n' +
      '  cd ~/emsdk && python emsdk.py install 6.0.5 && python emsdk.py activate 6.0.5\n' +
      '  node scripts/build-ufbx-wasm.mjs --emsdk <emsdk dir>\n' +
      'Do not package without resources/ufbx — the FBX conversion path (and FBX ' +
      'model thumbnails) would be unavailable in the shipped app.',
  );
  process.exitCode = 1;
}

function main() {
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'));

  for (const artifact of ['ufbx.wasm', 'ufbx.js']) {
    const artifactPath = path.join(UFBX_DIR, artifact);
    if (!existsSync(artifactPath)) {
      fail(`missing ${artifact} at resources/ufbx/`);
      return;
    }
    const expected = lock.artifacts?.[artifact]?.sha256;
    if (expected && sha256File(artifactPath) !== expected) {
      fail(`${artifact} SHA-256 mismatch with scripts/ufbx-wasm-lock.json`);
      return;
    }
  }

  console.log(
    `[verify-ufbx-wasm] OK: resources/ufbx (ufbx.wasm ${lock.artifacts['ufbx.wasm'].sha256.slice(0, 12)}…)`,
  );
}

main();
