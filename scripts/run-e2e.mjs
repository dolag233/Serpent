import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import process from 'node:process';

import { build } from 'vite';

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

await build({
  base: './',
  configFile: path.join(projectRoot, 'vite.renderer.config.ts'),
  build: {
    emptyOutDir: true,
    outDir: path.join(buildRoot, 'renderer/main_window'),
  },
});

const playwrightPath = require.resolve('@playwright/test/cli');
const child = spawn(process.execPath, [playwrightPath, 'test', ...process.argv.slice(2)], {
  cwd: projectRoot,
  env: process.env,
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
