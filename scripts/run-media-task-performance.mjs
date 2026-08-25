import { spawn } from 'node:child_process';
import path from 'node:path';

const fixturePath = process.argv[2] ?? process.env.SERPENT_MEDIA_TASK_PERF_PATH;
if (!fixturePath) {
  console.error('Usage: npm run test:perf:media-tasks -- <fixture-path>');
  process.exit(2);
}

const child = spawn(process.execPath, [
  'scripts/run-vitest-with-electron.mjs',
  'run',
  '--config',
  'vitest.config.ts',
  'tests/worker/media-task-performance.test.ts',
  '--disableConsoleIntercept',
], {
  env: {
    ...process.env,
    SERPENT_MEDIA_TASK_PERF: '1',
    SERPENT_MEDIA_TASK_PERF_PATH: path.resolve(fixturePath),
  },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Failed to run the native media task benchmark.', error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
