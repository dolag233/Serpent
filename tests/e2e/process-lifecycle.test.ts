import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 60_000 });

function environment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

// Each process-lifecycle test gets its own fresh SERPENT_E2E_USER_DATA_PATH profile so
// the single-instance / window-lifecycle behavior is exercised in isolation from the
// developer's default userData (whose recent-library.json may point at a deleted path
// and, in non-e2e mode, cause the app to hang on auto-restore instead of showing the
// start screen). Both the first launch and the second-instance spawn share the same
// profile so the single-instance lock + second-instance handoff are keyed identically.
function createIsolatedProfile(): { temporaryRoot: string; profilePath: string } {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-process-lifecycle-'));
  const profilePath = path.join(temporaryRoot, 'profile');
  mkdirSync(profilePath);
  return { temporaryRoot, profilePath };
}

async function closeApplicationForTest(
  application: Awaited<ReturnType<typeof electron.launch>>,
): Promise<void> {
  const childProcess = application.process();
  if (childProcess.exitCode === null) {
    // macOS deliberately keeps the process alive after its last window closes.
    // Ask the app to quit explicitly before closing the Playwright transport;
    // otherwise ElectronApplication.close() can wait forever in this test's
    // finally block even though the second-instance assertion already passed.
    try {
      await application.evaluate(({ app }) => app.quit());
    } catch {
      // The process may have exited between the check and the evaluation.
    }
    await Promise.race([
      once(childProcess, 'exit').then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  if (childProcess.exitCode === null) {
    childProcess.kill('SIGKILL');
    await once(childProcess, 'exit').catch(() => undefined);
  }
  await application.close().catch(() => undefined);
}

test('a second instance restores the existing window', async () => {
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const { temporaryRoot, profilePath } = createIsolatedProfile();
  const env = { ...environment(), SERPENT_E2E: '1', SERPENT_E2E_USER_DATA_PATH: profilePath };
  const application = await electron.launch({
    executablePath,
    args: [applicationDirectory],
    cwd: applicationDirectory,
    env,
  });

  try {
    await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const secondInstance = spawn(executablePath, [applicationDirectory], {
        cwd: applicationDirectory,
        env,
        stdio: 'ignore',
      });
      const timer = setTimeout(() => {
        secondInstance.kill();
        reject(new Error('The second instance did not hand off within five seconds.'));
      }, 5_000);
      secondInstance.once('error', reject);
      secondInstance.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    expect(exitCode).toBe(0);
    await expect
      .poll(() =>
        application.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized() ?? true,
        ),
      )
      .toBe(false);
  } finally {
    await closeApplicationForTest(application);
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('closing the last macOS window keeps the application process alive', async () => {
  test.skip(process.platform !== 'darwin', 'This lifecycle rule is macOS-specific.');
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const { temporaryRoot, profilePath } = createIsolatedProfile();
  const env = { ...environment(), SERPENT_E2E: '1', SERPENT_E2E_USER_DATA_PATH: profilePath };
  const application = await electron.launch({
    executablePath,
    args: [applicationDirectory],
    cwd: applicationDirectory,
    env,
  });

  try {
    const window = await application.firstWindow();
    await window.close();
    await expect.poll(() => application.windows()).toHaveLength(0);
    expect(application.process().exitCode).toBeNull();
  } finally {
    const childProcess = application.process();
    if (childProcess.exitCode === null) {
      childProcess.kill('SIGKILL');
      await once(childProcess, 'exit');
    }
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('Windows custom close hides the window and keeps the tray process alive', async () => {
  test.skip(process.platform !== 'win32', 'This lifecycle rule is Windows-specific.');
  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const { temporaryRoot, profilePath } = createIsolatedProfile();
  const env = { ...environment(), SERPENT_E2E: '1', SERPENT_E2E_USER_DATA_PATH: profilePath };
  const application = await electron.launch({
    executablePath,
    args: [applicationDirectory],
    cwd: applicationDirectory,
    env,
  });
  const childProcess = application.process();

  try {
    const window = await application.firstWindow();
    // Dispatch the renderer handler directly. A fresh profile can show a
    // startup dialog whose backdrop covers the caption button's hit target;
    // the real Windows caption button remains available when no modal is open.
    await window.locator('.windows-caption-button-close').dispatchEvent('click');
    await expect
      .poll(() =>
        application.evaluate(
          ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false,
        ),
      )
      .toBe(false);
    expect(childProcess.exitCode).toBeNull();
  } finally {
    if (childProcess.exitCode === null) {
      await application.evaluate(({ app }) => app.quit());
      await once(childProcess, 'exit');
    }
    await rm(temporaryRoot, { force: true, recursive: true, maxRetries: 20, retryDelay: 250 });
  }
});
