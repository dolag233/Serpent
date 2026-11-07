import { execFileSync, spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import process from 'node:process';

import { build } from 'vite';
import { isSerpentDevElectronCommand } from './kill-stale-dev.mjs';

const require = createRequire(import.meta.url);
const playwrightPackage = require('@playwright/test/package.json');
const playwrightBin =
  typeof playwrightPackage.bin === 'string'
    ? playwrightPackage.bin
    : playwrightPackage.bin?.playwright;

if (typeof playwrightBin !== 'string') {
  throw new TypeError('The local Playwright package does not expose its CLI entry point.');
}

const projectRoot = process.cwd();
const buildRoot = path.join(projectRoot, '.vite');
const mainBuildDirectory = path.join(buildRoot, 'build');
const electronExternals = [
  'electron',
  'electron/common',
  'electron/main',
  'electron/renderer',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];
const nodeResolve = {
  conditions: ['node'],
  mainFields: ['module', 'jsnext:main', 'jsnext'],
};

// This build replaces .vite/build and .vite/renderer. Refuse to overwrite the
// modules of a running npm start session (including a hidden dev window).
if (process.platform === 'win32') {
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process -Filter "Name = \'electron.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
  ], { encoding: 'utf8', windowsHide: true });
  const parsed = JSON.parse(output || 'null');
  const processes = parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed];
  if (processes.some((entry) => isSerpentDevElectronCommand(entry.CommandLine, projectRoot))) {
    throw new Error('A Serpent development instance is running. Close it before the E2E build replaces .vite.');
  }
} else {
  const output = execFileSync('ps', ['-ax', '-o', 'command='], { encoding: 'utf8' });
  if (output.split('\n').some((command) => isSerpentDevElectronCommand(command, projectRoot))) {
    throw new Error('A Serpent development instance is running. Close it before the E2E build replaces .vite.');
  }
}

await rm(buildRoot, { force: true, recursive: true });

// E2E launches Electron itself, so build a production-like file:// application.
// This avoids coupling the tests to a Vite process or a dev-server URL baked by
// a previous `electron-forge start` invocation.
await build({
  configFile: path.join(projectRoot, 'vite.main.config.ts'),
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  resolve: nodeResolve,
  build: {
    emptyOutDir: false,
    outDir: mainBuildDirectory,
    rollupOptions: {
      external: electronExternals,
    },
  },
});

await build({
  configFile: path.join(projectRoot, 'vite.preload.config.ts'),
  resolve: nodeResolve,
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.join(projectRoot, 'src/preload/index.ts'),
      fileName: () => 'index.js',
      formats: ['cjs'],
    },
    outDir: mainBuildDirectory,
    rollupOptions: {
      external: electronExternals,
    },
  },
});

// The hidden model-thumbnail BrowserWindow has its own preload bridge. Forge
// builds it through the Vite plugin, but this production-like E2E entrypoint
// assembles the build graph manually and must emit the same bundle.
await build({
  configFile: path.join(projectRoot, 'vite.offscreen-preload.config.ts'),
  resolve: nodeResolve,
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.join(projectRoot, 'src/preload/offscreen.ts'),
      fileName: () => 'offscreen.js',
      formats: ['cjs'],
    },
    outDir: mainBuildDirectory,
    rollupOptions: {
      external: electronExternals,
    },
  },
});

// Critical confirmation child windows use a separate, narrow preload bridge;
// keep the production-like E2E build graph in lockstep with Forge.
await build({
  configFile: path.join(projectRoot, 'vite.critical-confirmation-preload.config.ts'),
  resolve: nodeResolve,
  build: {
    emptyOutDir: false,
    lib: {
      entry: path.join(projectRoot, 'src/preload/critical-confirmation.ts'),
      fileName: () => 'critical-confirmation.js',
      formats: ['cjs'],
    },
    outDir: mainBuildDirectory,
    rollupOptions: {
      external: electronExternals,
    },
  },
});

await build({
  configFile: path.join(projectRoot, 'vite.worker.config.ts'),
  resolve: nodeResolve,
  build: {
    emptyOutDir: false,
    outDir: mainBuildDirectory,
    rollupOptions: {
      external: electronExternals,
    },
  },
});

// Desktop Console scripts now execute in a separate UtilityProcess. The E2E
// application uses the same `.vite/build` directory as Forge, so this entry
// must be rebuilt alongside Main/Preload/Library Worker; otherwise an old
// runtime artifact could make a current Console test exercise stale code.
await build({
  configFile: path.join(projectRoot, 'vite.script-runtime.config.ts'),
  resolve: nodeResolve,
  build: {
    emptyOutDir: false,
    outDir: mainBuildDirectory,
    rollupOptions: {
      external: electronExternals,
    },
  },
});

await build({
  configFile: path.join(projectRoot, 'vite.plugin-runtime.config.ts'),
  resolve: nodeResolve,
  build: {
    emptyOutDir: false,
    outDir: mainBuildDirectory,
    rollupOptions: {
      external: electronExternals,
    },
  },
});

await build({
  configFile: path.join(projectRoot, 'vite.plugin-trusted-runtime.config.ts'),
  resolve: nodeResolve,
  build: {
    emptyOutDir: false,
    outDir: mainBuildDirectory,
    rollupOptions: {
      external: electronExternals,
    },
  },
});

await build({
  base: './',
  configFile: path.join(projectRoot, 'vite.renderer.config.ts'),
  build: {
    emptyOutDir: true,
    outDir: path.join(buildRoot, 'renderer/main_window'),
  },
});

const playwrightPath = require.resolve('@playwright/test/cli');
// Cursor/agent shells often inherit ELECTRON_RUN_AS_NODE=1 so Electron behaves
// like plain Node and rejects Playwright's --remote-debugging-port. Strip it
// for the Playwright child and every Electron process it launches.
const playwrightEnv = { ...process.env };
delete playwrightEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, [playwrightPath, 'test', ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: playwrightEnv,
  stdio: 'inherit',
});

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
