import { createRequire } from 'node:module';
import path from 'node:path';

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
