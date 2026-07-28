import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import electronPath from 'electron';

const projectRoot = path.resolve(import.meta.dirname, '..');
const entry = path.join(projectRoot, '.vite', 'cli', 'serpent.mjs');
if (!existsSync(entry)) {
  console.error('Serpent CLI 尚未构建。请先运行 npm run cli:build。');
  process.exitCode = 4;
} else {
  const result = spawnSync(electronPath, [entry, ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
