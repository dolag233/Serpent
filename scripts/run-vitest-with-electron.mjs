import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const vitestPackagePath = require.resolve('vitest/package.json');
const vitestPackage = JSON.parse(readFileSync(vitestPackagePath, 'utf8'));
const vitestBin =
  typeof vitestPackage.bin === 'string' ? vitestPackage.bin : vitestPackage.bin?.vitest;

if (typeof electronPath !== 'string') {
  throw new TypeError('The local electron package did not resolve to an executable path.');
}

if (typeof vitestBin !== 'string') {
  throw new TypeError('The local vitest package does not declare a CLI executable.');
}

const vitestPath = path.resolve(path.dirname(vitestPackagePath), vitestBin);
const child = spawn(electronPath, [vitestPath, ...process.argv.slice(2)], {
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Failed to start Vitest with the Electron Node runtime.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Vitest was terminated by signal ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
