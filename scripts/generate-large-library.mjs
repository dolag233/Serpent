import { spawn } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const valueFor = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const output = valueFor('--output', path.resolve('tmp/serpent-large-library'));
const assets = valueFor('--assets', '20000');
const seed = valueFor('--seed', '20260816');
const reset = args.includes('--reset') ? '1' : '0';
const child = spawn(process.execPath, [
  'scripts/run-vitest-with-electron.mjs',
  'run',
  '--config',
  'vitest.config.ts',
  'tests/worker/large-library-fixture-generator.test.ts',
], {
  env: {
    ...process.env,
    SERPENT_LARGE_LIBRARY_OUTPUT: path.resolve(output),
    SERPENT_LARGE_LIBRARY_ASSETS: assets,
    SERPENT_LARGE_LIBRARY_SEED: seed,
    SERPENT_LARGE_LIBRARY_RESET: reset,
  },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Failed to generate the large-library fixture.', error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Large-library fixture generation stopped by ${signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
