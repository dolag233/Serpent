import { createRequire } from 'node:module';
import path from 'node:path';

import type { Page } from '@playwright/test';

const require = createRequire(path.resolve('package.json'));

export function resolveElectronExecutablePath(): string {
  const override = process.env.SERPENT_E2E_ELECTRON_EXECUTABLE;
  if (override) return override;

  const executablePath: unknown = require('electron');
  if (typeof executablePath !== 'string') {
    throw new TypeError('The local electron package did not resolve to an executable path.');
  }

  return executablePath;
}

/** Close via top-left library switcher (Inspector no longer exposes close/path). */
export async function closeLibraryViaSwitcher(
  window: Page,
  libraryName: string,
): Promise<void> {
  const switcher = window.getByRole('button', {
    name: `当前资源库 ${libraryName}`,
  });
  await switcher.click();
  await window.getByRole('menuitem', { name: '关闭资源库' }).click();
  // A Playwright click resolves after the event handler is dispatched, not
  // after the async Worker close has committed. Waiting for the switcher to
  // disappear makes callers observe the completed library lifecycle instead
  // of racing operation-directory cleanup.
  await switcher.waitFor({ state: 'hidden' });
}
