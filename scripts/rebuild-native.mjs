#!/usr/bin/env node
// Rebuilds better-sqlite3 against the dev Electron runtime and verifies the
// resulting binary actually supports FTS5 under the Electron ABI.
//
// Why this script exists (Windows): a machine-wide vcpkg MSBuild integration
// (`vcpkg integrate install`) injects its own library directories into every
// MSBuild invocation. When node-gyp compiles better-sqlite3 from source on
// such a machine, the linker resolves `sqlite3.lib` to vcpkg's import library
// for a system sqlite3.dll that is built WITHOUT FTS5, instead of the bundled
// amalgamation static library (which defines SQLITE_ENABLE_FTS5). vcpkg then
// applocal-deploys its FTS5-less sqlite3.dll next to better_sqlite3.node, and
// every `CREATE VIRTUAL TABLE ... USING fts5` fails at runtime with
// `no such module: fts5` (observed as LIBRARY_CORRUPT on library.create).
// Setting the MSBuild property VcpkgEnabled=false (via environment, which
// MSBuild imports as properties) keeps the build hermetic from vcpkg.

import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const electronPath = require('electron');
if (typeof electronPath !== 'string') {
  throw new TypeError('The local electron package did not resolve to an executable path.');
}

const rebuildCli = require.resolve('@electron/rebuild/lib/cli.js');
const betterSqlite3Root = path.dirname(require.resolve('better-sqlite3/package.json'));
const buildDir = path.join(betterSqlite3Root, 'build');

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
        reject(new Error(`Process terminated by signal ${signal}: ${command}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}: ${command} ${args.join(' ')}`));
        return;
      }
      resolve();
    });
  });
}

// node-gyp's clean step does not remove foreign applocal DLLs reliably; make
// sure no stale artifact can survive into the verified output.
if (existsSync(buildDir)) {
  rmSync(buildDir, { recursive: true, force: true });
}

console.log('[rebuild-native] Rebuilding better-sqlite3 for Electron (VcpkgEnabled=false)...');
await run(process.execPath, [rebuildCli, '-f', '-w', 'better-sqlite3'], {
  env: { VcpkgEnabled: 'false' },
});

// A legitimate static build never contains a sqlite3.dll. Its presence means
// a vcpkg applocal deployment (or similar) slipped through and the .node
// almost certainly links dynamically against a FTS5-less system SQLite.
const applocalDll = path.join(buildDir, 'Release', 'sqlite3.dll');
if (existsSync(applocalDll)) {
  console.error(
    '[rebuild-native] FAIL: build/Release/sqlite3.dll exists after rebuild.\n' +
      '  A machine-wide package manager (vcpkg or similar) hijacked the link.\n' +
      '  Remove its user-wide MSBuild integration or rebuild in a clean environment.',
  );
  process.exitCode = 1;
  process.exit();
}

// Runtime proof: the .node we just built must create an FTS5 table under the
// Electron ABI (system Node has a different NODE_MODULE_VERSION and would
// refuse to load it, which is expected and unrelated).
const probePath = path.join(betterSqlite3Root, '.serpent-fts5-probe.cjs');
writeFileSync(
  probePath,
  [
    "const Database = require('better-sqlite3');",
    'const db = new Database(\':memory:\');',
    "db.exec('CREATE VIRTUAL TABLE serpent_fts5_probe USING fts5(x)');",
    'db.close();',
    "console.log('[rebuild-native] FTS5 probe OK');",
    '',
  ].join('\n'),
);
try {
  await run(electronPath, [probePath], {
    env: { ELECTRON_RUN_AS_NODE: '1' },
  });
} catch (error) {
  console.error(
    '[rebuild-native] FAIL: better_sqlite3.node loaded but could not create an FTS5\n' +
      '  virtual table under the Electron runtime. The bundled SQLite amalgamation\n' +
      '  must be compiled with SQLITE_ENABLE_FTS5; do not link a system sqlite3.',
  );
  throw error;
} finally {
  rmSync(probePath, { force: true });
}

console.log('[rebuild-native] better-sqlite3 rebuilt and FTS5 verified for Electron.');
