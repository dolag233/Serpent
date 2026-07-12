import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { _electron as electron, expect, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

function environment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

test('a second instance restores the existing window', async () => {
  const executablePath = process.env.SERPENT_E2E_ELECTRON_EXECUTABLE;
  if (!executablePath) throw new Error('Set SERPENT_E2E_ELECTRON_EXECUTABLE.');
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    executablePath,
    args: [applicationDirectory],
    cwd: applicationDirectory,
    env: environment(),
  });

  try {
    await application.firstWindow();
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.minimize();
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const secondInstance = spawn(executablePath, [applicationDirectory], {
        cwd: applicationDirectory,
        env: environment(),
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
    await application.close();
  }
});

test('closing the last macOS window keeps the application process alive', async () => {
  test.skip(process.platform !== 'darwin', 'This lifecycle rule is macOS-specific.');
  const executablePath = process.env.SERPENT_E2E_ELECTRON_EXECUTABLE;
  if (!executablePath) throw new Error('Set SERPENT_E2E_ELECTRON_EXECUTABLE.');
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    executablePath,
    args: [applicationDirectory],
    cwd: applicationDirectory,
    env: environment(),
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
  }
});
