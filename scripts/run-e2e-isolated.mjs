/**
 * Runs the real Electron E2E suite (`scripts/run-e2e.mjs`) with
 * `SERPENT_E2E_ISOLATED=1`, so `src/main/index.ts` places the main window on
 * a non-primary display (fully within its bounds) instead of the primary
 * display, when a non-primary display is available. The window still uses a
 * normal `show()` — never `showInactive` — so real focus/keyboard E2E
 * (asset-ingestion, pagination, browsing-preferences, folder-context-menu,
 * ...) keep working exactly as before; only *where* the window appears
 * changes.
 *
 * Usage:
 *   node scripts/run-e2e-isolated.mjs [...playwright test args]
 *   npm run test:e2e:isolated
 *
 * Residual limitation (see
 * docs/development/2026-07-19-e2e-isolated-session-development-log.md):
 * on a single-display macOS machine there is no general-purpose virtual
 * display available yet, so the suite still runs but the window opens on
 * the primary display and can steal foreground focus. This script logs
 * that fallback clearly instead of pretending isolation happened; a
 * dedicated CI runner or virtual-display setup is tracked as a follow-up
 * to Serpent-a1b rather than solved here.
 *
 * On Linux, this script additionally detects `xvfb-run` and, when present,
 * wraps the whole invocation in a virtual X display. That gives Electron an
 * isolated display it fully owns regardless of physical monitor count,
 * which is the strongest isolation currently available for CI runners.
 */

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const runE2eScript = path.join(projectRoot, 'scripts', 'run-e2e.mjs');
const forwardedArgs = process.argv.slice(2);

function hasXvfbRun() {
  if (process.platform !== 'linux') return false;
  if (process.env.DISPLAY) {
    // A display is already available (e.g. a CI-provisioned Xvfb); do not
    // nest xvfb-run inside another virtual display.
    return false;
  }
  const probe = spawnSync('which', ['xvfb-run'], { stdio: 'ignore' });
  return probe.status === 0;
}

const useXvfbRun = hasXvfbRun();
const command = useXvfbRun ? 'xvfb-run' : process.execPath;
const args = useXvfbRun
  ? ['--auto-servernum', process.execPath, runE2eScript, ...forwardedArgs]
  : [runE2eScript, ...forwardedArgs];

if (useXvfbRun) {
  console.log('[run-e2e-isolated] Linux without $DISPLAY: running under `xvfb-run` for full display isolation.');
} else if (process.platform === 'darwin') {
  console.log(
    '[run-e2e-isolated] macOS: the E2E window will use a secondary display when one is connected; ' +
      'on a single-display Mac it falls back to the primary display (see serpent.log for the fallback notice).',
  );
}

const child = spawn(command, args, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, SERPENT_E2E_ISOLATED: '1' },
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
