#!/usr/bin/env node
// Keep the native better-sqlite3 addon aligned with the Electron runtime used
// by Worker/E2E tests. Host Node and Electron intentionally expose different
// NODE_MODULE_VERSION values; probe first so the normal path does not rebuild
// on every test invocation.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = require('electron');

if (typeof electronPath !== 'string') {
  throw new TypeError('The local electron package did not resolve to an executable path.');
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      ...options,
      env: { ...process.env, ...options.env },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve(false);
        return;
      }
      resolve(code === 0);
    });
  });
}

// Construct an in-memory database instead of merely requiring the package:
// better-sqlite3 loads its native addon lazily when Database is instantiated.
const electronReady = await run(
  electronPath,
  ['-e', "const Database = require('better-sqlite3'); new Database(':memory:').close()"],
  {
    // A mismatch is expected on the first invocation after a host-Node
    // install/rebuild; keep Electron's native stack trace out of normal logs.
    stdio: 'ignore',
    env: { ELECTRON_RUN_AS_NODE: '1' },
  },
);

if (electronReady) {
  console.log('[ensure-native] better-sqlite3 matches the Electron ABI.');
  process.exit(0);
}

console.log('[ensure-native] Rebuilding better-sqlite3 for Electron...');
const rebuilt = await run(process.execPath, [path.join(repoRoot, 'scripts', 'rebuild-native.mjs')]);
if (!rebuilt) {
  process.exitCode = 1;
}
