import { spawn } from 'node:child_process';
import path from 'node:path';

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error('Usage: npm run test:perf:large-library -- <fixture-path>');
  process.exit(2);
}

const child = spawn(process.execPath, [
  'scripts/run-vitest-with-electron.mjs',
  'run',
  '--config',
  'vitest.config.ts',
  'tests/worker/large-library-performance.test.ts',
], {
  env: {
    ...process.env,
    SERPENT_LARGE_LIBRARY_PERF_PATH: path.resolve(fixturePath),
  },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Failed to run the large-library performance baseline.', error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
