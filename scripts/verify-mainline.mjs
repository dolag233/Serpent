import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('verify:mainline must be launched through npm.');

const gateEnvironment = process.platform === 'darwin' && process.arch === 'arm64'
  ? { ...process.env, SERPENT_REQUIRE_REAL_MEDIA: '1' }
  : process.env;

const gates = [
  'lint',
  'typecheck',
  'extension:verify',
  'test',
  'test:perf:search',
  'test:e2e',
];

for (const gate of gates) {
  process.stdout.write(`\n[verify:mainline] npm run ${gate}\n`);
  const result = spawnSync(process.execPath, [npmCli, 'run', gate], {
    cwd: process.cwd(),
    env: gateEnvironment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
