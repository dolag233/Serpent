import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { pluginIdSchema } from './plugin-manifest';

/** Basename under userData or `<library>/.serpent/` for plugin file roots. */
export const PLUGIN_FILES_DIRECTORY_NAME = 'plugin-files';

export function resolvePluginDataDirectory(input: {
  scope: 'user' | 'library';
  pluginId: string;
  userDataDirectory: string;
  libraryDirectory: string | null;
}): string {
  const pluginId = pluginIdSchema.parse(input.pluginId);
  let directory: string;
  if (input.scope === 'user') {
    directory = path.join(input.userDataDirectory, PLUGIN_FILES_DIRECTORY_NAME, pluginId);
  } else {
    if (input.libraryDirectory === null || input.libraryDirectory.trim() === '') {
      throw new Error('An open library is required for library-scoped plugin data.');
    }
    directory = path.join(
      input.libraryDirectory,
      '.serpent',
      PLUGIN_FILES_DIRECTORY_NAME,
      pluginId,
    );
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}
