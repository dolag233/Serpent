import { spawn } from 'node:child_process';
import path from 'node:path';

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error('Usage: npm run test:e2e:large-library-benchmark -- <fixture-path>');
  process.exit(2);
}

const child = spawn(process.execPath, [
  'scripts/run-e2e.mjs',
  'tests/e2e/large-library-scroll-benchmark.test.ts',
], {
  env: {
    ...process.env,
    SERPENT_LARGE_LIBRARY_E2E_PATH: path.resolve(fixturePath),
  },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Failed to run the large-library Electron benchmark.', error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
